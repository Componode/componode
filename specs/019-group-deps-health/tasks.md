---

description: "Task list for 019-group-deps-health implementation"

---

# Tasks: Group Dependencies & Product Health

**Input**: Design documents from `/specs/019-group-deps-health/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Included — constitution VI (test-first). Every story's tests are written and confirmed failing before its implementation tasks.

**Organization**: US1 (health rollup) and US2 (group edges) both consume the
read-time expansion built in Foundational; they are independently shippable
after it (health works with zero group edges; group edges work without
health). US3 extends US2's union path.

## Phase 1: Setup

- [x] T001 Confirm green baseline on `feature/019-group-deps-health`: `pnpm install && pnpm lint && pnpm typecheck && pnpm --filter @componode/backend vitest run test/integration/products.test.ts test/integration/component-groups.test.ts test/integration/dashboard.test.ts`

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared substrate both stories consume — the junction table, the
expanded dependency read-path (`sources[]` model), and the core contract
types. No story work can begin until this phase is complete.

- [x] T002 Create migration `packages/backend/src/db/migrations/013_product_depends_on_group.ts` — `product_depends_on_component_group` table: `productId uuid NOT NULL REFERENCES digital_products ON DELETE CASCADE`, `componentGroupId uuid NOT NULL REFERENCES component_groups ON DELETE CASCADE`, composite PK `(productId, componentGroupId)`, `createdAt timestamptz NOT NULL DEFAULT now()`, plus a plain index on `componentGroupId`; `down()` drops the table. Migrations are auto-discovered by filename — no registration
- [x] T003 [P] Add the junction row type to `packages/backend/src/db/types.ts` (mirror `product_depends_on_component` entry)
- [x] T004 [P] Add core contract types in `packages/core/src/contracts/digital-product.ts` (and re-export via `packages/core/src/index.ts`): `ProductHealthStatus = "RUNNING"|"STOPPED"|"ERROR"`, `ProductHealth {status, perEnv: Partial<Record<Environment, ProductHealthStatus>>, sourceCount}`, `DepSource = {kind:"DIRECT"} | {kind:"GROUP"; group:{id,name,slug}} | {kind:"INHERITED"; product:{id,name,slug}}`, `ComponentDepRef.sources: DepSource[]` (replaces `via`), `dependsOnGroups` + `health` on `ProductDetail`, `status: ProductHealthStatus|null` on list rows; add `memberCount` to `packages/core/src/contracts/component-group.ts` list item; add `"PRODUCT_ERROR"` to the attention-kind union
- [x] T005 Rewrite the dependency read-path in `packages/backend/src/services/product-service.ts` `getProductDetail`: declared dep rows become per-component-unique rows with `sources[]` — direct edges → `{kind:"DIRECT"}`; `product_depends_on_component_group` → join `components` on `componentGroupId` → `{kind:"GROUP", group}`; descendant (COMPOSES) products' direct + group edges → `{kind:"INHERITED", product}`; `declared[]` = rows with ≥1 DIRECT/GROUP source, `inherited[]` = rows with only INHERITED sources; add `dependsOnGroups: {id,name,slug,memberCount}[]` to the response (raw group edges, incl. empty groups); group members join the declared instance set
- [x] T006 Update `packages/frontend/src/api/types.ts` (`ComponentDepRef.sources`, `dependsOnGroups`, `health`, list-row `status`, `memberCount`, `PRODUCT_ERROR` kind) and update the `componentTable` Via column in `packages/frontend/src/pages/product-detail.tsx` to render `sources` (`DIRECT` → "—", `GROUP` → "via {group name}", `INHERITED` → "via {product name}") — minimal render only, group UX polish lands in US2

**Checkpoint**: existing product/component integration suites stay green (direct + inherited attribution preserved); detail response carries `sources[]`, `dependsOnGroups`, and the junction table exists — ready for both stories.

## Phase 3: User Story 1 — See whether my product is affected (Priority: P1) 🎯 MVP

**Goal**: Derived read-only product health — worst-of non-`GONE` instance
status over declared dep sources, `PRODUCTION` headline, `RETIRED`-component
exclusion, null-when-empty — on detail (`health`), list rows (`status`),
and dashboard attention (`PRODUCT_ERROR`).

**Independent Test**: product + component + `ERROR` PRODUCTION instance →
`GET /products/:slug` shows `health.status="ERROR"`, `GET /products` row
shows `status="ERROR"`, dashboard attention lists the product; instance
recovers → all three clear. Works with zero group edges; group-member
sources are covered by seeding the junction directly in test fixtures.

### Tests for User Story 1 (write first, confirm FAIL)

- [x] T007 [P] [US1] Unit-test the aggregation matrix in `packages/core/test/product-health.test.ts` — worst-of ranking `ERROR>STOPPED>RUNNING`; `PRODUCTION` headline when any PRODUCTION instance exists vs all-env fallback; `GONE` instances excluded; `RETIRED`-component instances excluded; zero contributing instances → `null`; `perEnv` per-environment breakdown; `sourceCount` = distinct components with ≥1 contributing instance (SC-003)
- [x] T008 [P] [US1] Integration tests in `packages/backend/test/integration/product-health.test.ts` — `GET /products/:slug` returns `health` (ERROR via PROD instance; headline-vs-perEnv PROD/DEV split; `null` for no deps and GONE-only sources); `GET /products` rows carry `status`; dashboard `attention[]` gains `kind:"PRODUCT_ERROR"` items ordered after `FAILED_RUN` and before instance items with `href:"/products/{slug}"`; `GONE`-only and `RETIRED`-product cases absent from attention; a junction-seeded group member's `ERROR` instance feeds health (US1/AC1–AC7)

### Implementation for User Story 1

- [x] T009 [US1] Implement `packages/core/src/product-health.ts` — pure `computeProductHealth(rows: {environment, status, componentLifecycle}[]): ProductHealth | null` per the data-model rules; re-export via `packages/core/src/index.ts`
- [x] T010 [US1] Create `packages/backend/src/services/product-health-service.ts` — batch loader: given product ids, fetch direct + group-expanded declared dep component ids (constant query count, no N+1), fetch non-`GONE` instances for those components with component `lifecycle`, run `computeProductHealth` per product
- [x] T011 [US1] Wire health into `packages/backend/src/services/product-service.ts` — `getProductDetail` returns `health` (declared sources only — `COMPOSES`-inherited deps never feed it, clarified 2026-10-18); `listProducts` adds `status` per row via the batch service
- [x] T012 [P] [US1] Extend `packages/backend/src/services/dashboard-service.ts` — compute health for ACTIVE products, append `PRODUCT_ERROR` attention items (`label` = product name, `href` = `/products/{slug}`) after `FAILED_RUN`, before instance items; `ATTENTION_LIMIT` still applies
- [x] T013 [P] [US1] Product detail health badge + per-env breakdown in `packages/frontend/src/pages/product-detail.tsx` — headline badge next to type/lifecycle badges, `perEnv` breakdown surfaced (popover/tooltip or inline list); `health:null` renders muted "—"
- [x] T014 [P] [US1] Health `status` badge on product list rows in `packages/frontend/src/components/products/product-tree.tsx` — `null` renders "—"
- [x] T015 [P] [US1] Dashboard `PRODUCT_ERROR` rendering in `packages/frontend/src/pages/dashboard.tsx` (`ATTENTION_LABEL` entry + status badge mapping) and update `packages/frontend/src/test/unit/dashboard.test.tsx` + `product-detail.test.tsx`/`product-tree.test.tsx` for badges

**Checkpoint**: US1 complete — the three surfaces agree on health and clear on recovery; `pnpm --filter @componode/backend vitest run test/integration/product-health.test.ts` green.

## Phase 4: User Story 2 — Depend on a whole component group (Priority: P2)

**Goal**: `DEPENDS_ON` accepts a `ComponentGroup` target — persisted
product→group, expanded at read, "via {group}" attribution, `?kind=`
removal, `component_group` audit, delete guards both directions.

**Independent Test**: group with members → `POST /products/{id}/depends-on {componentGroupId}` → `204`; detail lists members "via {group}"; add a member → appears without rewiring; `DELETE …?kind=group` removes the group edge only.

### Tests for User Story 2 (write first, confirm FAIL)

- [x] T016 [P] [US2] Integration tests in `packages/backend/test/integration/product-group-edges.test.ts` — union validation (zero/both forms → `400 VALIDATION_FAILED`); group add → `204` + audit row `toEntityType:"component_group"` (verify the entry surfaces in the product's History feed via the generic edge format — no name resolver needed); expansion shows members "via {group}"; dedup matrix: component reachable direct + via group → one row, both sources; same component in two depended-on groups → one row, both groups; component reachable via declared edge AND COMPOSES-inherited → one row, all sources; member added later propagates; empty-group edge valid + visible in `dependsOnGroups`; `DELETE …?kind=group` removes group edge only (direct member edges survive); `DELETE` group edge without `?kind` → `404`; product delete → `409 REFERENCED` counts group edges; `DELETE /component-groups/:id` on depended-on group → `409 REFERENCED` with `details.products` naming blockers, group retirement still allowed (US2/AC1–AC8, FR-001–FR-009)
- [x] T017 [P] [US2] Frontend unit test in `packages/frontend/src/test/unit/edge-picker.test.tsx` — depends-on picker lists groups with "(group · N)" labels and submits `componentGroupId`; retired groups excluded

### Implementation for User Story 2

- [x] T018 [US2] Extend `addDependsOnEdgeSchema` in `packages/core/src/schemas/product.ts` — strict object, exactly one of `{componentId}` or `{componentGroupId}` (Zod refine; mixed/zero → `400`)
- [x] T019 [US2] Update `addDependsOnEdge`/`removeDependsOnEdge` in `packages/backend/src/services/product-edge-service.ts` — group branch validates product + group existence (`404`), inserts junction row (`onConflict doNothing`), audit `writeEdgeChange("DEPENDS_ON_COMPONENT", …, {entityType:"component_group", entityId: groupId})`; remove gains a `kind: "component"|"group"` param deleting from the matching junction (`404` on miss)
- [x] T020 [US2] Pass `?kind=` through in `packages/backend/src/routes/products.ts` DELETE `/products/:id/depends-on/:componentId` — rename the path param to `targetId` (URL shape unchanged), parse `kind` query defaulting to `component`, accept `group`; openapi documents `targetId` + `kind` (backward compatible)
- [x] T021 [US2] Count `product_depends_on_component_group` in `countProductEdges` (`packages/backend/src/services/product-service.ts`) so the product delete guard `409 REFERENCED` covers group edges (FR-008)
- [x] T022 [US2] Update `packages/backend/src/services/component-group-service.ts` — `listComponentGroups` adds `memberCount` (count subquery on `components.componentGroupId`); `deleteComponentGroup` counts referencing junction rows → `409 REFERENCED` with `details.products` [{id,name,slug}] (FR-009)
- [x] T023 [P] [US2] Edge picker group options in `packages/frontend/src/components/products/edge-picker.tsx` — merge `useComponentGroups()` results into the depends-on list labeled "{name} (group · N)", submit `{componentGroupId}` (FR-010)
- [x] T024 [P] [US2] Remove-edge `kind` param in `packages/frontend/src/api/hooks/products.ts` `useRemoveEdge` (`?kind=group` query on DELETE)
- [x] T025 [US2] Product detail group-dep affordances in `packages/frontend/src/pages/product-detail.tsx` — "Group dependencies" block rendering `dependsOnGroups` (name · memberCount, remove button → `kind=group`); per-row remove for direct component edges (parity, `kind=component`); Via column already renders sources (T006)

**Checkpoint**: US2 complete — group edge lifecycle works end-to-end incl. guards; `product-group-edges.test.ts` green.

## Phase 5: User Story 3 — Wire several components in one request (Priority: P3)

**Goal**: `componentIds[]` bulk form — atomic, idempotent, one audit row per
edge.

**Independent Test**: `{componentIds:[a,b,c]}` → `204`, three edges + three
audit rows; repeat → `204`, no dupes; one bad id → `404`, zero edges.

### Tests for User Story 3 (write first, confirm FAIL)

- [x] T026 [P] [US3] Integration tests in `packages/backend/test/integration/product-bulk-edges.test.ts` — bulk creates all edges in one transaction with per-edge audit entries; unknown id fails the whole request (`404`, zero applied); already-existing pairs idempotent; empty array → `400`; mixed forms (`componentId` + `componentIds`) → `400` (US3/AC1–AC4, FR-003, FR-004)

### Implementation for User Story 3

- [x] T027 [US3] Widen `addDependsOnEdgeSchema` in `packages/core/src/schemas/product.ts` — add `componentIds: z.array(z.string().uuid()).min(1).max(100).optional()` to the union (still exactly-one-of the three forms)
- [x] T028 [US3] Add the `componentIds[]` branch in `addDependsOnEdge` (`packages/backend/src/services/product-edge-service.ts`) — dedupe the array, verify all components exist (any miss → `404 NOT_FOUND` listing misses in `details`), single transaction: insert all (`onConflict doNothing`) + one `writeEdgeChange` per edge

**Checkpoint**: US3 complete — bulk wiring atomic and audited; `product-bulk-edges.test.ts` green.

## Phase 6: Polish & Cross-Cutting

- [x] T029 Update `docs/openapi.yaml` — POST depends-on union body, DELETE `?kind=` param, detail response (`sources[]`, `dependsOnGroups`, `health`), list-row `status`, dashboard `PRODUCT_ERROR` kind, `memberCount`, `DELETE /component-groups/:id` 409 — then `pnpm --filter @componode/backend docs:api` to regenerate `docs/api.md`; `test/unit/api-docs-contract.test.ts` must pass (ADR-104)
- [x] T030 [P] Update `docs/digital-products.md` (group targets + "via {group}" semantics + health rollup rules) and the AGENTS.md graph rule — add "`DEPENDS_ON` may target a `ComponentGroup` (ADR-110); product health is a derived rollup over declared dep sources (ADR-112)"
- [x] T031 [P] Add changeset `.changeset/group-deps-health-019.md` — minor bumps `@componode/core`, `@componode/backend`, `@componode/frontend`
- [x] T032 Full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; walk every `quickstart.md` scenario (group wiring + propagation, dedup, empty group, kind-aware removal, both delete guards, bulk atomicity, all health matrix rows incl. PROD-headline and `—`); sweep `grep -rn "componentId" docs/openapi.yaml` for the old single-form body and confirm contract-test drift is clean (SC-001–SC-005)
- [x] T033 Update `docs/roadmap.md` — move `019-group-deps-health` to Shipped; revise the Next list (020-platform-product-workflow heads the queue)

## Dependencies

```text
Phase 1 (Setup) → Phase 2 (Foundational) → {US1, US2} → US3 → Phase 6 (Polish)

Foundational:  migration + junction types + sources[] expansion — shared by
               both stories; T005/T006 can parallelize after T002–T004
US1 (health):  independent of US2 — health over zero group edges is correct;
               group-member sources light up automatically once US2 lands
US2 (groups):  independent of US1 — expansion + write path need no health
US3 (bulk):    depends on US2's union schema/service (extends the same fn)
Polish:        after all stories
```

## Parallel Execution

- **Foundational**: T003 ∥ T004 (different packages); T005 ∥ T006 once contracts exist
- **US1**: T007 ∥ T008 (test files); after T009+T010, T012 ∥ T013 ∥ T014 ∥ T015 (backend service vs three frontend files); T011 follows T010 (same service file as T005 — serialize)
- **US2**: T016 ∥ T017 (test files); T018 → T019 → T020 (schema → service → route, sequential); T021 ∥ T022 ∥ T023 ∥ T024 (different files); T025 last (depends on T024 + T006)
- **US3**: T026 (test file) ∥ nothing — small phase; T027 → T028 sequential

## Implementation Strategy

**MVP**: Phase 1 + 2 + US1 — health rollup alone answers "is my product
affected?" over today's direct edges; it ships value before any group edge
exists.

**Increment 2**: US2 adds the write path + guards + picker — the N-edges tax
disappears and health picks up group sources for free.

**Increment 3**: US3 widens the union with bulk — three-phase delivery keeps
each checkpoint independently green.

**Test-first discipline**: every story's test task precedes its
implementation tasks and must be observed failing (junction row absent /
`health` field absent / union not accepted) before coding the story.

## Phase 7: Convergence

- [x] T034 Exclude `RETIRED` products from dashboard health-attention per Edge Cases ("retired products … attention section follows the same lifecycle filtering") + T012 intent (missing): add a lifecycle predicate to the `allProducts` query in `packages/backend/src/services/dashboard-service.ts` (`digital_products.lifecycle != "RETIRED"`, matching the `listProducts` default convention), and add a regression case in `packages/backend/test/integration/product-health.test.ts` seeding a `RETIRED` product whose sources are in `ERROR` asserting no `PRODUCT_ERROR` item for it — test first, observe failure, then fix
