# Tasks: Product Package Roll-up

**Input**: Design documents from `/specs/080-product-package-rollup/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/product-packages.md, quickstart.md

**Tests**: Test-first is non-negotiable (constitution VI) — test tasks are
included and MUST be written and FAIL before implementation. Playwright
coverage for the changed surface is required by repo policy.

**Organization**: Tasks are grouped by user story to enable independent
implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

- `packages/core/src/` — contracts + Zod schemas
- `packages/backend/src/{services,routes}` + `test/integration/`
- `packages/frontend/src/{api,ux}` + `test/unit/`
- `playwright/tests/` — e2e workload

---

## Phase 1: Setup (Shared Infrastructure)

No project initialization needed — the workspace, stack, and BOM primitives
all exist (specs 073–079). Contracts and shared seams are Foundational.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contracts and the reachable-set seam both endpoints and
the detail read depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundational (write FIRST, ensure they FAIL where applicable)

- [x] T001 [P] Contract test: `listProductPackagesQuerySchema` accepts `page/pageSize/search/ecosystem/skew/declared/sort/order` and rejects unknown params and invalid `sort`/`declared` values in `packages/core/test/schemas/product-packages.test.ts` (strict, ADR-095)
- [x] T002 [P] Contract test: `listProductPackageConsumersQuerySchema` requires `purl` (1–500), accepts `version/page/pageSize/sort/order`, rejects unknown params in `packages/core/test/schemas/product-packages.test.ts`
- [x] T003 Regression test: `getProductDetail` returns identical declared/inherited dep structure before and after the scope extraction in `packages/backend/test/integration/products.test.ts` (existing suite semantics — pin them)

### Implementation for Foundational

- [x] T004 [P] Add `ProductPackageListItem`, `ProductPackagesResponse` (data + `coverage {reporting,total}` + `staleThresholdDays` + `facets`), `DeclaredDependency` (DepSource-shaped), `ProductPackageConsumerListItem` (component + `depSource` + version/scope/direct/lastReportedAt) in `packages/core/src/contracts/product-packages.ts` per `data-model.md`
- [x] T005 Add `listProductPackagesQuerySchema` (`ecosystem` multi, `skew` enum `["true"]`, `declared` enum `["declared","undeclared"]`, `sort` enum `["name","components","versions","ecosystem"]` default `components`, `order` default `desc`) and `listProductPackageConsumersQuerySchema` (`purl` required 1–500, `version` optional ≤200, `sort` enum `["name","version","scope","lastReportedAt"]` default `name`) in `packages/core/src/schemas/packages.ts`; export both + types from `packages/core/src/index.ts`
- [x] T006 Extract the reachable-set computation from `getProductDetail` into `productComponentScope(productId)` returning `Map<componentId, { id, name, slug, category, lifecycle, sources: DepSource[] }>` in new `packages/backend/src/services/product-dep-scope.ts` — move the COMPOSES-descendants CTE, `product_depends_on_component` and group-expanded queries verbatim; `getProductDetail` in `packages/backend/src/services/product-service.ts` consumes the helper with zero behavior change (T003 green)

**Checkpoint**: Foundation ready — scope map shared, contracts compile

---

## Phase 3: User Story 1 - Aggregated package inventory on product detail (Priority: P1) 🎯 MVP

**Goal**: `GET /products/:slug/packages` + a flag-gated Packages tab listing
distinct packages (search/ecosystem/skew/declared filters, sort, pagination,
URL state), each row carrying the declared-dependency signal.

**Independent Test**: seed BOM data across direct/group/inherited-reachable
components; open the tab; exercise every filter, sort, pagination, URL
reload; verify one row per version-free purl and declared markers.

### Tests for User Story 1 (write FIRST, ensure they FAIL)

- [x] T007 [P] [US1] Integration test `packages/backend/test/integration/product-packages.test.ts`: 404 unknown slug; strict-schema `VALIDATION_FAILED`; one row per `purlIdentity` scoped to reachable ACTIVE components (unreachable component's packages excluded; RETIRED reachable components excluded); `search`/`ecosystem`/`skew`/`declared` filters; sort whitelist + default `components desc`; `coverage` + `staleThresholdDays` + `facets` fields present
- [x] T008 [P] [US1] Unit test `packages/frontend/src/test/unit/product-packages.test.tsx`: tab renders under `productPackageRollup` ON and is hidden when OFF; toolbar/filters/sort render; empty-vs-filtered empty states; ≥2-char search hint

### Implementation for User Story 1

- [x] T009 [US1] Implement `listProductPackages(slug, query)` in new `packages/backend/src/services/product-packages-service.ts` — product-by-slug 404; `productComponentScope` → ACTIVE id set; `purlIdentity` grouping (mirroring `listPackages`: name agg, `versionCount`, `componentCount`, top-5 `versions` second pass) with `componentId IN (…)`; `max(lastReportedAt)`; catalog match (`resolvedComponentId` → verbatim `externalId`) joined to scope map → `declared` (null | DepSource); group-level `skew` (`versionCount > 1`) and `declared` filters; `coverage {reporting,total}`; `staleThresholdDays` via settings-service; `facets.ecosystems` scoped to the contributing set
- [x] T010 [US1] Register `GET /products/:slug/packages` (`verifySession`, Zod → `VALIDATION_FAILED`, 404 → `NOT_FOUND`) in `packages/backend/src/routes/products.ts`
- [x] T011 [P] [US1] Add `productPackageRollup` flag (`flagOverride("productPackageRollup") ?? true`, gap G41) in `packages/frontend/src/ux/lib/flags.ts`
- [x] T012 [P] [US1] Add `useProductPackages` hook + `productPackagesListParams` + `PRODUCT_PACKAGES_{SORT,FILTER}_KEYS` in `packages/frontend/src/api/hooks/product-packages.ts`; extend `packages/frontend/src/api/mappers/packages.ts` with the product row mapper
- [x] T013 [US1] Create `packages/frontend/src/ux/components/products/product-packages.tsx` — toolbar (`ListToolbar` + `ListSortSelect`), ecosystem/skew/declared filters, table (Package/Ecosystem/Versions chips/Components/Declared columns), `ListPagination`, distinct empty states per `coverage`, D8 subtitle; wire `?tab=packages` + `TabsTrigger` into `packages/frontend/src/ux/components/products/product-detail.tsx` TABS array gated on the flag
- [x] T014 [US1] Update `docs/openapi.yaml` with the endpoint (params, 200 shape, `x-permission`, error codes) and regenerate `docs/api.md` via `pnpm docs:api` (ADR-104)

**Checkpoint**: US1 functional — list + declared signal + tab visible

---

## Phase 4: User Story 2 - Per-package consumers scoped to the product (Priority: P1)

**Goal**: `GET /products/:slug/packages/consumers` + expand-to-consumers on
each row — merged (component, version, scope) rows with DepSource
attribution, version-chip narrowing, deep link to the component BOM tab.

**Independent Test**: package in ≥3 components over 2 versions and 2
reachability kinds; expand, verify attribution + deep links + version chip +
consumer pagination.

### Tests for User Story 2 (write FIRST, ensure they FAIL)

- [x] T015 [P] [US2] Integration test `packages/backend/test/integration/product-package-consumers.test.ts`: requires `purl`; unknown purl → empty page; one row per (component, version, scope) with `depSource` attribution (DIRECT / GROUP {name,slug} / INHERITED {product}); multi-path component appears once; `version` filter; pagination
- [x] T016 [P] [US2] Unit test in `packages/frontend/src/test/unit/product-packages.test.tsx`: expand renders consumers with attribution label, version chip filters consumers, component cell links to `?tab=bom&q={purl}`

### Implementation for User Story 2

- [x] T017 [US2] Implement `listProductPackageConsumers(slug, query)` in `packages/backend/src/services/product-packages-service.ts` — `normalizePurlIdentity` match, merged grouping (`bool_or(direct)`, `max(lastReportedAt)`), scoped to the product's reachable set, `depSource` resolved from the scope map post-query
- [x] T018 [US2] Register `GET /products/:slug/packages/consumers` in `packages/backend/src/routes/products.ts`; update `docs/openapi.yaml` + `pnpm docs:api`
- [x] T019 [P] [US2] Add `useProductPackageConsumers` hook in `packages/frontend/src/api/hooks/product-packages.ts`
- [x] T020 [US2] Parameterize `packages/frontend/src/ux/components/catalog/package-consumers.tsx` (shared table internals accept a consumers query + optional attribution column) and wire row-expansion + `?version=` chip filtering into `product-packages.tsx` — no fork of the consumers internals

**Checkpoint**: US1 + US2 both independently functional

---

## Phase 5: User Story 3 - Coverage and freshness (Priority: P2)

**Goal**: "N of M components report packages" summary, per-row
`lastReportedAt` freshness and stale indicator, the no-deps vs no-data
empty states, RETIRED-product readability.

**Independent Test**: product with 11 reachable components, 8 reporting →
coverage line "8 of 11"; stale-seeded rows show the stale indicator;
RETIRED product renders the view.

### Tests for User Story 3 (write FIRST, ensure they FAIL)

- [x] T021 [P] [US3] Extend `packages/backend/test/integration/product-packages.test.ts`: `coverage` counts (reporting vs total, RETIRED reachable excluded), RETIRED product still returns the read
- [x] T022 [P] [US3] Extend `packages/frontend/src/test/unit/product-packages.test.tsx`: coverage summary text, `isStale` styling on stale rows, both empty states

### Implementation for User Story 3

- [x] T023 [US3] Render the coverage summary + per-row freshness (`isStale` against `staleThresholdDays`, warning tone only on stale — D8) and the two distinct empty states in `packages/frontend/src/ux/components/products/product-packages.tsx`

**Checkpoint**: All three stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T024 [P] Gap-registry entry G41 for `productPackageRollup` in `researches/ux-rewrite-gaps.md` + flag-table row in `docs/ux.md` §7 (surface: product Packages tab; hidden fallback)
- [x] T025 [P] Playwright workload spec `playwright/tests/journeys/product-packages.spec.ts` — the quickstart §"What to verify" flows (tab, declared marker, skew, consumers expand + attribution + deep link, coverage line, empty states, flag-off hidden)
- [x] T026 Update `docs/roadmap.md` shipped entry + Next revision; note the Q7 resolution in `researches/sbom_research.md` (mark Q7 resolved → spec 080)
- [x] T027 Run quickstart.md validation + `pnpm lint && pnpm typecheck && pnpm test && pnpm build` in changed packages (`core`, `backend`, `frontend`) and root build; `docs:*:check` gates green

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: blocks all stories — T006 must land first (shared scope map)
- **US1 (Phase 3)**: after Foundational — backend read can precede UI within the phase
- **US2 (Phase 4)**: after Foundational; consumers service independent of US1 service, UI expansion needs T013's table
- **US3 (Phase 5)**: after Foundational + T009 (`coverage`/`staleThresholdDays` already in the contract); mostly frontend
- **Polish (Phase 6)**: after all stories

### User Story Dependencies

- **US1**: no story deps — MVP
- **US2**: independent backend; UI depends on US1's table row (T013)
- **US3**: independent — fields already delivered by T009

### Parallel Opportunities

- T001–T003 (tests) in parallel; T004/T005 in parallel
- Within US1: T007/T008 tests, T011/T012 flag+hooks in parallel with backend work
- US2 tests T015/T016 in parallel
- T024/T025 docs/e2e in parallel during polish

---

## Implementation Strategy

### MVP First (User Story 1)

1. Foundational (T001–T006) → US1 (T007–T014) → validate: the tab answers
   "what does this product run on?" with declared markers.

### Incremental Delivery

2. US2 adds the drill-down that makes rows actionable.
3. US3 layers coverage honesty + freshness.
4. Polish ships docs, e2e, and the full verification gate.

## Notes

- [P] = different files, no deps on incomplete tasks.
- Test tasks precede implementation per constitution VI — verify each test
  FAILS before writing the implementation it covers.
- Commit after each task or logical group per AGENTS.md commit conventions.

## Phase 7: Review

- [x] T028 Document the Packages tab in the product guide page (`docs/using-the-catalog.md` and/or `docs/digital-products.md`) per AGENTS.md documentation rule (code-review: standards, missing)
- [x] T029 Sync expanded-row state to the URL (`pkg` param or equivalent) so SC-004 list states — including the expanded row and its `version` filter context — reproduce on reload/share (code-review: spec, partial)
- [x] T030 Distinguish the FR-013 "no component dependencies" empty state from "no package data" when the product's reachable set is non-empty but all members are libraries (coverage.total excludes libraries per D5; expose a full reachable-set signal) (code-review: spec, partial)
- [x] T031 Exclude RETIRED components from the declared-marker matching set (`reachableIds` currently includes them, so a retired library target still marks a row declared, contrary to FR-012) (code-review: spec, partial)
- [x] T032 Remove the dead `depSource: { kind: "DIRECT" }` fallback in the consumers service — `scoped` is guaranteed; the fallback silently misattributes (code-review: standards, contradicts)
- [x] T033 Hoist the thrice-duplicated `sql.join(reachableIds …)` IN-list and the duplicated empty paginated literal in `product-packages-service.ts` (code-review: standards, partial)
- [x] T034 Consolidate the consumers page-size constant (`PRODUCT_CONSUMERS_PAGE_SIZE` duplicating `CONSUMERS_PAGE_SIZE`); pass `pageSize` to `ConsumersReadout` rather than keying on the explorer constant (code-review: standards, partial)
- [x] T035 Fix spec-artifact drift: `contracts/product-packages.md` says "(G40)" → G41; `tasks.md` T025 path should be `playwright/tests/journeys/product-packages.spec.ts`; T003 names `product-dep-scope.test.ts` which does not exist (coverage lives in `products.test.ts`) (code-review: standards, partial)
