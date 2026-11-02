# Research: URL Check repeated-failure policy & spec-status reconciliation

**Feature**: `056-url-check-failure-policy` | **Date**: 2026-11-02

Phase-0 findings. Every decision below is grounded in the shipped codebase;
file references are the seams implementation will touch.

## Decision 1 — Where the streak lives: counter column on `url_checks`

**Decision**: persist `consecutiveFailures INTEGER NOT NULL DEFAULT 0` on
`url_checks`, maintained atomically in the same transaction that writes the
observation.

**Rationale**: there are exactly two observation write paths —
`recordObservation()` in `packages/backend/src/services/probe-dispatcher.ts`
(single funnel for all finalized hub/agent outcomes and dispatch-time
`MISSED` rows) and the bulk `MISSED` writer in
`packages/backend/src/services/url-check-scheduler.ts`. Both already update
`url_checks` in-transaction, so incrementing the counter there is O(1) and
cannot drift. The alternative — deriving the streak from observation rows —
needs a per-write query _and_ a "count only since last enable" boundary
column anyway, because re-enable resets the streak (FR-004). The counter
resets naturally.

The existing `.where("enabled", "=", true)` guard on the
`url_checks` update inside `recordObservation` gives correct semantics for
free: a late-arriving result for an already-disabled check records its
observation but does not touch the counter or re-arm the schedule.

**Alternatives considered**: derive-from-observations (extra query per
write + boundary column; rejected — more machinery for the same result);
`streakResetAt` timestamp (rejected — reimplementing the counter with more
edge cases).

## Decision 2 — Streak trigger point: shared helper on both write paths

**Decision**: a small module `url-check-auto-disable.ts` (backend services)
exports the streak step: given a transaction, check id, and delta
(`reset` for `SUCCESS`, `+n` for non-`SUCCESS`), it updates
`consecutiveFailures` `RETURNING` the new value and the row's
`autoDisableAfter`, resolves the effective threshold
(`COALESCE(autoDisableAfter, URL_CHECK_AUTO_DISABLE_AFTER)`), and when
`threshold > 0 && streak >= threshold` disables the check — `enabled=false`,
`nextProbeAt=null`, `autoDisabledAt=now` — plus a `writeEntityChange` audit
entry (action `"disabled"`, `changes.reason="auto_disable"`, system actor
`{id:null,name:null}`) inside the same transaction.

**Rationale**: `recordObservation` and the bulk-MISSED writer are the only
places observations land; a single helper keeps threshold resolution and the
disable mutation identical on both. Audit-in-transaction is the existing
`writeEntityChange` contract (append-only, same-trx as the domain write).

**Alternatives considered**: evaluate in the sweep only (rejected — a hub
probe streak could straddle sweeps and the disable would lag); database
trigger (rejected — project convention keeps domain logic in services; no
`sql.raw`/trigger precedent).

## Decision 3 — Threshold resolution: global env default + per-check override

**Decision**: `URL_CHECK_AUTO_DISABLE_AFTER` env tunable (integer ≥ 0,
`0` = never auto-disable) supplies the global default; nullable per-check
`autoDisableAfter` overrides it (`NULL` = inherit, `0` = never). Shipped
default: **12** — roughly one hour of unbroken failure at the 300 s default
cadence; bounded enough to stop a dead check, loose enough to survive short
incidents. Constant `URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT = 12` and
`URL_CHECK_AUTO_DISABLE_AFTER_MAX = 1000` live in
`packages/core/src/constants/url-check.ts` beside the other tunables.

**Rationale**: matches the ratified clarification (global default +
per-check override) and the established env-tunable pattern
(`envInt("URL_CHECK_*", *_DEFAULT)` in probe-dispatcher/scheduler). A
nonzero shipped default makes the ratified contract the out-of-box behavior;
`0` preserves today's continue-forever for operators who want it.

**Alternatives considered**: per-check field only (rejected — no fleet
default, every existing check stays unbounded); global only (rejected —
uniform policy, no escape hatch for a check that must never self-disable).

## Decision 4 — Distinguishable auto-disabled state

**Decision**: `autoDisabledAt TIMESTAMPTZ NULL` on `url_checks`. It is set
only by the auto-disable transition, cleared whenever `enabled` becomes
`true` (manual re-enable or create). A check that is `enabled=false` with
`autoDisabledAt` set is auto-disabled — distinguishable in API, UI badge,
and audit.

**Rationale**: the manual-disable path (`updateCheck`) already guards
`parsed.enabled !== existing.enabled`, so it can never overwrite
`autoDisabledAt` while disabled; re-enable is the only manual transition
that touches it, which is exactly the reset moment (FR-004).

**Alternatives considered**: `disabledReason` enum column (rejected —
`autoDisabledAt` carries both the flag and the when, one column);
audit-only distinction (rejected — FR-003 requires the state visible on the
check itself, not only in history).

## Decision 5 — MISSED rows count toward the streak (ratified)

**Decision**: per the clarification, every non-`SUCCESS` observation —
`FAILURE` or `MISSED` — advances the streak; `SUCCESS` resets it to zero.
The bulk-MISSED writer bumps the counter by the batch size, then runs the
same threshold evaluation.

**Consequence**: a check whose agent is offline long enough will
auto-disable and stay off until manually re-enabled — this bounds monitor
side work as well as endpoint failure. Coverage-gap display semantics are
unchanged (`MISSED` still renders as monitor-side, never endpoint failure).

## Decision 6 — Auto-disable does not touch the agent protocol

**Decision**: none of the `url_check.probe*` stream frames change. Disabling
simply removes the check from the sweep's
`enabled AND nextProbeAt <= now()` selection; an in-flight agent probe that
lands afterwards still records its observation (existing mid-flight
semantics, spec 052 US2) but never re-arms the check — guaranteed by the
`enabled = true` update guard.

## Decision 7 — ADR home: ADR-124 Amendment 3

**Decision**: record the contract as `Amendment 3` of
`researches/adrs/ADR-124-url-check-execution-surfaces.md` — it already owns
probe/execution semantics (MISSED semantics, env tunables, mid-flight
results). Also add a one-line back-reference in the gap analysis's
decision-only phase entry? No — the gap analysis is a research artifact;
the ADR amendment and spec are sufficient trail. Update
`researches/architecture-decisions.md` index only if it enumerates
amendments (it does for ADR-124 Amendments 1–2 — check at implementation).

## Decision 8 — Spec-status convention home: AGENTS.md

**Decision**: FR-009's "where spec authors will find it" = the
`Spec-Kit Workflow` section of `AGENTS.md` (the single source of truth for
agents) — one line: "When a feature ships (PR merges), flip its spec.md
`Status` from `Draft` to `Shipped` in the ship commit." Sweep: every
`specs/*/spec.md` on the branch gets `Status: Shipped` — all merged specs
are shipped by definition — including normalizing `Implemented`/`Complete`;
056's own spec flips in the same ship commit per the convention.

## Touched surfaces inventory

| Surface                | File(s)                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema                 | `packages/backend/src/db/migrations/027_url_check_auto_disable.ts`, `db/types.ts`                                                               |
| Core constants         | `packages/core/src/constants/url-check.ts`                                                                                                      |
| Core contracts/schemas | `packages/core/src/contracts/url-check.ts`, `schemas/url-check.ts`                                                                              |
| Streak + disable       | `packages/backend/src/services/url-check-auto-disable.ts` (new), `probe-dispatcher.ts`, `url-check-scheduler.ts`, `url-check-service.ts`        |
| Env                    | `.env.example`, `docs/deployment.md`                                                                                                            |
| Metrics                | `packages/backend/src/observability` metrics registry (auto-disable counter, bounded labels per ADR-069)                                        |
| API docs               | `docs/openapi.yaml` + `pnpm docs:api` regen (ADR-104)                                                                                           |
| Frontend               | `api/mappers/monitoring.ts` (`checkStatusOf`), `url-checks-card.tsx`, `url-check-detail.tsx`, `url-check-editor.tsx`, `api/hooks/url-checks.ts` |
| Tests                  | `packages/backend/test/integration/url-checks-*.test.ts`, `packages/frontend/src/test/unit/url-checks.test.tsx`                                 |
| ADR                    | `researches/adrs/ADR-124-*.md` Amendment 3                                                                                                      |
| User docs              | `docs/url-checks.md`                                                                                                                            |
| Convention             | `AGENTS.md` Spec-Kit Workflow section                                                                                                           |
| Status sweep           | `specs/*/spec.md` Status lines                                                                                                                  |
| Roadmap                | `docs/roadmap.md` (ship stage)                                                                                                                  |
