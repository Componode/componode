# Data Model: Remote Import Execution (spec 027)

**Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md) |
**Decisions**: [research.md](./research.md)

## Schema delta — migration `018_remote_run_agent.ts`

### `import_runs` (existing table, altered)

| Column | Change |
|---|---|
| `agentId` | NEW `uuid NULL` + index `import_runs_agent_idx` — the executing Import Agent for remote runs; `NULL` = in-process. Deliberately **no FK** to `import_agents`: the run row is history — deleting an agent must not require deleting its run history (mirrors `credentialIds` jsonb precedent: run rows record *who ran*, not a live relationship). Ratified shape from research §7 + ADR-116 Amendment 1. |

### `ImportRunRow` (db/types.ts)

```ts
export interface ImportRunRow {
  // ... existing fields
  agentId: string | null;   // NULL = in-process execution
}
```

### `importer_configs.agentId` (existing column — now writable)

Added by migration 016 with `ON DELETE RESTRICT`; this spec makes it
settable through create/update. No schema change.

## In-memory state (remote-run-service)

Session-bound by design — nothing here survives restart (non-terminal
remote runs are failed `AGENT_LOST` by `recoverRuns` on boot).

```ts
// Per-agent FIFO of runIds awaiting capacity/connectivity.
pendingByAgent: Map<string /*agentId*/, string[] /*runId*/>

// Runs the hub believes the agent holds.
inFlight: Map<string /*runId*/, {
  runId: string;
  agentId: string;
  sessionId: string;
  state: "ASSIGNED" | "ACKED";
  ackTimer?: Timeout;
  configId: string;
  importerName: string;
  startedAt?: string;
}>

// Per-run dispatch deadline (absolute timestamp), from startRun.
dispatchDeadline: Map<string /*runId*/, Timeout>
```

`ASSIGNED` runs count against `maxConcurrentJobs` — an agent is never
offered more concurrent jobs than it advertised.

## Derived state (computed, not persisted)

| Flag | Derivation | Surface |
|---|---|---|
| `agentIncompatible` on a bound config | `agent.revokedAt != null OR (allowedImporters.length > 0 AND importerName ∉ allowedImporters)` | config list/detail, agent configs list, config card flag |
| "Waiting for agent" | `run.status = 'PENDING' AND run.agentId IS NOT NULL` | run detail |
| `OFFLINE_AGENT` attention item | `agent.status = 'OFFLINE' AND boundConfigCount > 0` | dashboard |
| `activeRuns` on agent | in-flight map filtered by agentId (+ config label join) | agent detail |
| `runningJobs` on agent list | `inFlight` count per agentId | agents list |

## Entity notes

- **ImportRun.executor**: `agentId` + joined `agentName` on API responses.
  Executor attribution is immutable post-creation — rebinding a config does
  not rewrite its history (spec edge case).
- **Job assignment**: wire-only (`job.assign` payload); never persisted —
  the run row + in-flight map carry the same information durably/in-memory.
- **Secret reference map in `job.assign`**: merged flat
  `Record<keyName, SecretRef>` across the config's `AGENT_MANAGED`
  credentials — cross-credential key collisions are already rejected at
  config save (`CREDENTIAL_KEY_COLLISION`), so the merge cannot collide.

## State transitions (remote run)

```text
PENDING (agentId stamped) ──dispatch──▶ ASSIGNED ──ack──▶ RUNNING ──run.complete──▶ COMPLETED | FAILED | CANCELLED
   │                                       │                                      │
   ├── dispatch timeout ──▶ FAILED/AGENT_UNAVAILABLE                              ├── run.error rows accumulate (non-fatal)
   ├── cancel (queued) ───▶ CANCELLED                                           └── session lost ──▶ FAILED/AGENT_LOST
   └── hub restart ──────▶ FAILED/AGENT_LOST (recoverRuns)
```

`ASSIGNED`-and-unacked past `AGENT_JOB_ACK_TIMEOUT_MS` → `FAILED`/
`AGENT_UNAVAILABLE`; NACK → `FAILED`/`AGENT_INCOMPATIBLE` (or
`SECRET_RESOLUTION_FAILED` when the NACK reason carries it — R11).
