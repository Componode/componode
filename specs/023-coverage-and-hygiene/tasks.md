# Tasks: Catalog Coverage & Hygiene

**Input**: Design documents from `/specs/023-coverage-and-hygiene/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/api.md, quickstart.md

**Tests**: Included — test-first is non-negotiable (constitution VI).
Write the failing test, confirm it fails, implement until green.

**Organization**: Grouped by user story; each story is independently
testable. Shared derivations live in Phase 2 (blocking) so metric, filter,
and chip semantics are defined exactly once (research D2/D3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story from spec.md (US1–US5)
- Every task names exact file paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Contract types every story depends on

- [X] T001 Create `packages/core/src/contracts/catalog-coverage.ts` —
  `CatalogCoverage` (`{components: {active, wired, wiredPct: number|null},
  products: {total, missingOwner, missingDependencies,
  missingDescription}}`) and `ProductCompleteness` (`{owner: boolean,
  description: boolean, dependencies: boolean}`); export both from
  `packages/core/src/index.ts` (contract shapes per `data-model.md` and
  `contracts/api.md`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The two shared derivations — wired-component set and
dependency-surface map — that US1, US2, and US4 all consume

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Failing integration test for the shared derivations in
  `packages/backend/test/integration/catalog-coverage.test.ts`
  (testcontainers): seed a catalog covering (a) direct `DEPENDS_ON` edge,
  (b) group-expanded coverage (member of a depended-on `ComponentGroup`,
  no direct edge), (c) component claimed only by a `RETIRED` product →
  unwired, (d) `RETIRED` component and gone-only `ACTIVE` component both
  excluded from the coverage population entirely — including under
  `includeRetired`/`includeGone` toggles, (e)
  `PENDING` suggestion pair → unwired, (f) product with only an
  empty-group edge → surface non-empty, (g) product relieved by a
  non-retired `COMPOSES` descendant's `DEPENDS_ON` (recursive, 2+ levels),
  (h) `RETIRED` descendant does NOT relieve the parent, (i) product's own
  `CONSUMES_FROM` satisfies its own surface — assert the wired set and the
  surface set against these fixtures. Confirm failure before T003
- [X] T003 Implement `packages/backend/src/services/catalog-coverage-service.ts`
  — `coveragePopulationPredicate` (or equivalent shared builder):
  `components.lifecycle = 'ACTIVE'` AND (no instances OR EXISTS instance
  with `status != 'GONE'`) — reuse the `component-catalog-service.ts`
  gone-only logic; plus `wiredComponentIdsQuery()`: Kysely `UNION` subquery of
  `product_depends_on_component.componentId` joined to non-retired
  `digital_products` + `components.id` via
  `componentGroupId ∈ product_depends_on_component_group` joined to
  non-retired products (verbatim SQL in `data-model.md`); and
  `computeDependencySurfaces(productIds?)` returning `Set<string>` of
  non-retired product ids with non-empty surface — own `DEPENDS_ON`
  (direct or group target), own `CONSUMES_FROM` (`consumerId`), or a
  `DEPENDS_ON` on a non-retired `COMPOSES` descendant via `WITH RECURSIVE`
  parent→child CTE (same direction as `product-service.ts` `descendants`).
  Kysely parameterized only — no `sql.raw()` (ADR-084)

**Checkpoint**: Shared derivations green — user stories can proceed

---

## Phase 3: User Story 1 - See how completely the catalog is wired (Priority: P1) 🎯 MVP

**Goal**: Dashboard reports wired-component share plus the three
product-gap counts

**Independent Test**: `GET /api/v1/dashboard/summary` returns `coverage`
matching manual counts; zero-denominator renders "—" (quickstart §1)

- [X] T004 [US1] Extend `catalog-coverage.test.ts` with dashboard-summary
  cases: `coverage.components` counts/`wiredPct` agree with fixtures;
  `wiredPct` is `null` when `active = 0`; `coverage.products.*` counts
  ownerless / empty-surface / undescribed over non-retired products only.
  Confirm failure before T005
- [X] T005 [US1] Implement `getCatalogCoverage()` in
  `catalog-coverage-service.ts` (uses T003 helpers + column predicates
  `lobOwnerId/teamOwnerId IS NULL`, `description IS NULL OR btrim = ''`)
  and add `coverage` to `DashboardSummary` + `getDashboardSummary()` in
  `packages/backend/src/services/dashboard-service.ts`
- [X] T006 [P] [US1] Add `CatalogCoverage`/`coverage` to
  `packages/frontend/src/api/types.ts` (`DashboardSummary`) and render a
  "Catalog coverage" section in
  `packages/frontend/src/pages/dashboard.tsx` — tiles per
  `contracts/api.md`: wired share (`{wiredPct}%` or muted "—",
  `N wired / M active`) → `/components?wired=unwired`; three product-gap
  counts → `/products?missing=owner` / `missing=dependencies` /
  `missing=description`. (Filter params land in US2; until then links
  degrade to the unfiltered lists — acceptable, noted in spec FR-003)
- [X] T007 [P] [US1] Frontend unit test for the coverage section in
  `packages/frontend/src/test/unit/catalog-coverage.test.tsx` — tiles
  render counts/links, null `wiredPct` renders "—"

**Checkpoint**: US1 delivers dashboard coverage independently

---

## Phase 4: User Story 2 - Work coverage gaps from filtered lists (Priority: P2)

**Goal**: `wired` filter on components + `missing` facet on products make
every coverage figure a shareable worklist

**Independent Test**: `/components?wired=unwired` row count equals
`active − wired`; `/products?missing=owner` returns exactly the ownerless
set (quickstart §2)

- [X] T008 [US2] Extend `catalog-coverage.test.ts`: `GET
  /components?wired=unwired` returns exactly the unwired default-visible
  set (`ACTIVE`, not gone-only; group-covered members excluded);
  `wired`/`unwired` apply the population predicate even with
  `includeRetired=true`/`includeGone=true`;
  `wired=wired` is the complement; both selected = unfiltered. `GET
  /products?missing=owner|dependencies|description` each return exactly
  the failing set; CSV values combine with OR; `missing` composes with
  `type`/`q`. Filter counts equal the `coverage` figures. Confirm failure
  before T009–T010
- [X] T009 [US2] Add `wired` (`stringOrStringArray`, values `wired` /
  `unwired`) to `listComponentsQuerySchema` in
  `packages/core/src/schemas/components.ts` and implement the filter in
  `packages/backend/src/services/component-catalog-service.ts` using
  `wiredComponentIdsQuery()` — `whereRef("components.id", "in", subquery)`
  for `wired`, `not in` for `unwired`, OR when both selected (reuse
  `normalizeValues`); **and** apply the shared coverage-population
  predicate whenever `wired` is present so retired/gone-only rows never
  satisfy either value
- [X] T010 [US2] Add `missing` (`stringOrStringArray`, values `owner` /
  `dependencies` / `description`) to `listProductsQuerySchema` in
  `packages/core/src/schemas/product.ts` (keep `.strict()`) and implement
  in `listProducts` in `packages/backend/src/services/product-service.ts`
  — OR of: `lobOwnerId IS NULL AND teamOwnerId IS NULL` / `id NOT IN
  surface set` via `computeDependencySurfaces()` / `description IS NULL OR
  btrim(description) = ''`
- [X] T011 [P] [US2] Add `wired` to `ComponentListFilters` in
  `packages/frontend/src/api/hooks/components.ts` and a "Wiring"
  `FacetFilter` (options Wired/Unwired) in
  `packages/frontend/src/components/component-filters.tsx` — include in
  `FACET_KEYS`/`clearAll`
- [X] T012 [P] [US2] Add `missing` to `ProductListParams` in
  `packages/frontend/src/api/hooks/products.ts` and a "Completeness"
  `FacetFilter` (options No owner / No dependencies / No description) in
  `packages/frontend/src/pages/products.tsx`; add `missing` to the
  `filtering` flag so it flattens the tree per `docs/ux.md` §5
- [X] T013 [P] [US2] Frontend unit test for both facets in
  `packages/frontend/src/test/unit/catalog-coverage.test.tsx` — URL param
  round-trips, facet selection emits the right `wired`/`missing` values

**Checkpoint**: US1+US2 — every coverage figure clicks through to a
matching filtered list

---

## Phase 5: User Story 3 - Get flagged about overdue sunsets (Priority: P3)

**Goal**: `ACTIVE` entities past `sunsetAt` appear in the attention feed,
ranked below operational items

**Independent Test**: Past `sunsetAt` on an active product and component →
two attention items; retired/future-sunset produce none (quickstart §3)

- [X] T014 [US3] Extend `catalog-coverage.test.ts`: past `sunsetAt` on
  `ACTIVE` product + component → `SUNSET_OVERDUE_PRODUCT` /
  `SUNSET_OVERDUE_COMPONENT` items with `at` = `sunsetAt` and correct
  `href` (`/products/{slug}`, `/components/{id}`); `RETIRED` entity and
  future `sunsetAt` → no items; with operational items present, sunset
  items rank last; total feed stays within `ATTENTION_LIMIT` (20).
  Confirm failure before T015
- [X] T015 [US3] Extend `packages/backend/src/services/dashboard-service.ts`
  — add `"SUNSET_OVERDUE_PRODUCT" | "SUNSET_OVERDUE_COMPONENT"` to
  `AttentionItem.kind`, query `digital_products`/`components` where
  `lifecycle = 'ACTIVE'` AND `sunsetAt < now()`, append after the
  operational groups inside the existing `.slice(0, ATTENTION_LIMIT)`
- [X] T016 [P] [US3] Extend `AttentionItem["kind"]` and `ATTENTION_LABEL`
  in `packages/frontend/src/api/types.ts` +
  `packages/frontend/src/pages/dashboard.tsx` ("Product sunset overdue",
  "Component sunset overdue") with a badge mapping consistent with the
  fixed color map (`docs/ux.md` §6 — warning/neutral, not a new status
  color)

**Checkpoint**: US3 — overdue sunsets surface without outranking breakage

---

## Phase 6: User Story 4 - Per-product completeness signals (Priority: P4)

**Goal**: `{owner, description, dependencies}` chip on product rows and
the detail header — three facets, never a score

**Independent Test**: Products in each completeness combination show
correct per-facet values on list and detail (quickstart §4)

- [X] T017 [US4] Extend `catalog-coverage.test.ts`: list rows and
  `GET /products/{slug}` carry `completeness` — LOB-only owner →
  `owner: true`; whitespace-only description → `description: false`;
  empty-group edge → `dependencies: true`; descendant relief per the
  surface rules; same values on both surfaces. Confirm failure before T018
- [X] T018 [US4] Attach `completeness` per row in `listProducts` and to
  `getProductDetail` in
  `packages/backend/src/services/product-service.ts` — owner/description
  from row columns, `dependencies` from `computeDependencySurfaces()`
  (attach alongside the existing `status` health field)
- [X] T019 [P] [US4] Create
  `packages/frontend/src/components/products/completeness-chip.tsx` —
  three small indicators (owner/description/deps, ✓ vs muted missing) per
  `docs/ux.md` conventions, informational only; render in
  `components/products/product-tree.tsx` rows and the
  `pages/product-detail.tsx` header. Add `ProductCompleteness` typing to
  `api/types.ts` row/detail types
- [X] T020 [P] [US4] Frontend unit test for the chip in
  `packages/frontend/src/test/unit/completeness-chip.test.tsx` — all 8
  facet combinations render independently; no aggregate score text exists

**Checkpoint**: US4 — thin records visible without opening each product

---

## Phase 7: User Story 5 - See whether a platform has consumers (Priority: P5)

**Goal**: `PLATFORM` products surface "consumed by N products" at a glance

**Independent Test**: Three `CONSUMES_FROM` consumers → "consumed by 3
products" = the Consumed-by list size; zero → muted state (quickstart §5)

- [X] T021 [US5] Extend `catalog-coverage.test.ts`: list rows carry
  `consumedByCount` equal to `CONSUMES_FROM` in-degree for the listed
  products; detail `consumedBy.length` already agrees (assert parity).
  Confirm failure before T022
- [X] T022 [US5] Add `consumedByCount` to `listProducts` rows in
  `packages/backend/src/services/product-service.ts` — one `GROUP BY
  platformId` count over `product_consumes_from` restricted to listed ids
  (join the `Promise.all` with `edges`/`healthByProduct`)
- [X] T023 [P] [US5] Render "consumed by N products" in
  `packages/frontend/src/components/products/product-tree.tsx` on
  `PLATFORM` rows (`consumedByCount`, muted "not consumed" at 0) and in
  `pages/product-detail.tsx` header/overview from `consumedBy.length`;
  non-platform rows show nothing; add `consumedByCount` to `api/types.ts`
- [X] T024 [P] [US5] Frontend unit test for consumer surfacing in
  `packages/frontend/src/test/unit/completeness-chip.test.tsx` (or a
  product-tree test file) — N>0 label, muted zero state, absent on
  non-platforms

**Checkpoint**: All five stories independently functional

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T025 Sync `docs/openapi.yaml` — `DashboardSummary.coverage` +
  `CatalogCoverage`/`ProductCompleteness` schemas, `AttentionItem.kind`
  enum + `SUNSET_OVERDUE_PRODUCT`/`SUNSET_OVERDUE_COMPONENT`, `wired` and
  `missing` query params, `completeness`/`consumedByCount` product fields;
  regenerate `docs/api.md` (`pnpm docs:api`) — route/param coverage and
  `verifySession`-only are enforced by `api-docs-contract.test.ts`
  (ADR-104)
- [X] T026 [P] Update `docs/ux.md` §10 dashboard intent (coverage section
  + sunset attention kinds) and the relevant catalog docs for the new
  filters/chip
- [X] T027 Full gate `pnpm lint && pnpm typecheck && pnpm test && pnpm
  build`; walk every `quickstart.md` scenario; verify no
  `sql.raw()`/`sql.fragment()` (ADR-084), all `GET`s side-effect-free
  (ADR-094), metrics = filter counts = chip values (FR-006)
- [X] T028 Update `docs/roadmap.md` — move `023-coverage-and-hygiene` to
  Shipped; revise the Next list per AGENTS.md roadmap sync

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: no dependencies — starts immediately
- **Foundational (T002–T003)**: depends on T001 types; **blocks all
  stories** — every metric, filter, and chip consumes these derivations
- **US1 (T004–T007)**: needs T003 helpers
- **US2 (T008–T013)**: needs T003 helpers + T005 metric exists for
  count-parity assertions
- **US3 (T014–T016)**: needs only T001 types — independent of US1/US2
- **US4 (T017–T020)**: needs T003 surface map
- **US5 (T021–T024)**: needs only T001 types — independent
- **Polish (T025–T028)**: after all stories land

### User Story Dependencies

- US1 → US2 is the only real ordering link (dashboard tiles link to the
  US2 filters; links degrade gracefully until US2 ships)
- US3, US4, US5 are mutually independent — any order after Foundational

### Parallel Opportunities

- T002 and T003 are sequential (failing test first); T004/T006/T007 within
  US1: test first, then service + frontend in parallel ([P] marked)
- US2: T009/T010 parallel (different files); T011/T012/T013 parallel
- US3/US4/US5 backend↔frontend pairs marked [P]
- US3–US5 phases are fully parallelizable after Phase 2

## Implementation Strategy

**MVP**: Phases 1–3 (US1) — dashboard coverage visible; validate
independently before continuing.

**Incremental**: US2 makes figures actionable → US3 hygiene attention →
US4 chip → US5 consumer count. Each lands without breaking prior stories.

**Suggested single-pass order** (shared helpers make sequential cheap):
T001 → T002/T003 → US1 → US2 → US3 → US4 → US5 → Polish.

## Phase 9: Convergence

- [X] T029 Extend the completeness-chip unit tests to all 8 facet
  combinations (parametrized), per T020 (partial — currently 3 combos in
  `catalog-coverage.test.tsx`; move or duplicate into
  `src/test/unit/completeness-chip.test.tsx`)
- [X] T030 Correct `docs/openapi.yaml` `consumedByCount` description —
  implementation counts ALL `CONSUMES_FROM` consumers for parity with
  `consumedBy.length` (contract §products), not "non-RETIRED products" as
  currently written (partial)
- [X] T031 Reconcile quickstart §6.2's `GET /components?bogus=1` → `400
  VALIDATION_FAILED` claim: `listComponentsQuerySchema` is not
  `.strict()` (pre-existing — unknown params are stripped, not rejected).
  Either add `.strict()` or amend the quickstart claim (contradicts)
- [X] T032 Align consumer-count presentation with quickstart §5.1:
  surface "consumed by N products" in the product-detail **header** (it
  currently lives only in the overview Counts card as "Consumed by: N")
  and use "consumed by N products" wording on `PLATFORM` tree rows
  (partial — US5/AC satisfied in spirit; label/placement deviate)


## Phase 10: Convergence

Review-remediation tasks appended after the two-axis code review (Standards
+ Spec) of the feature diff; all verified against the live test suite.

- [X] T033 Replace the vacuous `wiredPct is null` integration test with a
  real empty-population check (retire all components, assert
  `wiredPct === null`, restore) (contradicts — FR-003)
- [X] T034 Extract shared `productCompleteness` and
  `hasNonGoneInstanceOrNone` helpers in `catalog-coverage-service.ts` so
  the dashboard counters, `missing` filter, list/detail completeness, and
  the default `includeGone` predicate share one derivation (partial —
  Standards: duplicated predicates ×4)
- [X] T035 Enum-validate `wired` and `missing` query facets via
  `splitCsvParam` + `z.enum` — unknown values now return
  `400 VALIDATION_FAILED` consistently on both endpoints (partial —
  `missing=bogus` silently returned an empty list)
- [X] T036 Apply `coveragePopulationPredicate` to the sunset-overdue
  component query so gone-only components produce no sunset item
  (resolves the spec edge-case ambiguity in favor of "invisible to every
  metric"; locked by a fixture assertion) (partial — FR-008)
- [X] T037 Update `docs/api.md` prose: `wired`/`tag` on the components
  query-param list; `missing`, `completeness`, `consumedByCount` on the
  products notes (partial — FR-013)
- [X] T038 Remove the duplicated `Consumed by` line from the product
  detail Counts card — the header wording covers US5 (unrequested —
  spec allows header or overview, not both)
