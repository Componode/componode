# Contract: Hub API & metrics deltas

## Read-surface deltas (session-authenticated, `agent:read`)

### `GET /api/v1/agents/{id}` — `agent` gains

| Field | Type | Source |
|---|---|---|
| `reportedStatus` | `AgentReportedStatus \| null` | `import_agents."reportedStatus"` — `null` = "not reported" |
| `lastHeartbeatAt` | `string \| null` | live session `lastContactAt`; `null` when no session |
| `lastDisconnectReason` | `string \| null` | latest closed `agent_sessions.disconnectReason` |

### `GET /api/v1/agents` — each `agent` gains

| Field | Type | Source |
|---|---|---|
| `lastDisconnectReason` | `string \| null` | latest closed `agent_sessions.disconnectReason` (grouped query) |
| `lastHeartbeatAt` | `string \| null` | live session `lastContactAt`; `null` when no session |
| `reportedStatus` | `AgentReportedStatus \| null` | `import_agents."reportedStatus"` — same snapshot as detail |

Both endpoints remain side-effect-free GETs; `docs/openapi.yaml` updated
per ADR-104.

## Hub Prometheus series additions (`/metrics`)

| Series | Type | Labels | Observed at |
|---|---|---|---|
| `agent_dispatch_wait_seconds` | histogram | `agent` | `job.assign` send (run created → dispatched) |
| `agent_remote_job_duration_seconds` | histogram | `agent, importer` | `run.complete` finalization |
| `agent_session_duration_seconds` | histogram | `agent, reason` | session close |
| `agent_last_contact_timestamp_seconds` | gauge | `agent` | every accepted frame |

Buckets follow existing histogram conventions (`import_run_duration_seconds`
for job duration; dispatch wait `[1, 5, 15, 30, 60, 120, 300, 600]`).

## Protocol delta (`agent-protocol.ts` + `docs/agent-protocol.md`)

- `heartbeat` payload gains optional strict `ops` snapshot
  (shape in data-model.md); `AGENT_PROTOCOL_VERSION` bumped.
- Hub persists `ops` to `import_agents."reportedStatus"` on receipt
  (replace-on-write); freshness signal remains the per-frame
  `lastContactAt` bump — unchanged semantics for heartbeats without `ops`.

## Audit

No new audit events — operational telemetry, not lifecycle transitions
(ADR-052 asymmetry: `agent_sessions` already holds the operational side).
