# Tasks: Product Map topology in Dependencies

**Input**: Design documents from `/specs/059-product-map-topology/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/product-map-read.md`, `quickstart.md`

**Tests**: Required by Constitution Principle VI. Add failing tests before
implementation and verify each failure has the intended cause.

## Phase 1: Setup

- [ ] T001 Review `packages/frontend/src/ux/components/products/product-map.tsx`,
      `packages/frontend/src/ux/components/products/product-detail.tsx`,
      `packages/backend/src/services/product-service.ts`, and ADR-127
- [ ] T002 Confirm `.specify/feature.json` points to
      `specs/059-product-map-topology`

## Phase 2: Foundational

**Purpose**: Establish relation-direction, read-contract, and view tests before
the topology or API response changes.

- [ ] T003 [P] Add failing Product detail integration fixtures in
      `packages/backend/test/integration/products.test.ts` for `composedBy`,
      `composes`, `consumesFrom`, `consumedBy`, and `dependsOnGroups`
- [ ] T004 [P] Add failing related-Product health/count response tests in
      `packages/backend/test/integration/products.test.ts`, including null health
      Components reached through ComponentGroup dependencies, and partial
      relation-group availability
- [ ] T005 [P] Add failing topology direction, empty-state, and navigation
      tests in `packages/frontend/src/test/unit/product-map.test.tsx`
- [ ] T006 Add failing accessibility and 768px layout coverage in
      `playwright/tests/journeys/product-map.spec.ts`

**Checkpoint**: Tests fail for missing relation directions/related-node
fields and the current keyboard/responsive defects.

## Phase 3: User Story 1 — See complete Product topology (Priority: P1)

**Goal**: Put a complete, directed one-hop topology at the top of Dependencies
without removing edge-authoring controls.

**Independent Test**: Open a Product fixture with all five relation groups and
verify each group appears with correct source/target direction; verify the
Components surface and existing edge-authoring controls remain usable.

### Tests for User Story 1

- [ ] T007 [P] [US1] Add failing tests for incoming/outgoing edge direction,
      `consumedBy`, ComponentGroup nodes, and legacy `?tab=map` fallback in
      `packages/frontend/src/test/unit/product-map.test.tsx`
- [ ] T008 [P] [US1] Add failing API coverage for every relation group and
      empty ComponentGroups in `packages/backend/test/integration/products.test.ts`

### Implementation for User Story 1

- [ ] T009 [US1] Add typed Product topology data for all relation directions
      in `packages/frontend/src/ux/app/products/$slug.tsx`
- [ ] T010 [US1] Replace the separate Map tab with topology at the top of
      Dependencies while retaining edge authoring and list controls in
      `packages/frontend/src/ux/components/products/product-detail.tsx`
- [ ] T011 [US1] Implement the deterministic one-hop Product/ComponentGroup
      topology, direction-aware connectors, four-node lanes, and `+N` expansion
      in `packages/frontend/src/ux/components/products/product-map.tsx`
- [ ] T012 [US1] Route legacy `?tab=map` links to Dependencies in
      `packages/frontend/src/ux/components/products/product-detail.tsx`
- [ ] T013 [US1] Add the `productMapTopology` fallback flag and matching
      G34 gap entry in `packages/frontend/src/ux/lib/flags.ts` and
      `researches/ux-rewrite-gaps.md`; enable it only with the complete read path

**Checkpoint**: The topology shows all returned relation groups and keeps
existing dependency authoring below it.

## Phase 4: User Story 2 — Inspect related Product context (Priority: P2)

**Goal**: Give users related Product type, criticality, health, Component
count, and navigation without per-node request fan-out.

**Independent Test**: Select related Products with non-null and null health;
verify details, no-data behavior, bounded reads, and correct navigation.

### Tests for User Story 2

- [ ] T014 [P] [US2] Add failing ProductRef mapper/type tests for related
      criticality, Product health, and Component count in
      `packages/frontend/src/test/unit/ux-mappers.test.ts`
- [ ] T015 [P] [US2] Add failing bounded-read/query-count coverage for related
      Product enrichment in `packages/backend/test/integration/performance.test.ts`

### Implementation for User Story 2

- [ ] T016 [US2] Batch-compute health and Component counts for all related
      ProductRefs and report unavailable relation groups in
      `packages/backend/src/services/product-service.ts`
- [ ] T017 [US2] Extend `ProductRef` and `ProductDetail` API types in
      `packages/frontend/src/api/types.ts` for related health, criticality,
      Component count, and `unavailableRelationGroups`
- [ ] T018 [US2] Map related Product fields through the catalog view mapper in
      `packages/frontend/src/api/mappers/catalog.ts`
- [ ] T019 [US2] Add the accessible inspection panel and Open Product action
      in `packages/frontend/src/ux/components/products/product-map.tsx`
- [ ] T020 [US2] Add the related Product fields to the canonical response
      schema in `docs/openapi.yaml`
- [ ] T021 [US2] Regenerate API documentation from `docs/openapi.yaml` with
      `pnpm --filter @componode/backend docs:api` and verify `docs/api.md`

**Checkpoint**: Related Product detail is available in one bounded read and
null health remains no data.

## Phase 5: User Story 3 — Operate the topology accessibly (Priority: P1)

**Goal**: Make focus, inspection, expansion, and responsive use available
without mouse-only behavior or graph editing.

**Independent Test**: Complete a keyboard-only inspection journey at 1280px
and 768px, including node selection, `+N`, panel navigation, and Escape.

### Tests for User Story 3

- [ ] T022 [P] [US3] Add failing keyboard, accessible-name, focus-announcement,
      and Escape tests in `packages/frontend/src/test/unit/product-map.test.tsx`
- [ ] T023 [P] [US3] Add failing responsive, reduced-motion, and no-horizontal-
      overflow checks in `playwright/tests/journeys/product-map.spec.ts`

### Implementation for User Story 3

- [ ] T024 [US3] Make Product and ComponentGroup nodes keyboard-operable
      controls with semantic names and focus state in
      `packages/frontend/src/ux/components/products/product-map.tsx`
- [ ] T025 [US3] Add the polite focus announcement and Escape/empty-canvas
      clearing behavior in `packages/frontend/src/ux/components/products/product-map.tsx`
- [ ] T026 [US3] Implement stacked/narrow relation lanes and reduced-motion
      behavior in `packages/frontend/src/ux/components/products/product-map.tsx`
- [ ] T027 [US3] Update the normative Product Map and Dependencies
      information-architecture text in `docs/ux.md`

## Phase 6: Documentation and verification

- [ ] T028 Verify ADR-118 Amendment 1, ADR-127, ADR-103 back-pointer, and
      `researches/architecture-decisions.md` remain consistent
- [ ] T029 Verify the `productMapTopology` fallback/gap pair in
      `packages/frontend/src/ux/lib/flags.ts` and `researches/ux-rewrite-gaps.md`
- [ ] T030 Run `pnpm --filter @componode/backend test:integration`,
      `pnpm --filter @componode/frontend test:unit`, and the Product Map journey
      in `playwright/tests/journeys/product-map.spec.ts`
- [ ] T031 Run `pnpm --filter @componode/backend docs:api:check`,
      `pnpm --filter @componode/frontend typecheck`, and `git diff --check`

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no implementation dependencies.
- **Foundational (Phase 2)**: blocks all story implementation.
- **US1 (Phase 3)**: depends on relation-direction fixtures and the existing
  Product detail response.
- **US2 (Phase 4)**: depends on US1's typed relation data.
- **US3 (Phase 5)**: may begin with US1, but final keyboard navigation depends
  on the selected node/detail-panel structure.
- **Documentation and verification (Phase 6)**: after the read contract and
  user-facing surface are finalized.

### Parallel Opportunities

- T003/T004 and T005 can be written in parallel in separate files.
- T014 and T015 can be written in parallel.
- Backend read enrichment and frontend unit test work can proceed in parallel
  after foundational fixtures are defined.

## Implementation Strategy

1. Establish failing direction and read-contract tests.
2. Deliver complete topology and relation navigation as the first usable
   slice.
3. Add related Product context through the bounded read.
4. Complete keyboard, responsive, and reduced-motion behavior.
5. Update flags/gap documentation, OpenAPI, and generated API docs; run the
   end-to-end journey and contract checks.
