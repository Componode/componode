# Tasks: App-level auto ComponentGroups + multi-group membership

**Input**: Design documents from `/specs/070-app-auto-groups/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/group-membership-api.md, quickstart.md

**Tests**: REQUIRED — constitution VI + FR-019 (unit, integration, contract, Playwright).

**Organization**: US1 (multi-membership) and US2 (app groups) are both P1;
US2 depends on US1's join table. US3/US4 are P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependencies)
- **[Story]**: US1–US4 map to spec.md user stories

---

## Phase 1: Setup

- [X] T001 Verify workspace: on branch `070-app-auto-groups`, `pnpm install` clean, backend test DB reachable

---

## Phase 2: Foundational — membership store & schema (blocks all stories)

- [X] T002 Create migration `packages/backend/src/db/migrations/030_component_group_membership.ts`: `component_group_members(componentId uuid NOT NULL REFERENCES components(id) ON DELETE CASCADE, groupId uuid NOT NULL REFERENCES component_groups(id) ON DELETE CASCADE, createdAt timestamptz NOT NULL DEFAULT now(), PK(componentId,groupId))` + indexes on both columns; backfill from `components.componentGroupId`; add `component_groups.autoSourceId uuid NULL REFERENCES importer_sources(id) ON DELETE SET NULL` + `autoGroupKey text NULL`; backfill source groups from `importer_sources.componentGroupId`; partial unique indexes `UNIQUE(autoSourceId,autoGroupKey) WHERE autoSourceId IS NOT NULL AND autoGroupKey IS NOT NULL` and `UNIQUE(autoSourceId) WHERE autoSourceId IS NOT NULL AND autoGroupKey IS NULL`; drop `components.componentGroupId` and `importer_sources.componentGroupId` + its index; `down()` reverses
- [X] T003 Update `packages/backend/src/db/types.ts`: add `ComponentGroupMemberRow`, add `component_group_members` to `DB` map; remove `componentGroupId` from `ComponentRow` and `ImporterSourceRow`; add `autoSourceId: string | null` + `autoGroupKey: string | null` to `ComponentGroupRow`
- [X] T004 [P] Create `packages/backend/src/services/component-group-membership.ts`: helpers `groupsOfComponents(componentIds) → Map<componentId, GroupRef[]>`, `membersOfGroups(groupIds) → rows`, `addMembership`, `removeMembershipsForGroups(componentId, groupIds)`, `replaceHumanMemberships(componentId, desiredGroupIds)` enforcing human-only (`component_groups.autoSourceId IS NULL`) semantics
- [X] T005 [P] Update `packages/core`: `updateComponentSchema`/`createComponentSchema` — `componentGroupId` → `componentGroupIds: z.array(z.string().uuid()).optional()`; component contract payload → `componentGroups: {id,name,slug}[]` replacing `componentGroupId`/`componentGroupName`; `ImporterManifest.autoAppGroups?: boolean`; group payload type gains `autoSourceId`/`autoGroupKey`

**Checkpoint**: schema + contracts compile; existing tests fail (red state expected)

---

## Phase 3: User Story 1 — Components belong to multiple groups (P1) 🎯 MVP

**Goal**: join table is the single membership store; APIs expose/accept plural memberships; humans multi-assign; auto passes write join rows without touching foreign memberships.

**Independent Test**: component in human + source-auto + app-auto groups simultaneously; both memberships persist across passes; API returns full set.

### Tests for User Story 1

- [X] T006 [US1] Failing integration tests in `packages/backend/test/integration/component-group-membership.test.ts`: backfill correctness, multi-assign persists, `componentGroups[]` payload shape, `group=<slug>` filter matches any membership, `group=none` = zero memberships, PATCH `componentGroupIds` replaces human set only (auto memberships untouched), auto-managed id in array → `409 GROUP_AUTO_MANAGED`, unknown id → 404, audit `entity_changes` written on human membership edit
- [X] T007 [US1] Update `packages/backend/test/integration/auto-component-groups.test.ts` + any fixtures/seeds referencing `componentGroupId` to join-table semantics (sole-reporter, null-or-ours→additive, eviction, lifecycle — same expectations, new store)
- [X] T008 [US1] Failing unit tests for membership helpers in `packages/backend/test/unit/component-group-membership.test.ts` (replace-set diff, human-only filter, auto-id rejection)

### Implementation for User Story 1

- [X] T009 [US1] `packages/backend/src/services/component-group-service.ts`: `memberCount` via join-table count; `isAutoManagedGroup` → `autoSourceId IS NOT NULL`; `updateComponent`/`createComponent` accept `componentGroupIds` — validate ids exist and are human-managed (reject auto ids `409 GROUP_AUTO_MANAGED`), replace human memberships via helper, write audit `entity_changes`; `getComponentGroupByComponentId` → plural `getComponentGroupsByComponentIds`
- [X] T010 [US1] `packages/backend/src/services/component-catalog-service.ts`: list + detail payloads emit `componentGroups[]` (join `component_group_members`→`component_groups`); `componentGroup`/`group` slug filter → `EXISTS` membership join; `group=none` → `NOT EXISTS` any membership
- [X] T011 [P] [US1] `packages/backend/src/services/product-service.ts`: all three group-expansion sites (dep rows ~L476, memberCount ~L526, edge expansion ~L340) join `component_group_members` instead of `components.componentGroupId`
- [X] T012 [P] [US1] `packages/backend/src/services/product-health-service.ts`: grouped dep expansion via `component_group_members`
- [X] T013 [P] [US1] `packages/backend/src/services/catalog-coverage-service.ts`: `wiredComponentIdsQuery` union arm joins `component_group_members`
- [X] T014 [P] [US1] `packages/backend/src/services/edge-suggestion-service.ts`: component→groups map from join table; `isCovered` = component's groupIds ∩ product's depended-on groupIds ≠ ∅
- [X] T015 [P] [US1] `packages/backend/src/services/component-relationship-service.ts`: `viaGroupDependents` iterates ALL of the component's group memberships (viaGroup per group)
- [X] T016 [US1] `packages/backend/src/services/importer-source-service.ts`: source serialization `componentGroupId` → own-group lookup (`component_groups.autoSourceId = source.id AND autoGroupKey IS NULL`)
- [X] T017 [US1] `packages/backend/src/services/source-group-service.ts`: migrate pass to join table + provenance columns — `loadSourcePlans` finds own group via `autoSourceId`/`autoGroupKey IS NULL`; `ensureGroup` inserts `component_groups` with `autoSourceId`/`autoGroupKey NULL`; membership assign/evict write/delete `component_group_members` rows; `membersByGroup` index built from join table; source-group eligibility rule UNCHANGED (sole effective-active reporter); auto-membership purely additive (no null-or-ours check against foreign memberships)
- [X] T018 [P] [US1] Frontend `packages/frontend/src/api/types.ts` + `api/mappers/catalog.ts` + `api/hooks/component-groups.ts` + `api/hooks/components.ts`: `componentGroups[]` types, mapper, assign mutation sends `componentGroupIds[]`
- [X] T019 [US1] Frontend multi-assign UI: `ux/components/catalog/component-edit-dialog.tsx` + `component-create-dialog.tsx` + `ux/app/components/new.tsx` — replace single `Select` with multi-group picker (checkbox list); submit `componentGroupIds[]`
- [X] T020 [P] [US1] Frontend display: `ux/components/catalog/component-detail.tsx` + `ux/components/patterns/title-with-summary.tsx` + `ux/lib/view-types.ts` — render group list (names/links) instead of single name; list-page group column/filter unchanged request shape
- [X] T021 [US1] `docs/openapi.yaml`: component request/response schemas (`componentGroupIds` in, `componentGroups[]` out), group payload +`autoSourceId`/`autoGroupKey`, `GROUP_AUTO_MANAGED` on componentGroupIds; regenerate `docs/api.md` via `pnpm docs:api`
- [X] T022 [US1] Checkpoint: `pnpm --filter @componode/backend test` + `pnpm --filter @componode/frontend test` green; `pnpm build` clean

**Checkpoint**: US1 independently verifiable — multi-membership end-to-end.

---

## Phase 4: User Story 2 — Docker applications arrive pre-grouped (P1)

**Goal**: per-source app groups for compose projects + swarm stacks, additive membership, full-recompute on same triggers.

**Independent Test**: Docker import → one app group per (source, project)/(source, stack); members = label-carriers only; shared component joins each reporting source's group.

### Tests for User Story 2

- [X] T023 [US2] Failing unit tests `packages/backend/test/unit/docker-app-group-strategy.test.ts`: key extraction — `details.composeProject`, `details.labels["com.docker.compose.project"]`, `details.stack`; non-carriers → no keys; `autoGroupKey`/`slug`/`name`/`description` templates
- [X] T024 [US2] Failing integration tests in `packages/backend/test/integration/auto-component-groups.test.ts` (or new `app-auto-groups.test.ts`): compose project group = exact member set (workloads + labeled net/vols, excludes engine/images/bridge); swarm stack group; two projects → two groups; unlabeled → source-group-only; two sources same project → two groups + shared component in both; multi-source component joins each reporter's app group; images never join

### Implementation for User Story 2

- [X] T025 [US2] `packages/backend/src/services/source-group-service.ts`: extend strategy interface with optional `appGroupKinds` — per-kind `keyOf(details) → string[]`, `autoGroupKey(kind,key)`, `slugFor(source,kind,key)`, `nameFor(kind,key)`, `descriptionFor(source,kind,key)`; docker strategy implements `compose-project` + `swarm-stack` kinds
- [X] T026 [US2] `packages/backend/src/services/source-group-service.ts`: app-group evaluation in `runAutoGroupPass` — for each `full`-mode source with manifest `autoAppGroups`, compute per-source reported set (memberships active ∧ source ACTIVE/UNMONITORED — NOT sole-reporter), extract keys per component details, group by (kind,key), `ensureAppGroup` (`autoSourceId` + `autoGroupKey='compose:{p}'/'stack:{n}'`, slug `docker-app-{key}-{hash12(sourceId:key)}`, name=key verbatim, description=provenance), assign eligible members, evict ineligible from owned groups, derive lifecycle; cleanup-mode sources evict all app members + derive RETIRED; failure-isolated + report counters (`appGroupsEnsured`, `appMembersAssigned`, `appMembersEvicted`)
- [X] T027 [US2] `packages/importer-docker/src/manifest.ts`: `autoAppGroups: true`; confirm `packages/core/src/importer-registry.ts` `autoAppGroups?: boolean` declared (T005)
- [X] T028 [US2] `packages/backend/src/plugins/metrics.ts` (or pass report site): surface app-group counters in structured pass log/metrics
- [X] T029 [US2] Checkpoint: docker integration tests green; app groups appear for live-shaped fixtures

**Checkpoint**: US2 independently verifiable — pre-grouped apps after import.

---

## Phase 5: User Story 3 — Auto-managed guards & derived lifecycle (P2)

**Goal**: `autoSourceId IS NOT NULL` covers app groups for `GROUP_AUTO_MANAGED`, derived lifecycle, retire/reactivate, opt-out freeze.

**Independent Test**: lifecycle PATCH/DELETE on app group → 409; name edit OK; retireSource → app groups evict+RETIRED+survive; reactivate resumes; `autoGroup:false` freezes all.

### Tests for User Story 3

- [X] T030 [US3] Failing integration tests: `GROUP_AUTO_MANAGED` on app-group lifecycle PATCH + DELETE; human field edits succeed; derived ACTIVE/RETIRED transitions; `retireSource` cleanup-mode evicts app members + derives RETIRED + keeps rows/links; `reactivateSource` resumes; `autoGroup:false` freezes source+app groups; UNMONITORED freeze

### Implementation for User Story 3

- [X] T031 [US3] Fix any guard/lifecycle gaps surfaced by T030 (expected: `isAutoManagedGroup` + cleanup path already generic via `autoSourceId`; verify `loadSourcePlans` cleanup-mode covers app groups; group delete guard blocks app groups)
- [X] T032 [US3] Checkpoint: guard/lifecycle matrix green

---

## Phase 6: User Story 4 — Provenance & operator control (P2)

**Goal**: app groups self-explanatory (name/slug/description/teamOwnerId), opt-out honored, docs + ADR record the promotion.

**Independent Test**: inspect created app group fields; `autoGroup:false` config → no app groups maintained.

### Tests for User Story 4

- [X] T033 [US4] [P] Contract assertions folded into T024/T030 coverage: group payload exposes `autoSourceId`/`autoGroupKey`; name=label verbatim; slug deterministic `docker-app-*`; description names source+key; teamOwnerId null

### Implementation for User Story 4

- [X] T034 [US4] Verify group list/detail payloads + UI surface provenance fields (`autoSourceId`/`autoGroupKey` nullable in `api/types.ts` + group detail display if the surface exists); document `autoGroup:false` behavior already enforced in T026
- [X] T035 [P] [US4] `docs/using-the-catalog.md`: multi-membership + auto-group provenance prose
- [X] T036 [P] [US4] `docs/importers/docker.md`: auto-grouping section — source groups + compose/stack app groups + `autoGroup` opt-out; regenerate importer docs (`pnpm docs:importers`)
- [X] T037 [US4] `researches/adrs/ADR-129-source-scoped-auto-component-groups.md`: amendment — multi-membership join table + `component_groups` provenance columns supersede single-group-per-source link; app-group dimension added
- [X] T038 [US4] Playwright specs `playwright/tests/`: multi-group assignment via edit dialog, group filter across memberships, app-group listing/detail via docker mock fixtures (pattern: `docker-infra.spec.ts`)
- [X] T039 [US4] `docs/roadmap.md`: mark feature shipped, revise Next entry

---

## Phase 7: Polish & Cross-Cutting

- [X] T040 Regenerate `docs/api.md` + run `docs:check`/`docs:oracle:check`/`docs:sidebar:check` if affected
- [X] T041 Full verification: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` for changed packages (core, backend, frontend, importer-docker) + root `pnpm build`
- [X] T042 Spec conformance sweep: every FR-001…FR-019 mapped to a task/test; edge cases in spec.md §Edge Cases each covered

---

## Dependencies & Execution Order

- **Phase 2** blocks everything (schema must exist before any consumer migrates).
- **US1 (Phase 3)** delivers the model promotion; **US2 (Phase 4)** builds the app dimension on it — run after US1 checkpoint.
- **US3 (Phase 5)** verifies guards already generic from US1/US2 — mostly tests.
- **US4 (Phase 6)** docs/ADR/e2e can parallelize with US3 where files differ.
- **Phase 7** last.

### Parallel opportunities

- T004/T005 (helpers vs core schemas) — different packages.
- T011–T015 backend read-site migrations — different files.
- T018/T020 frontend splits; T035/T036 docs.
- T023/T024 test authoring can precede T025/T026 implementation.

### Suggested MVP

Phase 2 + US1 + US2 = shippable core (multi-membership + docker app groups). US3/US4 harden + document.

---

## Notes

- Intermediate commits within Phase 3 may not compile until all read sites migrate — land Phase 3 as one logical unit.
- `component_instances`, product edges, `edge_suggestions` rows: untouched.
- No `DiscoveredAsset`/importer-contract change (FR-016); no product-edge writes (FR-017).
