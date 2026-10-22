# Data Model: Agent Operations Observability

## Persistence changes

### `import_agents` — one new column (migration `019_agent_ops_observability`)

| Column | Type | Notes |
|---|---|---|
| `"reportedStatus"` | `jsonb NULL` | Latest agent-reported ops snapshot; replace-on-write per heartbeat carrying `ops`. `NULL` = "not reported by this agent" (drives the FR-011 empty state). Quoted camelCase per the repo's column convention. |

No CHECK constraint — the shape is wire-validated by the heartbeat Zod
schema before persistence, and the column is read-back verbatim.

Stored shape (mirrors the wire `ops` object plus receipt context):

```json
{
  "reportedAt": "2026-10-22T14:03:11.000Z",
  "receivedAt": "2026-10-22T14:03:11.120Z",
  "uptimeSeconds": 4812,
  "activeJobs": 1,
  "jobs": { "assigned": 14, "completed": 11, "failed": 2, "cancelled": 1 },
  "assetsStreamed": 1932,
  "credentialTests": { "dispatched": 3, "succeeded": 2, "failed": 1 },
  "secretResolutionFailures": 1,
  "reconnects": 2
}
```

`receivedAt` is hub-stamped so freshness does not depend on agent clock
correctness; `reportedAt` is the agent's own timestamp.

## In-memory state

### `LiveSession` (`AgentSessionService`)

- `lastContactAt` already exists (refreshed per accepted frame) — exposed
  read-only through a new reader method `lastContactFor(agentId)` and
  surfaced as `lastHeartbeatAt` on the detail payload. Not persisted:
  durable freshness floor remains `import_agents.last_seen_at`.

## Read-surface deltas

### `GET /api/v1/agents/{id}` → `agent`

- `reportedStatus: AgentReportedStatus | null`
- `lastHeartbeatAt: string | null` — live session only; `null` when no
  session is established (UI falls back to `lastSeenAt`)
- `lastDisconnectReason: string | null` — latest closed
  `agent_sessions.disconnectReason` for the agent

### `GET /api/v1/agents` → `agents[]`

- `lastDisconnectReason: string | null` — latest closed session per agent
  (single grouped query over `agent_sessions`, not N+1)
- `lastHeartbeatAt: string | null` — live session `lastContactAt`; `null`
  when no session
- `reportedStatus: AgentReportedStatus | null` — same snapshot as detail
  (the row is already loaded; no extra query)

`lastSeenAt`, `runningJobs`, `activeRuns[]` unchanged.

## Wire contract delta (`packages/core` `contracts/agent-protocol.ts`)

`heartbeatPayloadSchema` (strict) gains optional `ops`:

| Field | Type | Constraint |
|---|---|---|
| `ops.reportedAt` | `string` | ISO datetime, `.datetime()` |
| `ops.uptimeSeconds` | `int ≥ 0` | process uptime |
| `ops.activeJobs` | `int ≥ 0` | mirrors `currentJobs` |
| `ops.jobs.{assigned,completed,failed,cancelled}` | `int ≥ 0` | cumulative since process start |
| `ops.assetsStreamed` | `int ≥ 0` | cumulative |
| `ops.credentialTests.{dispatched,succeeded,failed}` | `int ≥ 0` | cumulative |
| `ops.secretResolutionFailures` | `int ≥ 0` | counts only — never key names |
| `ops.reconnects` | `int ≥ 0` | reconnect attempts since start |

`AGENT_PROTOCOL_VERSION` bumps — additive change, lockstep signal
(research D4).

## Agent-local surfaces (no persistence)

- `/healthz` — `200 {status:"ok", uptimeSeconds}` always once config loads.
- `/readyz` — `200 {ready:true, activeJobs}` when stream established;
  `503 {ready:false, state:"connecting"|"backoff"|"no-credential"}` otherwise.
- `/metrics` — Prometheus text; agent-local series per research D7 plus
  `prom-client` default process metrics.

## State transitions

None new. `reportedStatus` is a replace-on-write attribute, not a state
machine; session/run lifecycles unchanged.
