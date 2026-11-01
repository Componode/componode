# Agent Frame Contract — URL Check Probe Bounds (spec 052)

Extends the spec-051 probe frame family
([../051-url-check-monitoring/contracts/agent-frames.md](../../051-url-check-monitoring/contracts/agent-frames.md)).
`AGENT_PROTOCOL_VERSION`: 4 → **5** (lockstep; hub+agent deploy
together; a v4 peer is refused `protocol_mismatch`).

## `url_check.probe.cancel` (hub → agent) — NEW

```json
{
  "type": "url_check.probe.cancel",
  "payload": { "probeId": "<uuid>" }
}
```

- Sent when the hub finalizes a dispatched probe without a result —
  currently the `dispatchUrlCheckProbe` deadline (`timeoutMs +
transport grace`). Best-effort: sent only while the session socket
  is open.
- Payload-correlated by `probeId` (ADR-124 item 1) — same family as
  `url_check.probe`, not the `runId`-correlated job `cancel`.
- Agent behavior: abort the matching in-flight fetch immediately
  (`AbortSignal` composed with the probe timeout inside
  `executeHttpProbe`). Unknown or already-settled `probeId` → no-op.
- An aborted fetch produces `errorType: "ABORTED"` internally; the
  agent may still send `url_check.probe.result` — the hub ignores it
  (pending entry already deleted).

## `url_check.probe.result` (agent → hub) — extended semantics

Payload shape unchanged. `errorType` now admits **`SATURATED`**
(`URL_CHECK_ERROR_TYPES` extension):

```json
{
  "type": "url_check.probe.result",
  "payload": {
    "probeId": "<uuid>",
    "outcome": "SUCCESS | FAILURE",
    "errorType": "... | SATURATED | ..."
  }
}
```

- The agent answers `{outcome:"FAILURE", errorType:"SATURATED"}`
  **immediately** when it receives a probe while at its in-flight cap
  (`URL_CHECK_MAX_PROBES`, default 8) — explicit refusal, never silent.
- The hub maps a `SATURATED` result to a `MISSED(SATURATED)`
  observation — the slot never executed; it is not an endpoint
  failure.

## Hub behavior (delta vs. spec 051)

- `dispatchProbe` → `dispatchAgentProbe` now runs inside a **per-agent
  bounded pool**: `URL_CHECK_AGENT_CONCURRENCY` (default 4) in-flight,
  `URL_CHECK_AGENT_RATE_LIMIT` (default 20) dispatches per
  `URL_CHECK_SWEEP_INTERVAL_MS`, `URL_CHECK_AGENT_QUEUE_MAX` (default 100) deferral bound. Deferral overflow → `MISSED(SATURATED)` via the
  normal observation path; nothing is silently dropped.
- Dispatch deadline expiry → send `url_check.probe.cancel`, delete the
  pending entry, reject `AGENT_PROBE_TIMEOUT` → `MISSED(TIMEOUT)`.
- Session close → pending probes reject `AGENT_OFFLINE` → `MISSED`
  (unchanged hub behavior; the agent-side abort is new, below).
- A `url_check.probe.result` with no pending entry → ignored
  (unchanged; now covered by an explicit test).

## Agent behavior (delta vs. spec 051)

- Per-session probe runner holds `Map<probeId, AbortController>`:
  frames beyond `URL_CHECK_MAX_PROBES` in-flight are refused with
  `SATURATED`; accepted probes run with a composed abort+timeout
  signal.
- `url_check.probe.cancel` frame → abort that probe's controller.
- Socket `close` → abort **all** in-flight probe controllers (mirrors
  `executor.abortAll()`); result sends on a dead socket are swallowed
  — the hub already finalized those slots `AGENT_OFFLINE`-missed.
- Agent ops metrics expose `agent_url_check_probes_in_flight` (gauge)
  and `agent_url_check_probes_total{result}` so the saturated agent
  itself is identifiable at its own scrape target.

## Unchanged

- `secretRefMap`/`authKeyNames` carry names only — no secret values
  cross the wire (ADR-117). The cancel frame carries only `probeId`.
- URL re-validation against `urlSafetyError` on the agent (ADR-106).
- One vantage per setup; every observation records its vantage.
- Job frames, handshake, heartbeat, close/error semantics.
