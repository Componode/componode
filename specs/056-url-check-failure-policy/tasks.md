# Tasks: URL Check repeated-failure policy & spec-status reconciliation

**Input**: Design documents from `specs/056-url-check-failure-policy/`  
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/api.md`

**Tests**: Required by the project constitution. Write each test task first, verify it fails for the intended reason, then implement the smallest passing change.

## Phase 1: Setup

- [x] T001 Confirm `056-url-check-failure-policy` is the active branch and `.specify/feature.json` points to `specs/056-url-check-failure-policy`
- [x] T002 Review the exact hook seams: `recordObservation` in `packages/backend/src/services/probe-dispatcher.ts`, the bulk-MISSED writer in `packages/backend/src/services/url-check-scheduler.ts`, `updateCheck`/`toApi` in `packages/backend/src/services/url-check-service.ts`, `checkStatusOf` in `packages/frontend/src/api/mappers/monitoring.ts`, and `packages/frontend/src/ux/components/catalog/url-check-editor.tsx`

## Phase 2: Foundational

- [x] T003 Create migration `packages/backend/src/db/migrations/027_url_check_auto_disable.ts` adding to `url_checks`: `autoDisableAfter INTEGER NULL` with `CHECK (auto_disable_after IS NULL OR (auto_disable_after >= 0 AND auto_disable_after <= 1000))`, `consecutiveFailures INTEGER NOT NULL DEFAULT 0`, `autoDisabledAt TIMESTAMPTZ NULL`
- [x] T004 Update `UrlCheckRow` in `packages/backend/src/db/types.ts` with `autoDisableAfter: number | null`, `consecutiveFailures: number`, `autoDisabledAt: string | null`
- [x] T005 [P] Add `URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT = 12` and `URL_CHECK_AUTO_DISABLE_AFTER_MAX = 1000` to `packages/core/src/constants/url-check.ts`
- [x] T006 Add `autoDisableAfter: number | null`, `consecutiveFailures: number`, `autoDisabledAt: string | null` to `UrlCheck` in `packages/core/src/contracts/url-check.ts`; add `autoDisableAfter: z.number().int().min(0).max(URL_CHECK_AUTO_DISABLE_AFTER_MAX).nullable().optional()` to `urlCheckFields` and `updateUrlCheckSchema` in `packages/core/src/schemas/url-check.ts`
- [x] T007 Create `packages/backend/src/services/url-check-auto-disable.ts`: `applyStreak(trx, checkId, delta)` — `delta=0` resets `consecutiveFailures`, `delta>0` increments via `RETURNING` (also returning `autoDisableAfter`); effective threshold = `COALESCE(autoDisableAfter, envInt("URL_CHECK_AUTO_DISABLE_AFTER", URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT))`, where `0` never disables; on `threshold > 0 && streak >= threshold` set `enabled=false, nextProbeAt=null, autoDisabledAt=now` guarded by `enabled=true`, write `url_check` audit (`action="disabled"`, `changes.reason="auto_disable"`, system actor `{id:null,name:null}`) in the same trx, emit a structured log line and a bounded-label `urlCheckAutoDisabledTotal` metric

## Phase 3: User Story 1 — Predictable behavior for a chronically failing check (P1) 🎯 MVP

**Goal**: A check probes at cadence until its effective consecutive-failure threshold, then auto-disables — audited, distinguishable, manually re-enabled; contract recorded in ADR-124 Amendment 3 and user docs.

**Independent Test**: drive a check through consecutive `FAILURE`/`MISSED` outcomes to its threshold; assert disable, no post-disable observations, system audit entry, distinguishable API/UI state, and manual re-enable resetting the streak.

### Tests for User Story 1 ⚠️ write first, verify they fail

- [x] T008 [P] [US1] Add failing integration tests in `packages/backend/test/integration/url-checks-failure-policy.test.ts` for the single-outcome path: `FAILURE` increments `consecutiveFailures`, `SUCCESS` resets it to `0`, and reaching the global default threshold sets `enabled=false`, `nextProbeAt=null`, `autoDisabledAt`, plus a system-actor `auto_disable` audit entry — with zero observations accruing after the disable
- [x] T009 [P] [US1] Add failing tests in `packages/backend/test/integration/url-checks-failure-policy.test.ts` for threshold resolution: per-check `autoDisableAfter` overrides the global, `autoDisableAfter=0` never disables, `URL_CHECK_AUTO_DISABLE_AFTER=0` never disables, and dispatch-time `MISSED` outcomes (`AGENT_OFFLINE`, `SATURATED`) count toward the streak
- [x] T010 [P] [US1] Add failing tests in `packages/backend/test/integration/url-checks-failure-policy.test.ts` for the scheduler bulk-MISSED path: backlog slots increment the streak by the batch size, a check crossing the threshold mid-sweep disables with no post-disable `MISSED` rows on later sweeps
- [x] T011 [P] [US1] Add failing tests in `packages/backend/test/integration/url-checks-failure-policy.test.ts` for re-enable and API surface: `PATCH enabled:true` resets `consecutiveFailures` and clears `autoDisabledAt`; GET single/list responses expose `autoDisableAfter`/`consecutiveFailures`/`autoDisabledAt`; `PATCH autoDisableAfter` accepts `0–1000`/null and rejects out-of-range and non-integer values
- [x] T012 [P] [US1] Add failing frontend unit tests in `packages/frontend/src/test/unit/url-checks.test.tsx` for `checkStatusOf` mapping `!enabled && autoDisabledAt` to `AUTO_DISABLED` and the card badge rendering `Auto-disabled` distinct from `Disabled`

### Implementation for User Story 1

- [x] T013 [US1] Wire `applyStreak` into `recordObservation` in `packages/backend/src/services/probe-dispatcher.ts` inside the existing transaction: `delta=0` on `SUCCESS`, `delta=1` on `FAILURE`/`MISSED`; keep the `enabled=true` update guard so late results on a disabled check never mutate the streak or re-arm `nextProbeAt`
- [x] T014 [US1] Wire `applyStreak` into the bulk-MISSED writer in `packages/backend/src/services/url-check-scheduler.ts` (after the batch insert, `delta = missed.length`, one evaluation per check per sweep)
- [x] T015 [US1] Update `packages/backend/src/services/url-check-service.ts`: `toApi` exposes `autoDisableAfter`/`consecutiveFailures`/`autoDisabledAt`; the `enabled:true` PATCH transition resets `consecutiveFailures=0` and `autoDisabledAt=null`; PATCH persists `autoDisableAfter`
- [x] T016 [P] [US1] Add `"AUTO_DISABLED"` to `UrlCheckStatus` in `packages/frontend/src/ux/lib/domain.ts`, update `checkStatusOf` in `packages/frontend/src/api/mappers/monitoring.ts` to return it for `!enabled && autoDisabledAt != null`, and thread the three new fields through `packages/frontend/src/api/hooks/url-checks.ts` types
- [x] T017 [US1] Render an `Auto-disabled` badge distinct from `Disabled` in `packages/frontend/src/ux/components/catalog/url-checks-card.tsx` and show threshold + auto-disable timestamp copy in `packages/frontend/src/ux/components/catalog/url-check-detail.tsx`
- [x] T018 [US1] Add an optional `autoDisableAfter` number input (integer `0–1000`; empty = inherit global; `0` = never) to `packages/frontend/src/ux/components/catalog/url-check-editor.tsx` with helper text naming the global default of 12, wired through create/update payloads
- [x] T019 [US1] Update `docs/openapi.yaml`: `UrlCheck` response schema gains `autoDisableAfter`/`consecutiveFailures`/`autoDisabledAt`; create/update request schemas gain `autoDisableAfter`; regenerate `docs/api.md` via `pnpm docs:api` per ADR-104
- [x] T020 [US1] Add `## Amendment 3 — repeated-failure auto-disable` to `researches/adrs/ADR-124-url-check-execution-surfaces.md` recording: one observation per slot, no retry/backoff, non-`SUCCESS` streak counting (incl. `MISSED`), `COALESCE` threshold resolution with shipped default 12 and `0`=never, audited system disable + `autoDisabledAt`, manual re-enable reset, existing-check migration semantics, and alerting remaining out of scope; update `researches/architecture-decisions.md` if it enumerates ADR-124 amendments
- [x] T021 [P] [US1] Update `docs/url-checks.md` with the repeated-failure policy in operator terms (keeps probing at cadence → auto-disables at threshold → manual re-enable; `MISSED` counts; no notifications), add `URL_CHECK_AUTO_DISABLE_AFTER` to `.env.example`, and add its row to the env table in `docs/deployment.md`

**Checkpoint**: backend + frontend suites green; manual smoke per `quickstart.md` shows Auto-disabled badge, stopped observations, audit entry, and clean re-enable

## Phase 4: User Story 2 — Truthful status on shipped specifications (P2)

**Goal**: Every shipped spec under `specs/` shows `Status: Shipped`; the `Draft`→`Shipped` convention is written where spec authors find it.

**Independent Test**: `grep -rn "Status.*:.*Draft" specs/` returns only in-flight specs; `grep -rLn "Status.*:.*Shipped" specs/*/spec.md` returns none shipped.

- [x] T022 [US2] Set `**Status**: Shipped` on every `specs/*/spec.md` whose feature shipped — all spec directories on this branch — flipping `Draft` and normalizing legacy `Implemented`/`Complete` values (e.g. 001, 010, 011, 018); leave `specs/056-url-check-failure-policy/spec.md` at `Draft` until T024
- [x] T023 [P] [US2] Add the convention to the Spec-Kit Workflow section of `AGENTS.md`: when a feature ships (PR merges), flip its `spec.md` `Status` from `Draft` to `Shipped` in the ship commit; `Draft` marks in-flight work only

## Phase 5: Polish & Cross-Cutting

- [x] T024 Flip `specs/056-url-check-failure-policy/spec.md` `Status` to `Shipped` in the ship commit, per the new convention
- [x] T025 Update `docs/roadmap.md`: mark `056-url-check-failure-policy` shipped, revise the `Next` entry, and reconcile the Shipped heading range/list with merged features (049/050 are listed under a stale `001–048` heading; 055 merged without an entry)
- [x] T026 Run `quickstart.md` validation and changed-package verification (`pnpm lint && pnpm typecheck && pnpm test` in `packages/core`, `packages/backend`, `packages/frontend`; `pnpm build` at root)

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phase 3 (US1, P1) → Phase 4 (US2, P2) → Phase 5
- Within Phase 3: tests (T008–T012, parallel) fail first; implementation T013–T021; T013/T014 depend on T007+T004; T015 on T004+T006; T016–T018 on T006+T015 (response fields); T019 on T006+T015; T020/T021 parallel with code
- US2 is independent of US1 code and can run in parallel after Phase 2 (different files)

## Implementation Strategy

- **MVP**: Phases 1–3 alone deliver the ratified contract end-to-end
- US2 is a mechanical sweep runnable in parallel once the convention is written

## Phase 6: Review

- [x] T027 Wrap the bulk-MISSED insert, streak update, and `evaluateAutoDisable` call in one `db.transaction()` inside `writeMissedSlots` (`packages/backend/src/services/url-check-scheduler.ts`) so observation, counter, disable, and audit commit atomically per ADR-124 Amendment 3 and the audit-in-transaction rule (code-review: standards, code-review: spec)
- [x] T028 Ratify the `url_check_auto_disabled_total` counter series explicitly in `researches/adrs/ADR-124-url-check-execution-surfaces.md` Amendment 3 per the ADR-069 closed-inventory convention (code-review: standards)
- [x] T029 Replace the hardcoded `12` in `packages/frontend/src/ux/components/catalog/url-check-editor.tsx` with `URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT` so the copy can't drift (code-review: standards)
- [x] T030 Type `writeMissedSlots`' `vantage` param as `UrlCheckVantage` and drop the `as` cast at the call site (code-review: standards)
- [x] T031 Add missing `**Status**: Shipped` lines to `specs/035-bugfix-user-form-validation/spec.md`, `specs/036-bugfix-ux-findings/spec.md`, and `specs/050-bugfix-codeql-sanitize/spec.md` so the FR-008 vocabulary is uniform (code-review: standards)
