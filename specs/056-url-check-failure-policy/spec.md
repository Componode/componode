# Feature Specification: URL Check repeated-failure policy & spec-status reconciliation

**Feature Branch**: `056-url-check-failure-policy`

**Created**: 2026-11-02

**Status**: Shipped

**Input**: User description: "Phase 4 — Decision-only follow-up (from `researches/url_check_monitoring_gap_analysis.md`): explicitly state the repeated-failure behavior for URL Check probes and reconcile Feature 051's stale `Status: Draft`."

## Clarifications

### Session 2026-11-02

- Q: What should the ratified v1 contract be when a URL Check fails repeatedly — does the shipped continue-and-record behavior stand, or should sustained failure trigger different runtime behavior? → A: Auto-disable after N failures — the check disables itself after a configurable consecutive-failure count; the feature includes the runtime change.
- Q: How should the consecutive-failure auto-disable threshold be configured on checks? → A: Global default + per-check — a global tunable supplies the default threshold and each check may override it; the tunable's zero/disabled value means checks never auto-disable.
- Q: Which observation outcomes should count toward the consecutive-failure streak that triggers auto-disable? → A: FAILURE + MISSED — any non-success observation advances the streak and only SUCCESS resets it, so monitor-side gaps count the same as endpoint failures.
- Q: Which single status value should mark a spec whose feature has shipped? → A: Shipped — new canonical terminal value matching the roadmap's "Shipped" section heading; earlier `Implemented`/`Complete` values are historical.
- Q: How far should the spec-status reconciliation sweep — just the URL Check program specs, or every shipped spec still marked Draft? → A: All specs normalized — every shipped spec's status becomes `Shipped`, including normalizing historical `Implemented`/`Complete` values for a uniform vocabulary.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Predictable behavior for a chronically failing check (Priority: P1)

An administrator configures a URL Check and the endpoint starts failing every
probe — DNS stopped resolving, the host is down, or the success policy no
longer matches. The administrator needs the product to behave predictably
over the following hours and days — and to be able to read, in the product's
own documentation, exactly what will happen: how long probing continues,
whether the check ever gives up on its own, whether anyone is notified, and
how to make it stop or restart.

**Why this priority**: This is the explicit contract the original research
asked for ("define the failure policy for repeated probe errors") that was
never written down. Operators should not have to guess — and an unbounded
probe loop against a dead endpoint wastes agent/hub capacity forever. The
auto-disable decision makes the behavior both predictable and bounded.

**Independent Test**: Fully testable end-to-end: point a check at an endpoint
that always fails, observe that probing continues at cadence until the
configured consecutive-failure threshold, that the check then disables
itself and accrues no further observations, and that re-enabling resumes it.

**Acceptance Scenarios**:

1. **Given** an enabled check whose endpoint fails every probe, **When**
   scheduled slots execute, **Then** the check keeps running on its
   configured cadence and records exactly one observation per slot.
2. **Given** the same chronically failing check, **When** it accumulates
   consecutive failures up to its configured threshold, **Then** the check
   disables itself, stops probing, and shows a distinguishable auto-disabled
   state; there are no in-slot retries, no backoff, and no notifications,
   and re-enabling is a manual act that resets the streak.
3. **Given** an auto-disabled (or manually disabled) check, **When** time
   passes, **Then** no new observations accrue — consistent with the
   already-shipped "disabled checks accrue no rows" semantics.

---

### User Story 2 - Truthful status on shipped specifications (Priority: P2)

A maintainer or agent opens a feature spec under `specs/` to understand what
is committed. Most specs whose features have already shipped and merged
still read `Status: Draft`, and the few that don't use two different
terminal values — so the reader cannot tell in-flight work from settled
work, and even shipped work is labeled inconsistently. The gap analysis
already flagged Feature 051 for exactly this.

**Why this priority**: Artifact hygiene, not a runtime gap — but the spec
directory is the project's source of truth for "what is decided", and stale
Draft markers erode that trust. It is scoped below the contract decision
because it carries no user-facing behavior.

**Independent Test**: Fully testable by inspecting the status line of every
spec under `specs/` whose feature has shipped: each shows `Shipped`, and no
shipped spec still reads `Draft` or a legacy terminal value.

**Acceptance Scenarios**:

1. **Given** every spec under `specs/` whose feature has shipped, **When**
   its status line is read, **Then** it shows `Shipped` — including specs
   that previously read `Implemented` or `Complete`.
2. **Given** the need for a repeatable convention, **When** the status
   vocabulary is decided, **Then** `Shipped` is the single terminal value —
   matching the roadmap's section heading — applied uniformly across the
   spec directory; future specs flip to it when they ship.

---

### Edge Cases

- **Threshold reached mid-streak**: once the consecutive-failure count hits
  the check's effective threshold the check disables; slots that fall due
  afterwards produce no rows at all (disabled-check semantics), so the
  window's coverage gap does not inflate with `MISSED` rows after shutdown.
- **Success breaks the streak**: a `SUCCESS` observation resets the
  consecutive-failure count to zero; only unbroken failure runs trigger
  auto-disable.
- **Monitor-side vs endpoint failure**: `MISSED` rows (agent offline, hub
  downtime, saturation) advance the streak the same as `FAILURE` — a check
  can auto-disable while its monitor is down, and stays off until manual
  re-enable. The coverage-gap display distinction is unchanged: `MISSED`
  still renders as monitor-side downtime, never endpoint failure.
- **Manual re-enable**: re-enabling an auto-disabled check is an explicit
  operator act; the streak starts fresh and the next `SUCCESS` behaves
  normally.
- **Auto-disable not configured**: when the effective threshold resolves to
  zero/disabled — global tunable off and no per-check override — the check
  never auto-disables; shipped continue-and-record behavior applies
  unchanged.
- **In-flight specs**: specs whose features have not shipped keep
  `Status: Draft` — only shipped specs normalize to `Shipped`; this feature's
  own spec flips when it ships, per the convention it records.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The project MUST ratify and record an explicit repeated-failure
  contract for URL Check probes: a check continues executing on its
  configured cadence regardless of consecutive failures, every scheduled
  slot produces exactly one observation (`SUCCESS`, `FAILURE`, or `MISSED`),
  there are no in-slot retries and no backoff — and the check disables
  itself after a configurable number of consecutive failures, where the
  threshold is a global default that each check may override.
- **FR-002**: The system MUST maintain a consecutive-failure count per check
  across recorded observations: any non-`SUCCESS` outcome (`FAILURE` or
  `MISSED`) increments the count and a `SUCCESS` outcome resets it to zero.
- **FR-003**: When a check's consecutive-failure count reaches its effective
  threshold, the system MUST disable the check automatically: subsequent
  scheduled slots produce no observations, the state is distinguishable
  from a manual disable to the operator, and the transition is auditable.
- **FR-004**: Re-enabling an auto-disabled check MUST be a manual operator
  action; re-enabling resets the consecutive-failure count and resumes the
  configured cadence.
- **FR-005**: The decision MUST be recorded on the canonical architecture
  decision record surface for URL Check monitoring (an amendment to the
  existing URL Check ADR set) so the contract is discoverable where the
  other probe semantics are ratified.
- **FR-006**: User-facing monitoring documentation MUST state the contract
  in operator terms — a failing check keeps probing until its consecutive-
  failure threshold, then disables itself; the operator re-enables it
  manually; no notifications are sent.
- **FR-007**: Alerting/notifications on check failure MUST remain out of
  scope; the recorded decision states this boundary explicitly.
- **FR-008**: Every spec under `specs/` whose feature has shipped MUST have
  its `Status` field set to `Shipped` — including normalizing historical
  `Implemented`/`Complete` values — so the spec directory's status
  vocabulary is uniform.
- **FR-009**: `Shipped` is the canonical terminal status for a spec whose
  feature has shipped, and `Draft` marks in-flight work; the convention
  (status flips to `Shipped` when the feature ships) MUST be written down
  where spec authors will find it.

### Key Entities

- **URL Check**: existing monitored-endpoint configuration; gains a
  consecutive-failure notion and an auto-disabled state distinct from
  manual disable.
- **URL Check Observation**: existing per-slot outcome record
  (`SUCCESS`/`FAILURE`/`MISSED`); the consecutive-failure count is derived
  from or tracked alongside it. Unchanged in shape.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An administrator can state — from user-facing documentation
  alone, in one reading — what a check that fails every probe will do
  (probe at cadence, record each attempt, auto-disable at its threshold,
  send no alerts) and how to restart it.
- **SC-002**: 100% of the contract points (one observation per scheduled
  slot, no retry/backoff, auto-disable threshold and streak semantics,
  manual re-enable, no alerting) appear on the canonical decision-record
  surface and in the user guide.
- **SC-003**: In a controlled run, a check reaching its consecutive-failure
  threshold produces zero additional observations until manually
  re-enabled, and the auto-disabled state is distinguishable from a manual
  disable in the interface and in audit history.
- **SC-004**: Zero shipped specs under `specs/` display `Status: Draft` or a
  legacy terminal value; 100% of shipped specs show `Shipped`.

## Assumptions

- The streak counts every non-`SUCCESS` observation — including monitor-side
  `MISSED` rows — per the ratified decision; the shipped default threshold
  value is an engineering parameter settled in the plan.
- `Shipped` is the canonical terminal status, applied uniformly — historical
  `Implemented`/`Complete` values normalize to it so `Draft` vs `Shipped`
  is the only distinction a reader must learn.
- The status normalization is repo-wide: every spec under `specs/` whose
  feature shipped moves to `Shipped` in this feature — including the four
  URL Check program specs the gap analysis flagged.
- ADR-124 is the expected home for the recorded decision (it already owns
  probe/execution semantics); the plan confirms the exact surface and
  amendment numbering.
- No schema-level rework of observations is expected: the streak derives
  from existing outcome rows or a minimal per-check counter, per the plan.
