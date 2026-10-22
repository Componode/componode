# Research: Remote Import Execution (spec 027)

**Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md) |
**Ratified anchors**: ADR-116 (incl. Amendment 1), ADR-117, ADR-058,
ADR-060/061, research `remote-import-agents_research.md` §3–4, §8, §10–11

All spec-level decisions are ratified. This document resolves the remaining
implementation-level choices; anything that extends an enumerated ADR
surface (frame payloads, error codes, env vars, audit actions, metrics) is
flagged for **ADR-116 Amendment 2** in the same change (per the repo's
ADR-fidelity rule; precedent: Amendment 1 ratified the enroll endpoint,
extended env list, and new `disconnectReason` values).

## R1 — Orchestration ownership: `remote-run-service.ts` + session-service seam

**Decision**: a new `packages/backend/src/services/remote-run-service.ts`
owns the remote run lifecycle: per-agent pending FIFO, in-flight map,
dispatch/ack timers, frame handling (`job.ack`, `asset.batch`, `phase`,
`run.complete`, `run.error`), and finalize (reconcile + suggestions +
terminal transition). `AgentSessionService` delegates — it routes job-typed
frames and session-lost events to an injected `RemoteRunHandler` interface
(same seam pattern as `AgentSessionDropper` in `agent-service.ts`, wired in
`app.ts`).

```ts
interface RemoteRunHandler {
  handleJobAck(session, runId, payload): Promise<void>;
  handleAssetBatch(session, runId, payload): Promise<void>;
  handlePhase(session, runId, payload): Promise<void>;
  handleRunError(session, runId, payload): Promise<void>;
  handleRunComplete(session, runId, payload): Promise<void>;
  onSessionLost(session): Promise<void>;   // disconnect → in-flight FAILED AGENT_LOST
}
```

`AgentSessionService` gains `setRunHandler(handler)` and calls it for the
job frame types; unknown/unhandled types still get `error` + close (drift
rule unchanged). `closeSession` calls `onSessionLost` — covering client
close, heartbeat timeout, revoke, supersede, and hub `stop()` in one place.

**Rationale**: the session service currently owns transport + liveness +
the `credential.test` pending map. Run orchestration needs run-row writes,
`processAsset`, and finalize helpers — putting it inside the session
service would drag run bookkeeping into a transport module and invert the
dependency direction the codebase already has (`import-run-service` is the
run authority). The injected seam keeps `AgentSessionService` free of
run-service imports (no cycle: session service → interface → run service;
run service → session service only for `send`/`live.get` — solved by
exposing narrow `sendToAgent(agentId, type, payload)` and
`getSession(agentId)` methods on the session service).

**Alternatives**: (a) run dispatch inside `AgentSessionService` — couples
transport to DB writes and duplicates the run finalize path; (b) a separate
dispatch WebSocket — rejected in ADR-116 (one stream); (c) an event bus —
no such abstraction exists in the codebase.

## R2 — Run-flow branch point: `startRun` stamps `agentId`, worker vs dispatch

**Decision**: `startRun` gains a config lookup up front (needed to stamp
`import_runs.agentId` anyway). Bound config → insert `PENDING` + `agentId`,
then `remoteRuns.enqueue(runId)` — bypassing the in-process `p-queue`
worker entirely. Unbound → existing path unchanged. The
`RUN_IN_PROGRESS` single-active-run check is unchanged (one active run per
config regardless of executor).

`worker()` stays in-process-only. Remote runs therefore never occupy
`IMPORTER_MAX_CONCURRENCY` slots — remote capacity is governed by the
agent's `maxConcurrentJobs` (ADR-116 amends ADR-060/061).

`cancelRun(runId)` branches on `run.agentId`: undispatched (still queued)
remote run → dequeue + `CANCELLED` immediately; dispatched remote run →
`cancelRequestedAt` stamp (unchanged source of truth, ADR-058) + `cancel`
frame to the agent; run reaches `CANCELLED` on the agent's terminal frame.
In-process path unchanged.

**Rationale**: `startRun` is the single entry point for manual *and*
scheduled triggers — branching there makes scheduling automatically remote
(FR-007) with zero scheduler changes.

## R3 — Job frame payloads (promote from `FUTURE_AGENT_MESSAGE_TYPES`)

**Decision**: promote all seven reserved types to real schemas in
`contracts/agent-protocol.ts`. Envelope `runId` correlates the whole job —
one job = one run, so no separate `jobId` (the `credential.test` `testId`
precedent doesn't apply: that frame is explicitly *not* a run).

| Type | Dir | Payload |
|---|---|---|
| `job.assign` | hub→agent | `{importerName, scope, secretRefMap}` — `secretRefMap` is the merged `Record<key,SecretRef>` across the config's `AGENT_MANAGED` credentials (may be empty) |
| `job.ack` | agent→hub | `{accepted: boolean, reason?: string}` — `accepted:false` = NACK |
| `asset.batch` | agent→hub | `{assets: unknown[]}` — assets re-validated hub-side per contract; `seq` not needed (no resume) |
| `phase` | agent→hub | `{name: string ≤200}` → `import_runs.currentPhase` |
| `run.error` | agent→hub | `{assetExternalId?, errorType, errorMessage}` → `import_run_errors` row (per-asset, non-fatal — e.g. `ASSET_TOO_LARGE`) |
| `run.complete` | agent→hub | `{result: "COMPLETED"\|"CANCELLED"\|"FAILED", errorType?, errorMessage?}` — the only frame that terminates a run |
| `cancel` | hub→agent | `{runId}` — mirrors `credential.test` carrying its id in the payload |

All schemas `.strict()`. `asset.batch` bounds (≤100 assets / ~1 MB) are the
agent's contract; the hub enforces frame sanity at the socket level
(existing `maxPayload`/BAD_FRAME path) and validates each asset with
`validateDiscoveredAssetDetailed` — invalid assets become
`VALIDATION_FAILED` run errors, identical to in-process.

**Flagged for ADR-116 Amendment 2** — payload shapes are a contract surface
the ADR left to `docs/agent-protocol.md`; ratify the table above.

## R4 — Timeout & capacity constants

**Decision** (hub env-overridable, matching the existing `envInt`
convention in `agent-session-service.ts`):

| Constant | Default | Meaning |
|---|---|---|
| `AGENT_DISPATCH_TIMEOUT_MS` | 600_000 (10 min) | PENDING → `FAILED`/`AGENT_UNAVAILABLE` when no capacity/connect materializes. Ratified: research §3.2 "~10 min, configurable". |
| `AGENT_JOB_ACK_TIMEOUT_MS` | 15_000 | `job.assign` sent → `job.ack` window; expiry fails the run `AGENT_UNAVAILABLE` (assigned but unconfirmed — `AGENT_LOST` is reserved for session loss). |

The dispatch timer starts at `startRun` (queue entry), not at first
`job.assign` — a run that never gets capacity fails at the same bound an
offline-agent run does. Timers are per-run, cleared on ack/terminal.

Capacity = `hello.capabilities.maxConcurrentJobs` (already persisted on the
agent row and session). The hub gates on its own in-flight count for the
session — heartbeat `currentJobs` is informational, never trusted for
gating (a lagging heartbeat must not oversubscribe the agent).

**Flagged for ADR-116 Amendment 2** — env var list is a closed surface
(Amendment 1 already extended it once).

## R5 — Per-agent FIFO + dispatch triggers

**Decision**: `pendingByAgent: Map<agentId, runId[]>` + `inFlight:
Map<runId, {session, agentId, state}>` in the remote-run service.
`tryDispatch(agentId)` runs on three triggers: `enqueue` (new run), session
establishment (agent re/connects), and in-flight completion (capacity
frees). Each iteration: shift the oldest queued run → mark `ASSIGNED` →
`job.assign` → ack timer. `ASSIGNED`-but-unacked runs count against
capacity (an agent must never be oversubscribed).

Queued runs survive a disconnect (they were never the session's
responsibility) — they simply wait for reconnect until their own dispatch
bound fires. Only `ASSIGNED`/`ACKED` runs die with the session.

**Rationale**: FIFO is the spec'd assumption; queue state is in-memory by
design — a hub restart fails queued remote runs `AGENT_LOST` at recovery
(R8), matching session-bound semantics.

## R6 — Asset processing reuse

**Decision**: export the run-loop helpers the remote path needs from
`import-run-service.ts` (no logic duplication): `processAsset`,
`insertRunError`, `updateRun`, `reconcileRetiredComponents`, `runActor`,
`createRunLogger`. The remote service maintains the same counters
(`assetsProcessed/Created/Updated/instancesOrphaned/componentsRetired`,
`yieldedComponentIds`) and calls the identical `runSuggestionPass` finalize
on `run.complete{result:"COMPLETED"}` — cancelled/failed runs skip
reconciliation + suggestions exactly like in-process cancelled/failed runs.

`credentialIds` on the run row: remote runs stamp the *agent-managed*
credential ids used (same column, same `lastUsedAt` bump) — preserves the
run↔credential audit join.

**Rationale**: the importer contract is the wire boundary (ADR-116 #2) —
everything after `validateDiscoveredAssetDetailed` is literally the same
code.

## R7 — Terminal outcomes matrix (frame → run row)

| Agent event | Run outcome |
|---|---|
| `run.complete{COMPLETED}` | reconcile → `COMPLETED` + suggestions |
| `run.complete{CANCELLED}` | `CANCELLED` (no reconcile) |
| `run.complete{FAILED, errorType, errorMessage}` | `FAILED` + errorType/message |
| `run.error{...}` (per-asset) | `import_run_errors` row + counter; run continues |
| `job.ack{accepted:false, reason}` | `FAILED`/`AGENT_INCOMPATIBLE`, reason echoed |
| no `job.ack` in 15 s | `FAILED`/`AGENT_UNAVAILABLE` |
| disconnect/heartbeat timeout | in-flight → `FAILED`/`AGENT_LOST` |
| `cancel` frame → agent aborts → `run.complete{CANCELLED}` | `CANCELLED` |
| frames for unknown/dead runId | warn-log + ignore (stale batch after cancel/disconnect — never resurrect) |
| `asset.batch` for a run not `ACKED`/running on that session | rejected as protocol violation (BAD_FRAME → close) — an agent echoing stale jobs can't write to another run |

`errorType` on the run row records the machine code (`AGENT_LOST` etc.);
`errorMessage` the human sentence. Terminal transitions write through the
same `updateRun` path, and `agent_jobs_total{agent,result}` is incremented
exactly once per run at terminal — `result` ∈ `completed|failed|cancelled|
lost|unavailable|incompatible`.

## R8 — Startup recovery

**Decision**: extend `recoverRuns`: non-terminal runs with `agentId IS NOT
NULL` → `FAILED` with `errorType: "AGENT_LOST"` (cancel-requested remote
runs → `CANCELLED`, matching the in-process rule). In-process runs keep
`INTERRUPTED`. One migration `018_remote_run_agent.ts` adds the nullable
`agentId uuid` + index — deferred from 016 per ADR-116 Amendment 1.

## R9 — Binding validation & drift flag

**Decision**: `agentId` joins `createImporterConfigSchema` /
`updateImporterConfigSchema` as `z.string().uuid().nullable().optional()`.
`importer-config-service` gains `assertAgentAssignable(trx, agentId,
importerName)`: agent exists → `AGENT_NOT_FOUND` (404); `revokedAt` set →
`AGENT_INCOMPATIBLE` (400); non-empty `allowedImporters` not containing
`importerName` → `AGENT_INCOMPATIBLE` (400). All messages name the agent +
importer (FR-024-style message discipline from 026).

Executor-aware credential revalidation: on update, revalidate when `agentId`
**or** the credential junction changed — `validateSecretSources` already
takes `agentId`; pass the *effective* pair (new agentId ?? existing,
new credentialIds ?? existing).

Read-side: config list/detail join `import_agents` and return
`agent: {id, name, status} | null` plus derived `agentIncompatible: boolean`
= `revokedAt != null || (allowedImporters.length > 0 && !allowedImporters
.includes(importerName))`. Drift needs no persisted flag — it's a pure
function of the join at read time, re-evaluated on every read (satisfies
FR-005's "re-evaluate" without a background reconciler; dispatch-time
enforcement is the hard guarantee).

**Alternatives**: a persisted `incompatible` column recomputed on agent
edits — denormalization for a flag that is a one-join computation;
rejected.

## R10 — Agent surface endpoints & in-flight visibility

**Decision**:

- `GET /api/v1/agents/{id}/configs` → bound configs
  `{id,label,importerName,agentIncompatible}[]` (`agent:read`).
- `GET /api/v1/agents/{id}/runs` → latest 50 `import_runs` where
  `agentId = id` (`agent:read`).
- `GET /api/v1/agents/{id}` response gains `activeRuns:
  [{runId,configId,configLabel,phase,startedAt}]` from the in-flight map;
  `GET /api/v1/agents` rows gain `runningJobs: number`.
- Run responses (`getRun`/`listRunsForConfig`) join `import_agents` →
  `agentId` + `agentName` fields on the run payload.
- Dashboard `AttentionItem.kind` gains `OFFLINE_AGENT` — offline
  (`status = 'OFFLINE'` or `'NEVER_CONNECTED'`? **no** — `NEVER_CONNECTED`
  isn't a broken deployment, it's an unstarted one; flag `OFFLINE` only)
  agents having `boundConfigCount > 0`.

The dispatcher is decorated as `app.remoteRuns` next to `app.agentSessions`
so routes can read in-flight state without a circular import.

**Flagged for ADR-116 Amendment 2** — endpoint list + agent response
surface are enumerated in the ADR (item 11 lists the pages; the API list in
§8.1 of research is "ratified" by reference — new routes go in the
amendment and `openapi.yaml` per ADR-104).

## R11 — Agent-side executor (`packages/agent/src/executor.ts`)

**Decision**: a `JobExecutor` holds `activeJobs: Map<runId,
{controller, importerName}>` (bounded by `maxConcurrentJobs`).

- `handleJobAssign(payload, runId)`: capacity full → NACK `at capacity`;
  importer absent or version-mismatched in the registry → NACK
  `importer "<name>" not compiled at required version`; else resolve
  `secretRefMap` via the spec-026 `resolveRefMap` (failure → `run.complete
  {FAILED, errorType:"SECRET_RESOLUTION_FAILED"}` naming key+source), then
  `job.ack{accepted:true}` and start the generator.
  Order matters: ACK only *after* secrets resolve — an unresolvable job
  never reaches RUNNING hub-side. Wait — that flips failure to ack-time:
  resolution failure → `job.ack{accepted:false, reason}` (NACK, run fails
  `AGENT_INCOMPATIBLE`)? **No** — a missing env var is not an
  "incompatible" condition; ratified outcome should be `FAILED` with the
  resolution error, not `AGENT_INCOMPATIBLE`. Resolve: send
  `job.ack{accepted:false, reason}` — NACK is "the agent declines the job"
  and the hub fails with `AGENT_INCOMPATIBLE`... that mislabels it. Final:
  **`job.ack` stays acceptance-only** (`{accepted:boolean,reason?}` where
  `accepted:false` is reserved for capability NACKs → `AGENT_INCOMPATIBLE`);
  a resolution failure happens *after* `accepted:true` and reports via
  `run.complete{FAILED, errorType:"SECRET_RESOLUTION_FAILED"}` naming the
  key+source — matching how in-process runs fail post-RUNNING on
  `resolveImportSecrets` errors... except in-process fails *before*
  RUNNING. Cleanest consistent semantic: **resolve → ACK**. Resolution
  failure → `job.ack{accepted:false, reason:"SECRET_RESOLUTION_FAILED: …"}`
  and the hub maps NACK reason `SECRET_RESOLUTION_FAILED` to
  `FAILED`+that errorType instead of `AGENT_INCOMPATIBLE`. The ack payload
  gains nothing — hub inspects `reason`. This keeps exactly one
  decline-frame while error semantics stay honest.
- Generator loop: for each yielded `DiscoveredAsset` → append to batch;
  flush when `assets.length === 100` or serialized batch ≥ 1 MB. A *single*
  asset whose serialization exceeds ~1 MB → `run.error
  {errorType:"ASSET_TOO_LARGE"}` and continue (never attempt to send it).
  `ctx.reportPhase` → `phase` frame. `ctx.signal` = the job's
  AbortController; `ctx.logger` = runId-bound agent logger.
- `cancel` frame → `activeJobs.get(runId).controller.abort()`; the
  generator's abort surfaces as `AbortError` → `run.complete
  {result:"CANCELLED"}`.
- Generator throw (non-abort) → `run.complete{FAILED, errorType, errorMessage}`
  with `maskSecretValues` applied (FR-012 discipline — importer bugs must
  not leak resolved values).
- Generator end → `run.complete{result:"COMPLETED"}`.
- Session close → abort every active job; no frames sent after close.
- `heartbeat` sends real `currentJobs`/`activeRunIds`.

**Flagged for ADR-116 Amendment 2** — the NACK-reason mapping
(`SECRET_RESOLUTION_FAILED` → `FAILED`, all others → `AGENT_INCOMPATIBLE`)
is contract semantics.

## R12 — Metrics & error codes

**Decision**:

- `agent_jobs_total{agent,result}` — inc'd once at each remote terminal
  transition; `agent_assets_received_total{agent,importer}` — inc'd per
  asset accepted into the run pipeline (batch receipt).
- `ERROR_CODES` += `AGENT_LOST`, `AGENT_UNAVAILABLE`, `AGENT_INCOMPATIBLE`,
  `ASSET_TOO_LARGE` (the exact set ADR-116 item 10 lists for this spec;
  `AGENT_OFFLINE` landed in 026).
- No new audit actions — `import_runs.agentId` is the executor record
  (ADR-116 #12); dispatch frequency makes per-job audit rows the
  `agent_sessions`-class noise the audit model excludes.

## R13 — Docs in the same change

- `docs/agent-protocol.md` — replace "Reserved types (027)" with the full
  job section (payloads, ordering, bounds, failure matrix R7).
- `docs/agents.md` — remote execution section: capacity, dispatch/ack env
  overrides, failure semantics, "runs never resume".
- `docs/openapi.yaml` + regenerated `docs/api.md` (`pnpm docs:api`) per
  ADR-104 — config `agentId` fields, new agent endpoints, run `agentId`/
  `agentName`, `OFFLINE_AGENT`, new error codes.
- `docs/ux.md` — Execution selector, executor badges, attention item;
  `CONTEXT.md` — no new canonical terms (job/dispatch stay wire vocabulary).

## Resolved boundary summary

- **Hub**: config binding + validation, PENDING+dispatch, asset
  validation/upsert/reconciliation/suggestions, run bookkeeping, cancel
  source-of-truth, drift flag, UI surfaces, metrics, recovery.
- **Wire**: the seven frames above — secret *names* only.
- **Agent**: capacity/compiled-set check, secret resolution, generator
  execution, batching, abort, terminal frames.
