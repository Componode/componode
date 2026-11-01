# Data Model: URL Check Agent-Vantage Probe Bounds (spec 052)

No new entities or tables. This feature changes **one enumerated value
set** and adds **in-memory runtime state** only.

## Schema change

### `url_check_observations.errorType` — enum extension

`URL_CHECK_ERROR_TYPES` gains `SATURATED`:

```text
DNS | CONNECT | TLS | TIMEOUT | HTTP_STATUS | POLICY_BLOCKED |
AGENT_OFFLINE | ABORTED | SATURATED | OTHER
```

- **Meaning**: the scheduled slot could not execute because probe work
  exceeded a configured bound — hub per-agent deferral overflow, or the
  agent refused a frame while at its in-flight cap. Recorded on
  `MISSED` observations only (monitor-side downtime, per ADR-124 item
  5); an agent-originated `SATURATED` result maps to `MISSED`, never
  `FAILURE`.
- **Migration 026**: `ALTER` the `url_check_obs_error_type_check` CHECK
  constraint to admit the new member, using the same `inList` helper
  pattern as migration 025 (constants-driven; the
  check-constraint-helper test keeps constants and constraints in
  sync).
- **Read path**: `errorType` is already a bounded enum on the metrics
  endpoint and observation payloads — no API or response-shape change.

## In-memory runtime state (not persisted)

| State                    | Location                                            | Shape                                                                            | Lifetime                                                                                                                |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Per-agent dispatch pool  | `packages/backend/src/services/probe-dispatcher.ts` | `Map<agentId, PQueue>` — concurrency + intervalCap + `queue.size` deferral bound | Lazily created per agentId; process lifetime (rebuilt after restart; unrecorded slots reconcile via the existing sweep) |
| Pending probe dispatches | `agent-session-service.ts` (existing)               | `Map<probeId, PendingProbe>`                                                     | Deleted on result, deadline, or session close — deadline additionally sends `url_check.probe.cancel`                    |
| Agent in-flight probes   | `packages/agent/src/probe.ts`                       | `Map<probeId, AbortController>` + in-flight count                                | Created per `url_check.probe` frame; deleted when the handler settles; all aborted on session close                     |

## Invariants

- Exactly one observation per `(urlCheckId, scheduledAt)` under every
  finalize path (success, failure, timeout, cancel, saturation,
  disconnect, restart) — enforced by the single `recordObservation`
  writer plus existing sweep dedupe.
- `MISSED` rows never carry `httpStatus`/`durationMs` values from a
  late result — late results are discarded before the write path.
