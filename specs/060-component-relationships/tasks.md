# Tasks: Read-only Component Relationships

**Input**: Design documents from `/specs/060-component-relationships/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`

**Tests**: Required by Constitution Principle VI. Add failing tests before
implementation and verify each failure has the intended cause.

## Phase 1: Setup

- [x] T001 Confirm the `060-component-relationships` branch and
      `.specify/feature.json` point to `specs/060-component-relationships/spec.md`
- [x] T002 Review `researches/adrs/ADR-016-component-component-relationships.md`,
      `researches/adrs/ADR-048-graph-relationship-persistence.md`,
      `packages/backend/src/routes/components.ts`, and
      `packages/backend/src/services/component-catalog-service.ts`

## Phase 2: Foundational

**Purpose**: Define and test the typed read contract before the UI consumes it.

- [x] T003 [P] Add failing backend integration coverage in
      `packages/backend/test/integration/component-detail.test.ts` for typed
      Component relation directions, empty groups, unavailable relation groups,
      and bounded query count
- [x] T004 [P] Add failing backend integration coverage in
      `packages/backend/test/integration/components.test.ts` for direct Product
      dependents, Product paths via ComponentGroup, lifecycle visibility, and
      read-only authentication behavior
- [x] T005 [P] Add failing frontend view tests in
      `packages/frontend/src/test/unit/component-relationships.test.tsx` for
      typed lanes, direction labels, group provenance, nested instances, and
      empty states
- [x] T006 Add failing route/permission coverage in
      `packages/backend/test/integration/components.test.ts` proving the new
      relationship read is authenticated and side-effect-free

**Checkpoint**: The tests specify relation direction, group provenance,
visibility, and no-write behavior before implementation.

## Phase 3: User Story 1 — Inspect typed Component relations (Priority: P1)

**Goal**: Show stored Component-to-Component relations with their correct
type and direction.

**Independent Test**: Seed outgoing/incoming `DEPENDS_ON`, `SOURCES_FROM`,
and `EXPOSES` rows; read the Relationships tab and verify every relation
appears in its typed lane without inferred edges.

### Tests for User Story 1

- [x] T007 [US1] Extend `packages/backend/test/integration/component-detail.test.ts`
      to fail for missing `DEPENDS_ON`, `SOURCES_FROM`, and `EXPOSES` read results
- [x] T008 [US1] Extend
      `packages/frontend/src/test/unit/component-relationships.test.tsx` to fail
      for incorrect incoming/outgoing relation labels and reversed endpoints

### Implementation for User Story 1

- [x] T009 [US1] Define the typed Component relationship read contract in
      `packages/core/src/contracts/component-relationships.ts` and export it
      through `packages/core/src/index.ts`
- [x] T010 [US1] Implement bounded typed relation queries in
      `packages/backend/src/services/component-relationship-service.ts` using
      the existing Component junction tables
- [x] T011 [US1] Add authenticated
      `GET /api/v1/components/:id/relationships` to
      `packages/backend/src/routes/components.ts` with safe not-found and
      validation errors and the default-false `includeGone` query

**Checkpoint**: The read contract returns every stored Component edge with
correct source/target direction and no mutation.

## Phase 4: User Story 2 — Understand Product impact (Priority: P1)

**Goal**: Show direct Product dependents and Product dependencies reached
through ComponentGroups without conflating the two paths.

**Independent Test**: Seed one direct Product dependency and one
ComponentGroup-mediated dependency; verify both are visible and attributed.

### Tests for User Story 2

- [x] T012 [P] [US2] Add direct and group-mediated Product path fixtures to
      `packages/backend/test/integration/component-detail.test.ts`
- [x] T013 [US2] Add frontend assertions for “via [ComponentGroup]” and
      direct-versus-group path distinction in
      `packages/frontend/src/test/unit/component-relationships.test.tsx`

### Implementation for User Story 2

- [x] T014 [US2] Extend
      `packages/backend/src/services/component-relationship-service.ts` to read
      Product dependents and ComponentGroup-mediated paths from existing typed
      product relation tables
- [x] T015 [US2] Add frontend view types and mapper coverage in
      `packages/frontend/src/api/types.ts`,
      `packages/frontend/src/api/mappers/catalog.ts`, and
      `packages/frontend/src/test/unit/ux-mappers.test.ts`

**Checkpoint**: Product relationships are read-only and group-mediated
paths are never shown as direct Component edges.

## Phase 5: User Story 3 — Inspect ComponentInstances in context (Priority: P2)

**Goal**: Nest ComponentInstances under the focused Component in Relationships
while preserving the Overview Instances table.

**Independent Test**: Render a Component with several instances in Overview
and Relationships; verify both presentations agree and status is not
recomputed by the view.

### Tests for User Story 3

- [x] T016 [P] [US3] Add instance nesting, Overview duplication, and GONE
      visibility tests to
      `packages/frontend/src/test/unit/component-relationships.test.tsx`
- [x] T017 [US3] Add detail-read contract coverage for instance environment,
      status, default GONE exclusion, and explicit `includeGone=true` in
      `packages/backend/test/integration/component-detail.test.ts`

### Implementation for User Story 3

- [x] T018 [US3] Include nested ComponentInstance refs in the typed
      relationship read with `includeGone` filtering in
      `packages/backend/src/services/component-relationship-service.ts`
- [x] T019 [US3] Render nested instances with the existing Environment and
      Health badges in
      `packages/frontend/src/ux/components/catalog/component-relationships.tsx`
- [x] T020 [US3] Preserve the existing Overview Instances table and add the
      Relationships tab using `useValidatedTab`, keeping read-only URL Check
      summaries in Overview, in
      `packages/frontend/src/ux/components/catalog/component-detail.tsx`

**Checkpoint**: Instance status and environment are visible in both chosen
surfaces; the Relationship view does not create a new status signal.

## Phase 6: User Story 4 — Navigate the read-only view accessibly (Priority: P1)

**Goal**: Support keyboard focus, inspection, and bounded one-hop expansion
without graph editing.

**Independent Test**: Complete a keyboard-only journey through typed lanes,
`+N`, node details, and Escape at 1280px and 768px.

### Tests for User Story 4

- [x] T021 [P] [US4] Add keyboard reachability, accessible names, focus
      announcement, Escape, and no-write tests in
      `packages/frontend/src/test/unit/component-relationships.test.tsx`
- [x] T022 [P] [US4] Add responsive, reduced-motion, and relationship
      navigation coverage in
      `playwright/tests/journeys/component-relationships.spec.ts`

### Implementation for User Story 4

- [x] T023 [US4] Add the typed lane layout, focus state, inspection panel,
      and `+N` expansion in
      `packages/frontend/src/ux/components/catalog/component-relationships.tsx`
- [x] T024 [US4] Wire loading, empty, error, forbidden, and partial relation
      states through `packages/frontend/src/ux/app/components/$slug.tsx`
      and `packages/frontend/src/ux/components/catalog/component-detail.tsx`
- [x] T025 [US4] Add the `componentRelationships` fallback flag in
      `packages/frontend/src/ux/lib/flags.ts` with the matching G35 gap entry in
      `researches/ux-rewrite-gaps.md`

**Checkpoint**: The view is keyboard-operable, responsive, read-only, and
never fabricates missing relationship data.

## Phase 7: Contracts, documentation, and verification

- [x] T026 Add the relationship read operation and schemas to
      `docs/openapi.yaml`, including session security and 401/404 responses
- [x] T027 Regenerate `docs/api.md` with
      `pnpm --filter @componode/backend docs:api` and verify
      `pnpm --filter @componode/backend docs:api:check`
- [x] T028 Update the Component detail/Relationships tab description in
      `docs/ux.md` and `docs/using-the-catalog.md`
- [x] T029 Verify ADR-128, ADR-103 back-pointer, and
      `researches/architecture-decisions.md` remain consistent
- [x] T030 Run backend integration tests in
      `packages/backend/test/integration/component-detail.test.ts` and
      `packages/backend/test/integration/components.test.ts`, frontend tests in
      `packages/frontend/src/test/unit/component-relationships.test.tsx`, and the
      browser journey in `playwright/tests/journeys/component-relationships.spec.ts`
- [x] T031 Run `pnpm --filter @componode/backend docs:api:check`,
      `pnpm --filter @componode/frontend typecheck`, and `git diff --check`

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no implementation dependencies.
- **Foundational (Phase 2)**: blocks all user stories.
- **US1 (Phase 3)**: establishes the typed Component edge read.
- **US2 (Phase 4)**: depends on the shared typed response and adds Product
  provenance.
- **US3 (Phase 5)**: depends on the relationship response's focused Component.
- **US4 (Phase 6)**: depends on all relation groups and read states.
- **Contracts/documentation (Phase 7)**: follows the finalized read response
  and frontend surface.

### Parallel Opportunities

- T003 and T004 can be written in parallel in separate backend test files.
- T007 and T008 can be written in parallel after the contract is agreed.
- T012 and T013 can be written in parallel.
- API mappers and the typed lane view can proceed in parallel after the
  contract test passes.

## Implementation Strategy

1. Prove typed edge directions and authentication with failing backend tests.
2. Add the bounded read contract for Component, Product, group, and instance
   relations.
3. Build the Relationships tab on the same view patterns as Product Map while
   keeping instances in Overview and nesting them in the relationship context.
4. Add keyboard, responsive, empty, and no-write coverage.
5. Update OpenAPI, UX-gap/flag governance, user documentation, and generated
   API docs.

## Phase 8: Review

- [x] T032 Merge direct and group-mediated Product dependents into one
      "Product dependents" lane where each Product renders once with labeled
      provenance paths (code-review: spec, MEDIUM — US2/AC2.3 + edge case)
- [x] T033 Render every typed lane's "None" empty state even when the whole
      view is empty, keeping the explicit empty-state box (code-review: spec,
      LOW — US1/AC1.5, FR-010)
- [x] T034 Add a "Show gone" toggle in the Relationships instances section so
      GONE instances are explicitly requestable (code-review: spec, LOW —
      US3/AC3.3)
- [x] T035 Add a backend test asserting a failed relation family reports its
      kind in `unavailableKinds` rather than dropping silently, and a 768px
      viewport overflow check in the Playwright spec (code-review: spec,
      LOW — FR-007, SC-004)
- [x] T036 Replace the `productDependents` one-element-array wrapper with a
      dedicated try/catch degradation (code-review: standards, LOW)
- [x] T037 Extract `mapProductDependent` in `mappers/catalog.ts` and narrow
      `unavailableKinds` labels to the contract kind union (code-review:
      standards, LOW)
