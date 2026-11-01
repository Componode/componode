# Research: URL Check Agent-Vantage Probe Bounds (spec 052)

Phase 0 decisions for the G1 gap from
[researches/url_check_monitoring_gap_analysis.md](../../researches/url_check_monitoring_gap_analysis.md).
Every NEEDS CLARIFICATION in Technical Context resolved; all choices map
to spec FRs.

## R1 — Where the hub enforces per-agent admission control

**Decision**: a per-agent bounded dispatch pool inside
`probe-dispatcher.ts` — `Map<agentId, PQueue>` where each entry is
created lazily with `{concurrency: URL_CHECK_AGENT_CONCURRENCY,
intervalCap: URL_CHECK_AGENT_RATE_LIMIT, interval:
URL_CHECK_SWEEP_INTERVAL_MS}` and consulted for `queue.size` before
admission. `dispatchAgentProbe` wraps its existing body in
`agentQueue(agentId).add(...)`; when `size >=
URL_CHECK_AGENT_QUEUE_MAX` the slot records `MISSED(SATURATED)`
immediately through the existing `recordObservation` path.

**Rationale**: satisfies FR-001/002/003/005 with the same proven
mechanism hub-vantage already uses (p-queue concurrency + intervalCap),
while per-agent keys give the isolation FR-005 requires — one saturated
agent cannot consume another agent's or the hub-vantage bound. The map
is bounded by agent count.

**Alternatives considered**:

- _Extend the existing hub `p-queue` to also cover agent dispatches_ —
  rejected: p-queue concurrency is global, not per-agent; a burst for
  one agent would starve hub-vantage and other agents' work (violates
  FR-005).
- _Reject→MISSED immediately without deferral_ — rejected by the
  clarify session: bounded deferral preserves real measurements.
- _Freshness bound on deferred slots_ — rejected by the clarify
  session: deferral bounded by count only (option C declined).

## R2 — Cancellation surface

**Decision**: new frame `url_check.probe.cancel` (hub → agent) carrying
`{probeId}`, joining `agentMessageSchemas`; `AGENT_PROTOCOL_VERSION`
4 → 5. The hub sends it when `dispatchUrlCheckProbe`'s deadline expires
(`AGENT_PROBE_TIMEOUT`) — best-effort while the socket is open — then
settles the pending entry to `MISSED(TIMEOUT)` via the existing caller
mapping. The agent keeps a `Map<probeId, AbortController>` in its probe
runner and passes `signal` into `executeHttpProbe` (already supported).
On session `close`, the agent aborts every in-flight probe controller —
mirroring `executor.abortAll()` for jobs; no frame is possible on a dead
socket. Cancel for an unknown/completed `probeId` is a no-op (FR-009).

**Rationale**: the probe family is payload-correlated by `probeId`
(ADR-124 item 1) — the cancel frame belongs to that family, not to the
`runId`-correlated job `cancel`. Deadline-triggered cancel frees the
agent's in-flight slot immediately instead of letting the fetch run to
its full timeout (FR-007/008). Session-close abort mirrors the
ratified "session is the lifeline" rule for remote runs.

**Alternatives considered**:

- _Reuse the job `cancel` frame_ — rejected: `jobEnvelope` requires
  `runId` and routes to the remote-run handler; probes are not import
  runs (ADR-124 item 1, "Reuse job.assign/runId" alternative).
- _No cancel frame; rely on probe timeoutMs_ — rejected: leaves an
  orphaned fetch occupying agent capacity for up to 60 s per probe —
  exactly the gap evidence.
- _Cancel on check disable/delete too_ — deferred: 051's edge case
  already permits "finishes or is cancelled promptly"; disable does not
  gain an active-cancel path in this feature (keeps the contract
  surface minimal). A disabled check's in-flight probe still finalizes
  at most once (FR-010; US2 scenario 4).

## R3 — Agent-side bound shape

**Decision**: the agent enforces an in-flight cap `URL_CHECK_MAX_PROBES`
(env, default **8**) inside its probe runner. When a `url_check.probe`
frame arrives while at cap, the agent immediately replies
`url_check.probe.result{outcome:"FAILURE", errorType:"SATURATED"}` —
no agent-internal deferral.

**Rationale**: FR-006 wants defense-in-depth independent of hub
behavior, but a second deferral queue on the agent duplicates the hub's
bounded deferral and doubles the state to reason about. Under lockstep
the hub's per-agent bound (default 4) is tighter than the agent cap
(default 8), so refusal only triggers on a misbehaving/drifted peer or
misconfiguration — exactly the guard's purpose. The refusal is explicit
and observable, never silent.

**Alternatives considered**:

- _Agent-internal bounded queue_ — rejected: two deferral layers make
  latency and slot-accounting harder to reason about; the hub queue is
  the single deferral of record.
- _Cap equal to hub bound_ — rejected: leaves no headroom for
  cancel-in-flight lag; agent cap deliberately exceeds the hub bound.

## R4 — Saturated classification

**Decision**: `SATURATED` joins `URL_CHECK_ERROR_TYPES`
(`packages/core/src/constants/url-check.ts`). It is used for (a) hub
per-agent deferral overflow and (b) agent at-cap refusal, recorded as
`MISSED` observations — monitor-side unexecuted slots, consistent with
ADR-124 item 5 (`availability = SUCCESS / (SUCCESS + FAILURE + MISSED)`
and coverage-gap display). Requires migration 026 altering
`url_check_obs_error_type_check`. The hub maps a `SATURATED` result to
`MISSED(SATURATED)` rather than `FAILURE` — an agent refusal means the
slot never executed.

**Rationale**: FR-004 requires saturation misses to be distinguishable
from `AGENT_OFFLINE` misses; a bounded enum member is the established
mechanism (same enum already carries `AGENT_OFFLINE`, `ABORTED`).

**Alternatives considered**:

- _Reuse `OTHER`_ — rejected: fails FR-004 distinguishability.
- _New outcome value_ — rejected: outcome semantics are closed and
  ratified (`SUCCESS`/`FAILURE`/`MISSED`); `SATURATED` is a missed
  reason, not a new outcome.

## R5 — Finalize integrity under all paths

**Decision**: no new machinery needed beyond what exists plus tests.

- Late `url_check.probe.result` (no pending entry): already ignored in
  `agent-session-service.onFrame` — kept, gains an explicit test
  (FR-011).
- Session close: pending probes already reject `AGENT_OFFLINE` →
  `MISSED`; agent now aborts local fetches (R2).
- Hub restart: `nextProbeAt` only advances inside `recordObservation`'s
  transaction; unrecorded slots re-surface to the sweep — existing
  dedupe ensures at most one observation per `scheduledAt` (FR-010).
  An agent fetch completing during the gap sends a late result that is
  ignored; a re-dispatched slot may run twice but records once.
- `SATURATED` refusal: maps to `MISSED` (R4), not left unrecorded.

**Alternatives considered**: _DB unique constraint on
(urlCheckId, scheduledAt)_ — noted as optional belt-and-braces for the
tasks phase; the code paths already guarantee single-writer-per-slot
and a constraint would also harden future writers. Deferred to tasks
decision — if added it is a second change in migration 026.

## R6 — Env tunables (ADR-124 item 7 extension)

**Decision**: hub — `URL_CHECK_AGENT_CONCURRENCY` (default `4`, min 1;
max concurrent in-flight probes per agent), `URL_CHECK_AGENT_RATE_LIMIT`
(default `20`; dispatches per sweep interval per agent),
`URL_CHECK_AGENT_QUEUE_MAX` (default `100`; per-agent deferral bound).
Agent — `URL_CHECK_MAX_PROBES` (default `8`, min 1; local in-flight
cap). Core defaults land in `constants/url-check.ts` beside the
existing `*_DEFAULT` constants; hub uses `envInt`, agent uses its zod
env schema (`config.ts`).

**Rationale**: defaults keep the agent bound (4) below the agent cap
(8) so correct lockstep configs never refuse; `20/15s` matches the
existing hub rate semantics; queue 100 bounds worst-case wait to
~75 s at default rate — consistent with the clarify answer (count
bound, no freshness bound).

**Alternatives considered**: _one shared rate-limit var for both
vantages_ — rejected: `URL_CHECK_PROBE_RATE_LIMIT` is documented as
hub-vantage; a separate knob lets operators tune agent cadence
independently and keeps the ADR-124 inventory explicit.

## R7 — Telemetry (ADR-069 bounded labels)

**Decision**: hub — existing `url_check_probes_total{vantage, outcome,
errorType}` automatically exposes saturation via
`errorType="SATURATED"` and `vantage="AGENT"`; add label-free gauges
`url_check_agent_probes_in_flight` and
`url_check_agent_probe_queue_depth` (sums across agents — no agent
label, cardinality-safe). Agent ops metrics — `agent_url_check_probes_in_flight`
gauge and `agent_url_check_probes_total{result}` counter
(`result` ∈ success|failure|saturated|aborted) following the
`agent_credential_tests_total` precedent; identifying _which_ agent
saturates happens at the agent's own scrape target (per FR-015 the hub
never labels by agentId).

**Alternatives considered**: _per-agent hub metrics_ — rejected:
agentId is not a bounded enum label (ADR-069).

## R8 — Documentation and ADR surfaces

**Decision** (same-change, per ADR-104/ADR-fidelity and docs rules):

- `researches/adrs/ADR-124-*.md` — amendment: `url_check.probe.cancel`
  frame + protocol 5 (item 1), `SATURATED` error type (item 4), new env
  tunables (item 7), new metrics (item 8), `SATURATED`→`MISSED`
  mapping (item 5).
- `researches/adrs/ADR-116-*.md` — appended amendment back-pointer:
  frame enumeration gains `url_check.probe.cancel`,
  `AGENT_PROTOCOL_VERSION` becomes 5.
- `docs/agent-protocol.md` — new "Protocol v5" section beside the v4
  section.
- `docs/url-checks.md` — hub env table gains the three new vars;
  behavior section documents deferral/saturation/cancellation.
- `docs/import-agents.md` — env table gains `URL_CHECK_MAX_PROBES`;
  metrics table gains the two new series.
- `docs/openapi.yaml` — **unchanged** (no REST surface changes);
  `api-docs-contract` test continues to pass.

## Resolved NEEDS CLARIFICATION items

None remained after the clarify session — the saturation-semantics
question (bounded deferral, overflow → MISSED) is ratified in
`spec.md` Clarifications and implemented by R1/R4.
