# Tasks: Component dependencies in Product topology

**Input**: Design documents from `/specs/061-topology-component-deps/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/topology-view-model.md`, `quickstart.md`

**Tests**: Required by Constitution Principle VI. Add failing tests before
implementation and verify each failure has the intended cause.

## Phase 1: Setup

- [x] T001 Confirm the `061-topology-component-deps` branch and
      `.specify/feature.json` point to `specs/061-topology-component-deps/spec.md`
- [x] T002 Review `packages/frontend/src/ux/components/products/product-map.tsx`,
      `packages/frontend/src/api/mappers/catalog.ts` (`mapProductTopology`,
      `mapDepComponent`, `worstInstanceStatus`),
      `packages/frontend/src/ux/app/products/$slug.tsx`, and
      `researches/adrs/ADR-127-product-map-topology-in-dependencies.md`

## Phase 2: Foundational

**Purpose**: Extend the view-model contract before any lane/UI work; all
stories consume `TopologyComponent` and `ProductTopology.dependsOnComponents`.

- [x] T003 [P] Add failing mapper tests in
      `packages/frontend/src/test/unit/ux-mappers.test.ts` for
      `mapProductTopology`: `dependsOnComponents` contains only
      `components.declared` refs with a `DIRECT` `DepSource` (GROUP-only and
      INHERITED-only refs excluded), carries `lifecycle` (RETIRED preserved),
      `category`, and `worstStatus` from the instances rollup (null when no
      instances)
- [x] T004 [P] Add failing lane tests in
      `packages/frontend/src/test/unit/product-map.test.tsx`: a topology with
      `dependsOnComponents` renders a "Depends on components" lane with nodes,
      a product whose only relations are component deps does NOT render "No
      relationships yet", and `GROUP`-mediated components are absent from the
      lane
- [x] T005 Add `TopologyComponent` interface and `dependsOnComponents` field to
      `ProductTopology` in `packages/frontend/src/ux/lib/view-types.ts`
      (fields per `data-model.md`: id, name, slug, category, lifecycle,
      worstStatus)
- [x] T006 Extend `mapProductTopology` in
      `packages/frontend/src/api/mappers/catalog.ts` to accept
      `{ instances?, catalog? }` extras and populate `dependsOnComponents`
      (DIRECT-source filter, `worstInstanceStatus` rollup, `narrow` lifecycle);
      update the call in `packages/frontend/src/ux/app/products/$slug.tsx` to
      pass `allInstances` and `catalog.data`

**Checkpoint**: `pnpm test -- ux-mappers` and `pnpm test -- product-map` in
`packages/frontend` compile and the T003/T004 assertions fail for the intended
reason (no component nodes yet).

## Phase 3: User Story 1 — See direct Component dependencies in the topology (Priority: P1)

**Goal**: Render direct `DEPENDS_ON` Component targets as typed nodes in a
dedicated outgoing lane.

**Independent Test**: Fixture with two DIRECT component deps and no other
relations renders the lane with both nodes, directed `product → component`
edges, and no empty state.

### Tests for User Story 1

- [x] T007 [US1] Extend `packages/frontend/src/test/unit/product-map.test.tsx`:
      accessible node names carry "<component>, <product> depends on"
      direction text; edge `product → component` is drawn (arrowhead at the
      component node); lanes render alongside `dependsOnGroups` without
      duplication

### Implementation for User Story 1

- [x] T008 [US1] Add `"dependsOnComponents"` to `LaneKey`, `LANE_META`
      (`incoming: false`, title "Depends on components", hint
      `${product.name} → components`), and `TopologyNode` `kind: "component"`
      in `packages/frontend/src/ux/components/products/product-map.tsx`; build
      the lane from `topology.dependsOnComponents`; render the lane column on
      the outgoing side (order: composes, consumesFrom, dependsOnComponents,
      dependsOnGroups)
- [x] T009 [US1] Extend `nodeStatus`/`StatusDot` in `product-map.tsx` so a
      component node's dot shows `worstStatus` (`InstanceStatus`), with the
      dashed no-data dot when null; `RETIRED` lifecycle shows the existing
      retired label
- [x] T010 [US1] Include component nodes in `allNodes`/`visibleKeys`/edge
      drawing in `product-map.tsx` (outgoing edge from `product` to
      `dependsOnComponents:<id>`)

**Checkpoint**: Banking + Landing Page renders `Banking → Landing Page` in the
map; `pnpm test -- product-map` US1 assertions pass.

## Phase 4: User Story 2 — Inspect a Component node (Priority: P1)

**Goal**: Selecting a component node opens an inspection panel with status and
navigation.

**Independent Test**: Select component nodes with failing/healthy/no-instance
status; verify panel contents, accessible name, announce, Escape, `+N`, and
"Open component" link.

### Tests for User Story 2

- [x] T011 [US2] Extend `packages/frontend/src/test/unit/product-map.test.tsx`:
      selecting a component node opens the inspection panel (name, Component
      context, HealthBadge or "No health data"), the "Open component" link
      points to `/components/<slug>`, Enter/Space select + announce, Escape
      clears, `+N` expansion reveals the fifth+ node, retired component shows
      the Retired label

### Implementation for User Story 2

- [x] T012 [US2] Extend the inspection panel in `product-map.tsx` for
      `kind: "component"`: name, "Component dependency" relation context,
      `HealthBadge` or no-data text, and `Open component` link to
      `ux("/components/" + slug)`; node accessible name/status text per
      `contracts/topology-view-model.md`
- [x] T013 [US2] Wire component nodes into the existing `+N` overflow,
      selection, `aria-live` announcement, and Escape-clear paths in
      `product-map.tsx` (no separate component-only interaction paths)

**Checkpoint**: `pnpm test -- product-map` fully green for US1+US2.

## Phase 5: User Story 3 — Honest empty and copy states (Priority: P2)

**Goal**: Empty state only when zero relations of any kind; copy distinguishes
dependency kinds.

**Independent Test**: A topology with all families empty renders the honest
empty state; card description and empty copy name the relation kinds the map
covers.

### Tests for User Story 3

- [x] T014 [US3] Extend `packages/frontend/src/test/unit/product-map.test.tsx`:
      all-empty topology renders the empty state; a topology with only
      `dependsOnComponents` does not; copy asserts the empty text does not
      claim the product "depends on nothing" in a way that conflates
      dependency kinds

### Implementation for User Story 3

- [x] T015 [US3] Update `product-map.tsx` `CardDescription` and empty-state
      copy: description covers "who composes and consumes it, and which
      components and groups it depends on"; empty text names the covered
      relation kinds per `contracts/topology-view-model.md`

**Checkpoint**: No false "depends on nothing" copy for any populated lane.

## Phase 6: Polish, Governance & Ship Docs

- [x] T016 [P] Append Amendment 2 to
      `researches/adrs/ADR-127-product-map-topology-in-dependencies.md`:
      direct `DEPENDS_ON` Component targets appear as topology nodes
      (supersedes the Amendment-1 component exclusion for direct edges only;
      group-mediated paths still resolve to the group node); register the
      amendment in `researches/architecture-decisions.md` if the index tracks
      amendments
- [x] T017 [P] Update the product-topology bullet in `docs/ux.md` to mention
      the components lane
- [x] T018 Run `pnpm lint && pnpm typecheck && pnpm test` in
      `packages/frontend`; run the `docs:*:check` scripts touched
      (`docs:oracle:check`, `docs:sidebar:check` if docs edited)
- [x] T019 Run the manual `quickstart.md` flow (Banking + Landing Page) and
      verify no console errors, no extra requests, no writes
- [x] T020 Add a `.changeset` entry for the user-facing fix (patch, frontend)
- [x] T021 Update `docs/roadmap.md`: mark `061-topology-component-deps`
      shipped under Shipped and revise the Next entry (at merge time, with
      spec `Status` flip)

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 (foundational view-model blocks all lanes)
- Phase 2 → Phases 3–5 (each story independently testable; 3 and 4 are both
  P1 and land in the same file — sequence 3 → 4 to avoid conflicts; 5 is
  independent)
- Phase 6 after all stories

### Parallel Opportunities

- T003 and T004 (different test files) in parallel
- T008–T010 same file, sequential
- T016 and T017 (different docs files) in parallel

## Implementation Strategy

MVP = Phases 1–3 (lane renders honest topology). Phase 4 adds inspection;
Phase 5 copy; Phase 6 governance. Ship all phases in one PR — the feature is
small enough that partial delivery adds no value.

## Phase 7: Review

- [x] T022 Exclude `GONE` inside `worstInstanceStatus` in `packages/frontend/src/api/mappers/catalog.ts` so the view-model never presents it as health (code-review: spec FR-002) (partial)
- [x] T023 Add a "Component" kind identifier to the component inspection panel in `packages/frontend/src/ux/components/products/product-map.tsx` (code-review: spec FR-005) (partial)
- [x] T024 Distinguish all four relation kinds (composition, consumption, component, group) in the empty-state and CardDescription copy in `product-map.tsx` (code-review: spec FR-007) (partial)
- [x] T025 Include ", retired" in accessible node names for retired nodes in `product-map.tsx` (code-review: standards WCAG 2.5.3 + spec FR-002) (partial)
- [x] T026 Extract a shared `isDirectDep` predicate in `catalog.ts` used by `mapProductTopology` and `$slug.tsx` (code-review: standards) (partial)
- [x] T027 Use valid `COMPONENT_CATEGORIES` values in `product-map.test.tsx`/`ux-mappers.test.ts` fixtures plus one explicit unknown-category passthrough test (code-review: standards) (partial)
- [x] T028 Align `specs/061-topology-component-deps/contracts/topology-view-model.md` extras signature with the implemented `{ instances? }` (code-review: spec) (partial)
- [x] T029 Add a product-topology line covering the components lane in `docs/using-the-catalog.md` (code-review: standards, AGENTS.md docs rule) (missing)

- [x] T030 Add a GONE-instance fixture to the spec-061 mapper test block in `packages/frontend/src/test/unit/ux-mappers.test.ts` proving `worstStatus` ignores GONE rows (code-review: standards round 2) (missing)
