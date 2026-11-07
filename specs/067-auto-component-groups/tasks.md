# Tasks: Source-scoped auto ComponentGroups

**Input**: Design documents from `/specs/067-auto-component-groups/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/source-auto-groups.md, research.md (ADR-129 grilling record)

**Tests**: REQUIRED — constitution VI (test-first) + spec FR-020 (Hub and Agent
run paths, retire/reactivate, human-conflict matrix) + repo Playwright rule.
Write failing tests before implementation in every phase.

**Organization**: Tasks grouped by user story (US1/US2 P1, US3 P2) per
spec.md priorities.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = pre-grouped catalog, US2 = lifecycle/guards, US3 = operator control

---

## Phase 1: Setup

**Purpose**: Baseline verification on branch `067-auto-component-groups`

- [x] T001 Confirm clean baseline: `pnpm install` already satisfied; run `pnpm -r --filter @componode/backend typecheck` to confirm the branch builds before changes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, core contracts, metrics, and importer capability that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Create migration `packages/backend/src/db/migrations/029_source_auto_groups.ts` adding `importer_sources.componentGroupId uuid NULL REFERENCES component_groups(id) ON DELETE SET NULL` plus index `importer_sources_component_group_idx`; add `componentGroupId: string | null` to `ImporterSourceRow` in `packages/backend/src/db/types.ts`
- [x] T003 [P] Add `autoGroups?: "source"` to `ImporterManifest` in `packages/core/src/importer-registry.ts` (optional capability flag; absent = non-adopter)
- [x] T004 [P] Add `GROUP_AUTO_MANAGED` to `ERROR_CODES` and `ERROR_TYPES` (409, "Component group is managed by an importer source") in `packages/core/src/constants/error-codes.ts` and `packages/core/src/constants/error-types.ts`
- [x] T005 [P] Add auto-group pass metrics to `packages/backend/src/plugins/metrics.ts` mirroring the suggestion-pass trio: `auto_group_passes_total` (counter, `scope` label), `auto_group_pass_duration_seconds` (histogram, `scope` label), `auto_group_pass_errors_total` (counter); export via the metrics object
- [x] T006 [P] Declare capability + opt-out key: add `autoGroups: "source"` to `packages/importer-docker/src/manifest.ts`; add `autoGroup: z.boolean().optional().describe("Automatically maintain a ComponentGroup for this source's exclusively reported components (default true)")` to `dockerConfigSchema` in `packages/importer-docker/src/config.ts` (keep `.strict()`)

**Checkpoint**: Migration applies, core types compile, docker manifest declares capability — user story work can begin

---

## Phase 3: User Story 1 — Docker cluster components arrive pre-grouped (Priority: P1) 🎯 MVP

**Goal**: After a completed Docker import (Hub and Agent paths), one
auto-managed ComponentGroup exists per enabled source whose members are
exactly the sole-effective-active-reporter component set; shared and manual
components are never assigned; membership recomputes fully each pass.

**Independent Test**: Complete a Docker run (Hub path via mocked importer in
integration tests; Agent path via store wiring unit test) and verify one
auto-group per source, membership = sole-reporter set, visible through the
normal component-groups API.

### Tests for User Story 1 (write FIRST — must FAIL before implementation)

- [x] T007 [US1] Write failing integration tests in `packages/backend/test/integration/auto-component-groups.test.ts` (testcontainers + mocked `importer-registry`, pattern per `source-reconciliation.test.ts`): sole-reporter assignment after a completed adopting-importer run; shared component (two active sources) joins no group; manual component (no memberships) untouched; component in a human-managed group untouched; second reporter appearing evicts to `NULL`; group discoverable via `GET /api/v1/component-groups` and members via `GET /api/v1/components?group=<slug>`
- [x] T008 [P] [US1] Write failing unit tests in `packages/backend/test/unit/source-group-service.test.ts`: docker slug strategy determinism (`docker-cluster-{sha256(externalIdentity)[0:12]}`) + `generateUniqueSlug` collision fallback; sole-reporter reduction (exactly-one effective-active reporter wins; `active=false` memberships and `RETIRED` sources don't count); enablement read (`scope.autoGroup === false` skips, absent/true enables, unbound source skips); non-adopting importer (no `autoGroups` capability) never evaluated
- [x] T009 [P] [US1] Write failing unit test additions in `packages/backend/test/unit/remote-run-service.test.ts`: COMPLETED remote run invokes the new store grouping hook before `stageSuggestions`, and a hook failure does not fail the run

### Implementation for User Story 1

- [x] T010 [US1] Implement `packages/backend/src/services/source-group-service.ts`: per-importer strategy registry (v1: docker only — `slugFor` = `docker-cluster-{hash12(externalIdentity)}`, `displayName` = source.label → `docker-engine` member name → externalIdentity, `descriptionFor` = provenance text naming source identity + ADR-129); sole-effective-active-reporter computation over `source_component_memberships` ⋈ `importer_sources` (`active=true`, source `status IN ('ACTIVE','UNMONITORED')`); per-source transaction applying assign (`componentGroupId IS NULL → group` for eligible), evict (`componentGroupId = group → NULL` for ineligible members), derived lifecycle (`ACTIVE` iff ≥1 `ACTIVE` member else `RETIRED`, transition-only update); group find-or-create via `importer_sources.componentGroupId` link with slug collision fallback; `runAutoGroupPass(context?)` failure-isolated wrapper (log + `auto_group_pass_errors_total`, never throws) + pass metrics mirroring `runSuggestionPass`
- [x] T011 [US1] Wire Hub trigger in `packages/backend/src/services/import-run-service.ts`: call `runAutoGroupPass({ runId })` after the COMPLETED `updateRun`, immediately before the existing `runSuggestionPass` block (~line 1211)
- [x] T012 [US1] Wire Agent trigger in `packages/backend/src/services/remote-run-service.ts`: add `maintainAutoGroups(job: RemoteJobContext): Promise<void>` to `RemoteRunStore`, implement it in the store factory delegating to `runAutoGroupPass`, invoke it in the COMPLETED finalize block immediately before `this.store.stageSuggestions` (~line 721) inside the same failure-isolated style
- [x] T013 [US1] Run `pnpm --filter @componode/backend test` until US1 tests pass; verify T007–T009 green

**Checkpoint**: US1 independently functional — completed Docker runs (both paths) produce correct auto-groups; shared/manual/foreign-group components untouched

---

## Phase 4: User Story 2 — Group lifecycle and human edits stay honest (Priority: P1)

**Goal**: Auto-group lifecycle derives from member activity (`ACTIVE` iff ≥1
`ACTIVE` member); human `lifecycle` PATCH and DELETE on auto-managed groups
are rejected with `409 GROUP_AUTO_MANAGED`; name/description/teamOwnerId stay
editable; `retireSource`/`reactivateSource` re-evaluate immediately.

**Independent Test**: Empty/retire a group's members and verify lifecycle
flips; PATCH lifecycle and DELETE verify controlled conflicts while name
edits succeed; retire a source and verify group state updates without
another import.

### Tests for User Story 2 (write FIRST — must FAIL before implementation)

- [x] T014 [US2] Extend `packages/backend/test/integration/auto-component-groups.test.ts` with failing tests: lifecycle flips `ACTIVE→RETIRED` when last active member retires and back on reactivation; `PATCH /component-groups/{id}` `{lifecycle}` → `409 GROUP_AUTO_MANAGED`; `DELETE /component-groups/{id}` → `409 GROUP_AUTO_MANAGED`; PATCH name/description/teamOwnerId → `200`; human-placed ineligible component inside the auto-group evicted next pass; `retireSource`/`reactivateSource` update group state without a run (the human-conflict matrix, FR-020)

### Implementation for User Story 2

- [x] T015 [US2] Add auto-managed guards in `packages/backend/src/services/component-group-service.ts`: `isAutoManagedGroup(trx, groupId)` helper (exists `importer_sources.componentGroupId = id`); `updateComponentGroup` rejects `parsed.lifecycle !== undefined` on auto-managed groups with `409 GROUP_AUTO_MANAGED` before applying updates; `deleteComponentGroup` rejects auto-managed groups with `409 GROUP_AUTO_MANAGED` before the `REFERENCED` check
- [x] T016 [US2] Hook source lifecycle in `packages/backend/src/services/importer-source-service.ts`: invoke `runAutoGroupPass({ actor })` after commit in `retireSource` and `reactivateSource` (failure-isolated — the wrapper never throws); avoid an import cycle — `source-group-service.ts` must not import `importer-source-service.ts`
- [x] T017 [US2] Update `docs/openapi.yaml`: document `409 GROUP_AUTO_MANAGED` on `PATCH /component-groups/{id}` (lifecycle writes) and `DELETE /component-groups/{id}` (auto-managed groups, checked before `REFERENCED`)
- [x] T018 [US2] Run `pnpm --filter @componode/backend test` until US2 tests pass

**Checkpoint**: US1+US2 functional — derived lifecycle honest, human conflict matrix enforced, source retire/reactivate keeps groups fresh

---

## Phase 5: User Story 3 — Operators control and understand the automation (Priority: P2)

**Goal**: `autoGroup: false` opts a config's source out (group frozen, never
torn down); enabled configs maintain across binding handoffs; group
name/slug/description/teamOwnerId carry source provenance.

**Independent Test**: Config with `autoGroup: false` runs → no group created,
existing group frozen; default config → group with source-derived identity.

### Tests for User Story 3 (write FIRST — must FAIL before implementation)

- [x] T019 [US3] Extend `packages/backend/test/integration/auto-component-groups.test.ts` with failing tests: `autoGroup: false` on the bound config → run completes, no group created, pre-existing auto-group members/lifecycle unchanged (frozen); sequential binding handoff (enabled config then disabled config on the same source identity) → enabled run maintains, disabled run freezes, nothing torn down; group identity fields — `name` from source label (engine-name fallback when label null), slug matches `docker-cluster-*` template, `description` names the source identity, `teamOwnerId` null; UNMONITORED (unbound) source's group frozen until reactivation

### Implementation for User Story 3

- [x] T020 [US3] Verify/complete enablement evaluation in `packages/backend/src/services/source-group-service.ts`: per-source gate reads the **bound** config's `scope.autoGroup` (`false` → skip; absent/`true` → evaluate; `boundConfigId NULL` → skip); confirm the pass never evaluates non-`autoGroups`-capable importers — adjust only if T019 exposes a gap
- [x] T021 [US3] Document `autoGroup` in `docs/importers/docker.md` hand-written prose (what it does, default-on opt-out, frozen-not-torn-down semantics, per-source grouping limitation)
- [x] T022 [US3] Run `pnpm --filter @componode/backend test` until US3 tests pass

**Checkpoint**: All three stories independently functional — opt-out honored, provenance legible, lifecycle honest

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: ADR fidelity, generated docs, E2E coverage, final verification

- [x] T023 [P] Amend `researches/adrs/ADR-129-source-scoped-auto-component-groups.md`: record the DELETE guard (`409 GROUP_AUTO_MANAGED`, clarify-session decision) alongside the lifecycle guard, and the bound-config enablement interpretation under single-valued `boundConfigId`
- [x] T024 [P] Write Playwright coverage in `playwright/tests/journeys/auto-component-groups.spec.ts` (pattern per `docker-infra.spec.ts` + `component-groups.spec.ts`): seeded docker config + mock engine run → auto-group visible via API and group detail page; `PATCH lifecycle` and `DELETE` on the auto-group surface the `GROUP_AUTO_MANAGED` conflict
- [x] T025 Regenerate docs: `pnpm --filter @componode/backend docs:api` (error-codes table gains `GROUP_AUTO_MANAGED`), `pnpm --filter @componode/backend docs:importers` (docker config table gains `autoGroup`); run `docs:api:check`, `docs:importers:check`, `docs:oracle:check`, `docs:sidebar:check` — all must pass
- [x] T026 Run spec quickstart.md scenarios against a live stack where feasible; run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` for every changed package (`core`, `backend`, `importer-docker`, `agent` if touched) plus `pnpm e2e` in `playwright/` for the new spec

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: immediate
- **Foundational (Phase 2)**: blocks all stories — migration + core types + capability + metrics must land first
- **US1 (Phase 3)**: after Foundational — delivers the pass + both run triggers (MVP)
- **US2 (Phase 4)**: after US1 — guards and source-lifecycle hooks build on the pass
- **US3 (Phase 5)**: after US2 — opt-out verification + docs on the complete mechanism
- **Polish (Phase 6)**: after all stories — ADR amendment, E2E, generated docs, verification

### User Story Dependencies

- **US1 (P1)**: no story dependencies — the core mechanism
- **US2 (P1)**: depends on US1 (guards reference auto-managed groups the pass creates; hooks invoke the pass)
- **US3 (P2)**: depends on US1 mechanism; independent of US2 guards

### Parallel Opportunities

- Phase 2: T002–T006 all parallel (different files/packages)
- Phase 3 tests: T007/T008/T009 parallel (different test files); implementation T011/T012 parallel after T010 (different files)
- Phase 4 implementation: T015/T016/T017 parallel after T014 (different files)
- Phase 6: T023/T024 parallel (different trees)

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- `source-group-service.ts` before trigger wiring
- Service guards before route-level verification

---

## Parallel Example: User Story 1

```bash
# Tests (different files — parallel):
Task: "Integration tests in test/integration/auto-component-groups.test.ts"
Task: "Unit tests in test/unit/source-group-service.test.ts"
Task: "Unit test additions in test/unit/remote-run-service.test.ts"

# Implementation (after T010 service lands — different files — parallel):
Task: "Hub trigger in import-run-service.ts"
Task: "Agent store method + trigger in remote-run-service.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 (foundation)
2. Phase 3 (US1): pass + Hub/Agent triggers → **STOP: a completed Docker run produces a correct auto-group**

### Incremental Delivery

1. Foundation → US1 (grouping works end-to-end) → US2 (lifecycle + guards honest) → US3 (operator control + docs) → Polish (ADR, E2E, generated docs, verify)

---

## Notes

- The pass is **global full-recompute** over enabled capable sources on every trigger (plan.md design resolution — sole-reporter is a cross-source property; per-source scoping can go stale on retire/reactivate)
- Enablement reads the **bound** config's `scope.autoGroup` — `boundConfigId` is single-valued (ADR-119); unbound sources freeze
- `source-group-service.ts` must NOT import `importer-source-service.ts` (would cycle with the retire/reactivate hooks)
- Membership churn is deliberately unaudited; only group `created`/`lifecycle` transitions write entity changes
- `packages/agent` needs no changes — grouping executes hub-side on run completion

---

## Phase 7: Convergence

- [x] T027 Audit derived auto-group lifecycle flips: in `packages/backend/src/services/source-group-service.ts` Phase 4, call `writeEntityChange` (`entityType: "component_group"`, `action: "lifecycle"`, changes `{ lifecycle: next, name, slug, autoManaged: true, sourceId }`, same `trx`) whenever a pass transitions `component_groups.lifecycle` — per plan.md audit decision ("group created and lifecycle transitions") (partial)
- [x] T028 Sync `specs/067-auto-component-groups/contracts/source-auto-groups.md` trigger table: Hub run trigger actually runs the pass *before* `updateRun(...COMPLETED)` (group exists before COMPLETED is observable) and before `runSuggestionPass`; Agent path likewise before finalize — update the "after updateRun" wording to match `import-run-service.ts` / `remote-run-service.ts` (partial)

---

## Phase 8: Review

- [x] T029 Serialize overlapping auto-group passes: in `packages/backend/src/services/source-group-service.ts` `loadSourcePlans`, add `.forUpdate()` to the `importer_sources` select so concurrent passes (parallel hub/agent runs, run vs retire/reactivate) block until the holder commits and then observe its `componentGroupId` links — prevents duplicate group provisioning and stranded orphan groups (code-review: spec)
- [x] T030 Remove run-importer capability gates on pass triggers per FR-002 ("MUST run after completed Hub and Agent import runs"): drop `manifest.autoGroups === "source"` check in `packages/backend/src/services/import-run-service.ts` (~line 1203) and the same check inside `maintainAutoGroups` in `packages/backend/src/services/remote-run-service.ts` (~line 1108); the pass self-filters capable sources and early-returns before the pairs query when none exist; remove now-unused `getManifest` import if applicable and update `test/unit/remote-run-service.test.ts` if it asserts the gate (code-review: spec)
- [x] T031 ADR fidelity for `GROUP_AUTO_MANAGED`: append an "Amended by ADR-129" back-pointer to `researches/adrs/ADR-071-*.md` (error enum gains the 409 code), add ADR-071 to ADR-129's amends list, and update the ADR-129 row in `researches/architecture-decisions.md` (code-review: standards)
- [x] T032 Document `componentGroupId` on the `ImporterSource` schema in `docs/openapi.yaml` (`{ type: string, format: uuid, nullable: true }`) — `getSource`/`retireSource`/`reactivateSource` return `selectAll()` rows so the field is now API-visible; keep `pnpm docs:api:check` green (code-review: standards)
- [x] T033 Replace the hand-rolled slug-suffix loop in `ensureGroup` (`source-group-service.ts` ~lines 226-235) with `generateUniqueSlug` from `packages/backend/src/utils/slug.ts` per plan.md/tasks.md naming (code-review: standards)
- [x] T034 Move the engine-name pick out of generic `ensureGroup`: add an optional strategy hook (e.g. `engineComponentName?(members): string | null`) to `SourceGroupStrategy`, implement it for docker (`resourceType === "docker-engine"`), and call it from `ensureGroup` instead of the hardcoded resourceType lookup (code-review: standards)
- [x] T035 Rename the `scope` label to `trigger` on `auto_group_passes_total` and `auto_group_pass_duration_seconds` in `packages/backend/src/plugins/metrics.ts` and update `inc`/`observe` call sites — the label carries trigger values (`hub-run`/`agent-run`/`source-retire`/`source-reactivate`), and the metric is unreleased so the rename is free (code-review: standards)
- [x] T036 Update `docs/using-the-catalog.md` Component Groups section (~line 99) to mention system-provisioned auto-managed groups alongside human-declared ones (code-review: standards)
