# Feature Specification: URL Check Agent-Vantage Probe Bounds — bounded, cancellable remote probe execution

**Feature Branch**: `052-url-check-probe-bounds`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "Operational bounds (G1) · P1 — from `researches/url_check_monitoring_gap_analysis.md`: add Agent-vantage concurrency/rate limiting, cancellation, and timeout/disconnect/late-result semantics so scheduled URL Check probes on Import Agents are admission-controlled and promptly cancellable, closing the FR-011 gap where configured system bounds only apply to Hub-vantage probes; amend ADR-124 if execution contract surfaces change."

## Clarifications

### Session 2026-11-01

- Q: When due Agent-vantage probes exceed the configured in-flight bound, what should happen to the excess scheduled slots? → A: Bounded deferral — excess probes wait in a bounded queue and execute as capacity frees; only work beyond the deferral bound records MISSED. (Ratifies FR-003 and US1 scenarios 2–3 as written.)

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Agent-vantage probes respect system bounds (Priority: P1)

An operator runs many URL checks whose monitoring setup executes on an Import Agent. When the scheduler finds a batch of due checks for that agent — for example, when a backlog drains after hub downtime — dispatch is admission-controlled: no more than a configured maximum number of probes run concurrently against that agent, and new dispatches start no faster than a configured rate. Work beyond the bound is deferred inside a bounded queue; work that cannot be admitted within the bound is recorded as a missed slot — never silently dropped and never deferred without limit.

**Why this priority**: Today, configured concurrency and rate bounds only apply to Hub-vantage probes. An unbounded burst of due Agent-vantage checks can open a large number of simultaneous outbound requests from the agent host, starving the agent's import work and the probed targets. FR-011 of feature 051 requires system-level bounds for every vantage; this is the missing half.

**Independent Test**: configure more due checks on one Agent-vantage setup than the in-flight bound, force them all due in one sweep, and verify concurrent executions on that agent never exceed the bound, excess work is deferred or recorded missed per the saturation contract, and each scheduled slot still produces exactly one observation.

**Acceptance Scenarios**:

1. **Given** more due Agent-vantage checks than the configured in-flight bound for one agent, **When** the scheduler dispatches them, **Then** concurrently executing probes on that agent never exceed the bound.
2. **Given** an agent at its in-flight bound, **When** further checks come due, **Then** they wait in a bounded deferral and execute as capacity frees, each still recording exactly one observation.
3. **Given** deferral capacity is also exhausted, **When** a scheduled slot cannot be admitted, **Then** a MISSED observation is recorded under the coverage-gap semantics — never a silent drop and never an unbounded delay.
4. **Given** one agent saturated at its bound, **When** probes come due for a different agent or for Hub vantage, **Then** they dispatch unaffected within their own configured bounds.

---

### User Story 2 - Cancellation and finalize integrity (Priority: P1)

When a dispatched agent probe can no longer produce a meaningful result — its dispatch deadline passes or the agent session drops — the system cancels the in-flight work promptly instead of letting the request run to its full timeout on the agent, and it finalizes the scheduled slot exactly once. A result that arrives after finalization is discarded: it cannot create a second observation and cannot rewrite the recorded one.

**Why this priority**: A timed-out or orphaned fetch still occupies the agent's capacity and holds a connection to the target for up to the probe timeout; under saturation that waste compounds. There is currently no cancellation path at all — a timed-out hub dispatch or a disconnected session leaves the agent's fetch running. Prompt cancellation frees bounded capacity, and the one-slot-one-observation invariant is what keeps availability metrics trustworthy under every failure mode.

**Independent Test**: dispatch a probe to an agent pointing at a deliberately slow endpoint, let the dispatch deadline pass, and verify the agent-side request aborts, exactly one missed-slot observation exists, and the late result produces no further record.

**Acceptance Scenarios**:

1. **Given** an in-flight agent probe, **When** the hub-side dispatch deadline expires, **Then** the slot finalizes once under missed-slot semantics and the agent is signalled to abort the request.
2. **Given** in-flight agent probes, **When** the agent session disconnects, **Then** the hub finalizes each affected slot once as agent-offline-missed and the agent aborts its local requests promptly.
3. **Given** a probe result that arrives after its slot already finalized, **When** the result reaches the hub, **Then** it is ignored — no second observation is written and the recorded one is unchanged.
4. **Given** a check disabled or deleted while a probe is in flight, **When** the probe completes or is cancelled, **Then** at most one observation is recorded for that slot and no further probes are scheduled for the check.
5. **Given** a cancellation signal for a probe that already completed or is unknown, **When** the agent receives it, **Then** it is a safe no-op.

---

### User Story 3 - Documented, observable bounds (Priority: P2)

An operator can discover and tune the Agent-vantage bounds through deployment configuration with documented defaults, and can observe saturation from service telemetry that uses bounded-cardinality labels only.

**Why this priority**: Bounds an operator cannot find or observe will be misconfigured or never noticed; telemetry for the new control surfaces must stay inside the established metric-label cardinality budget.

**Independent Test**: read the deployment documentation, set a non-default bound, confirm it takes effect at runtime, and confirm saturation is visible in metrics with no per-check or per-URL labels.

**Acceptance Scenarios**:

1. **Given** the deployment and URL Check documentation, **When** an operator looks for probe-bound settings, **Then** every bound has a documented variable, default, and valid range.
2. **Given** agent-vantage saturation, **When** service metrics are scraped, **Then** queue/saturation signals appear under bounded enum labels only.

---

### Edge Cases

- **Hub restart mid-dispatch**: in-memory pending dispatches are lost; unrecorded slots reconcile as missed via the existing sweep/backlog machinery — still exactly one observation per slot.
- **Agent reconnects with a stale result**: a result for a probe whose session died is ignored; reconnect must not resurrect a finalized slot.
- **Slow endpoint inside the bound**: a probe holding an in-flight slot for its full timeout defers siblings behind it — that is the bound working, and sibling checks on other vantages/agents remain unaffected.
- **Saturation is not agent-offline**: a slot missed because the bound was saturated is recorded distinguishably from a slot missed because the agent was offline, so operators can tell "monitor overloaded" from "agent down".
- **Cancel races completion**: a cancellation signal landing after the probe already replied is a no-op; the recorded result stands.
- **Over-dispatch by a misbehaving hub**: even though hub and agent ship in lockstep, the agent enforces its own in-flight bound — excess probe frames are deferred or explicitly refused per the contract, never executed without bound.
- **Check disabled while its probe is queued or in flight**: the queued dispatch is dropped or the in-flight probe is allowed to complete per the existing disable semantics; in every case the slot yields at most one observation and nothing new is scheduled.
- **Per-agent isolation**: a backlog draining for one agent must not starve probes for other agents or for Hub-vantage checks.

## Requirements _(mandatory)_

### Functional Requirements

**Admission control**

- **FR-001**: Agent-vantage probe execution MUST be bounded by a configurable maximum number of concurrently in-flight probes per Import Agent, enforced so the bound holds regardless of how many checks come due at once.
- **FR-002**: Agent-vantage dispatch MUST be rate-bounded by a configurable system-level rate, so a drained backlog cannot burst onto an agent faster than the configured rate.
- **FR-003**: Demand exceeding the in-flight bound MUST wait in a bounded deferral; demand exceeding the deferral bound MUST record the slot as MISSED — never silently dropped and never deferred without limit.
- **FR-004**: A slot missed because of saturation MUST be recorded distinguishably from a slot missed because the agent was offline, in both the stored error classification and service telemetry.
- **FR-005**: Bounds MUST isolate vantages and agents: saturation for one agent MUST NOT delay or drop probes for other agents, and MUST NOT consume the Hub-vantage probe bound.
- **FR-006**: The Import Agent MUST enforce its own in-flight bound on probe work independent of hub behavior; excess probe frames MUST be deferred or explicitly refused — never executed without bound.

**Cancellation**

- **FR-007**: The system MUST provide a way to signal cancellation of a specific in-flight agent probe; on receiving it the agent MUST abort the underlying request promptly.
- **FR-008**: The hub MUST signal cancellation when it finalizes a dispatched probe without a result (dispatch deadline expiry); the agent MUST abort all of its in-flight probes when its session closes.
- **FR-009**: A cancellation signal for an unknown or already-completed probe MUST be a safe no-op.

**Finalize integrity**

- **FR-010**: Every scheduled slot MUST produce at most one observation under every path: success, failure, timeout, cancellation, saturation, disconnect, or hub restart.
- **FR-011**: A probe result arriving after its slot finalized MUST be discarded without creating an observation or mutating the recorded one.
- **FR-012**: A timed-out, disconnected, or cancelled dispatch MUST record under the existing missed-slot semantics (MISSED with the matching error classification) — never as an endpoint failure and never left unrecorded.
- **FR-013**: Probe isolation MUST hold under the bounds: one slow or failing endpoint MUST NOT block checks beyond the documented deferral behavior, and a saturated queue MUST NOT deadlock scheduling for other checks.

**Configuration, telemetry, and contract surfaces**

- **FR-014**: Every bound MUST be configurable at the system level through deployment configuration with a documented default and a valid range; invalid values MUST be clamped or rejected predictably.
- **FR-015**: Any new telemetry for deferral depth, saturation, or cancellation MUST use bounded enum labels only — no check identifier, URL, or agent identifier as a label.
- **FR-016**: If the resolution adds or changes a wire frame, the protocol version, an error or disconnect reason, or an enumerated tuning variable, ADR-124 (and any ADR it extends, including the frame list and protocol version in ADR-116) MUST be amended in the same change.
- **FR-017**: The URL Check user guide and the deployment/environment documentation MUST describe the bounds, their defaults, valid ranges, and saturation behavior in the same change.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Under a burst of due Agent-vantage checks equal to 10× the configured in-flight bound, concurrent probe executions on the agent never exceed the bound and 100% of scheduled slots produce exactly one observation.
- **SC-002**: When a dispatch deadline expires or a session drops, the in-flight agent request aborts promptly (frees its slot well before the probe's full timeout would elapse).
- **SC-003**: Across timeout, disconnect, cancellation, saturation, and restart scenarios, automated tests show zero duplicate observations and zero silently lost scheduled slots.
- **SC-004**: All bounds are adjustable through documented deployment configuration without code changes, and an operator can identify a saturated agent from service telemetry alone.
- **SC-005**: Hub-vantage behavior is unchanged — existing concurrency and rate configuration continues to apply and existing monitoring tests still pass.

## Assumptions

- Hub and agent ship in lockstep (ADR-124): extending the wire contract — a new frame and a protocol-version bump — is an allowed mechanism, not a backward-compatibility project.
- The observation outcome model (`SUCCESS`/`FAILURE`/`MISSED`) and the availability/error-rate/coverage-gap formulas ratified in ADR-124 are unchanged; this feature controls whether and when probes execute, not how metrics interpret outcomes.
- A slot the monitor chooses not to complete (timeout, cancellation, saturation overflow) is a missed slot under the conservative SLI — consistent with ADR-124's dispatch-rejection semantics — not an endpoint failure.
- Per-agent bounds are the primary isolation unit; the saturation contract is defined per agent, with agent-side enforcement as defense-in-depth under lockstep deployment.
- Disabling a check mid-flight keeps the feature-051 edge-case rule: an in-flight probe may finish and record its real outcome; this feature adds explicit cancellation on dispatch deadline and session close, and does not otherwise change disable/delete semantics.
- No new catalog-facing UI is required: the surfaces are deployment configuration, the agent wire contract, documentation, and telemetry.
- Defaults for the new bounds are chosen so a typical deployment (a handful of agents and checks) sees no behavioral change beyond the added safety limits.
