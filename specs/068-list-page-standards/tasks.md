# Tasks: Standardized list pages — server-side pagination, sorting, filters, hover summaries

**Input**: Design documents from `/specs/068-list-page-standards/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/list-contract.md

**Tests**: REQUIRED — constitution VI is non-negotiable; every phase ships
failing-test-first coverage (backend integration, frontend unit, Playwright).

**Contract reference**: `contracts/list-contract.md` is authoritative for
per-endpoint params/sort keys/search fields. ADR-130 governs the contract.

---

## Phase 1: Setup — shared contract primitives

- [X] T001 Add shared list-params Zod base (`page` int≥1 default 1, `pageSize` int 1–100 default 25, `order` `asc|desc` default `asc`, optional `search` ≤100) + `Paginated<T>` type in `packages/core/src/schemas/` and `packages/core/src/` types; export from core index
- [X] T002 [P] Extend `listComponentsQuerySchema` in `packages/core/src/schemas/components.ts` onto the shared base — sort enum grows to `name|category|resourceType|owner|health|instances|lastSeenAt`; keep existing filters
- [X] T003 [P] Add list query schemas for products/org/users/sessions/agents/credentials/docker-targets/importer-configs/importer-sources/suggestions/audit in `packages/core/src/schemas/` per contracts/list-contract.md (products `q`→`search`; suggestions/audit `limit/offset`→`page/pageSize`)

---

## Phase 2: Foundational — backend list engine + frontend infrastructure

**Purpose**: Blocking prerequisites both stories need — the reusable
backend list-query helper and the frontend table-state/UI primitives.

- [X] T004 Write failing backend integration tests for the pagination envelope contract (page/pageSize math, `total`/`pageCount`/`hasNext`, 400 on bad params) in `packages/backend/test/integration/` — run first, confirm fail
- [X] T005 Implement shared list-query helper in `packages/backend/src/services/` (or `lib/`): builds WHERE from parsed filters, applies whitelisted `SORTABLE` map + deterministic `orderBy(id)` tiebreak, runs count query + page slice, returns `{data, pagination}`
- [X] T006 Migrate `GET /components` service (`component-catalog-service.ts`) onto the helper: new sort keys (`category`,`resourceType`,`owner`,`health`,`instances`,`lastSeenAt` via existing subqueries/joins), widened `search` (name/slug/resourceType/externalId ilike + tags unnest ilike), **bugfix**: `worstStatus` CASE omits GONE rung when `includeGone=false`; **bugfix**: explicit `lifecycle` overrides default `!= RETIRED` via else-if
- [X] T007 Write failing backend integration tests for the three folded bugfixes (worstStatus/includeGone, lifecycle=RETIRED override, component-groups 400) in `packages/backend/test/integration/`
- [X] T008 Fix `GET /component-groups` route (`routes/component-groups.ts`) to `safeParse` `listComponentGroupsQuerySchema` → `400 VALIDATION_FAILED` (was service `.parse()` → 500); add `memberCount` to groups list response
- [X] T009 [P] Frontend: `useListState` hook in `packages/frontend/src/ux/hooks/` — `useSearchParams`-backed `{page,pageSize,size,sort,order,q,filters}` with per-page defaults, invalid-value fallback, reset-to-page-1 on q/filter/sort/order/size change
- [X] T010 [P] Frontend: `useDebouncedValue` hook (~300ms) in `packages/frontend/src/ux/hooks/`
- [X] T011 [P] Frontend: `ListPagination` pattern in `packages/frontend/src/ux/components/patterns/` wrapping `ui/pagination.tsx` + page-size Select (25/50/100)
- [X] T012 [P] Frontend: sortable `TableHead`/`SortableHeader` in `packages/frontend/src/ux/components/patterns/` — button + ArrowUp/ArrowDown/ChevronsUpDown icons + `aria-sort`
- [X] T013 Fix `ListToolbar` in `packages/frontend/src/ux/components/patterns/list-toolbar.tsx`: `FilterDef` gains `emptyValue` (default `"all"`); "All" `SelectItem` renders only when filter declares it; `dirty` compares each filter to its `emptyValue` — kills phantom "All" + permanent Clear
- [X] T014 [P] Frontend: `TitleWithSummary`/`EntitySummaryCard` pattern in `packages/frontend/src/ux/components/patterns/` — `HoverCard` around title link, per-entity summary field map (data-model.md table), truncation classes; never renders secrets/`details` JSON
- [X] T015 [P] Frontend: update `api/types.ts` + list hooks to envelope `{data,pagination}` + list-state params; keep `useAllComponents`/`useAllProducts` fetch-all helpers for pickers only

**Checkpoint**: contract primitives exist on both sides; `/components` endpoint already satisfies US1–US3 server-side.

---

## Phase 3: User Story 1 — Browse any list one page at a time (P1) 🎯 MVP

**Goal**: Every primary list page renders server-paginated results with
25/50/100 page-size selector, navigation, and accurate totals — one
request per page view.

**Independent Test**: `/components` (>100 rows) loads with exactly one
list request; pager offers 25/50/100; page 2 fetches only its slice;
result count = server total.

### Tests for US1

- [X] T016 [P] [US1] Backend integration tests: pagination math + envelope on products, component-groups, org, users, sessions, agents, credentials, docker-targets, importer-configs, importer-sources, suggestions, audit endpoints (extend existing test files)
- [X] T017 [P] [US1] Frontend unit tests: `useListState` page/size round-trip + `ListPagination` rendering in `packages/frontend/src/test/unit/`

### Implementation for US1

- [X] T018 [US1] Migrate `GET /products` (`product-service.ts` + `routes/products.ts` + core schema): page/pageSize/sort/order/search; `missing` facets → SQL (owner/description predicates, dependencies via surfaces Set→IN); enrichments (health/counts/consumedBy/completeness) computed for page ids only; `edges` top-level scoped to page ids
- [X] T019 [P] [US1] Migrate org endpoints `GET /lobs`, `GET /teams` (`org-service.ts`, `routes/org.ts`): contract + derived counts (`teamCount`,`productCount`,`memberCount`,`componentCount`) replacing frontend fetch-all counting
- [X] T020 [P] [US1] Migrate `GET /component-groups`, `GET /users`, `GET /sessions` services+routes onto the list contract (users gets real Zod schema replacing ad-hoc `req.query`)
- [X] T021 [P] [US1] Migrate ops endpoints `GET /agents`, `GET /credentials`, `GET /docker-targets`, `GET /importer-configs`, `GET /importer-sources` onto the contract (keep existing filters; sources keeps `status`/`importerName`)
- [X] T022 [US1] Migrate run/audit-adjacent endpoints `GET /importer-configs/:id/runs`, `.../errors`, `.../changes` onto the contract
- [X] T023 [US1] Migrate `GET /suggestions` + `GET /audit/activity` + `GET /audit/entities/:type/:id` to `{data,pagination}` + `page`/`pageSize`; audit moves in-memory slice → SQL `LIMIT/OFFSET`
- [X] T024 [P] [US1] Wire `ListPagination` + `useListState` + `useComponents`-style paged hooks into `/components` page (`ux/app/components/index.tsx` + `components-table.tsx`) — remove `useAllComponents` fetch-all
- [X] T025 [P] [US1] Wire pagination into `/products` page (`ux/app/products/index.tsx` + `products-table.tsx`)
- [X] T026 [P] [US1] Wire pagination into org pages `/lobs`, `/teams` (card grids get pager; counts from new endpoint fields — drop `useProducts`/`useAllComponents` counting)
- [X] T027 [P] [US1] Wire pagination into admin pages `/users`, `/sessions`, `/credentials` tables
- [X] T028 [P] [US1] Wire pagination into `/agents`, `/sources`, `/docker-targets` pages
- [X] T029 [P] [US1] Wire pagination into `/importers` configs surface + `/importers/:id` run-history table + run-detail errors/changes tables
- [X] T030 [P] [US1] Wire pagination into `/suggestions` (pending/history tabs) + `/activity` feed
- [X] T031 [P] [US1] Fix `/component-groups/:slug` members table + org detail OwnedTables: keep fetch-all (exempt detail sub-tables) but ensure they still compile against migrated hooks/types

**Checkpoint**: US1 fully functional — every primary list paginates server-side.

---

## Phase 4: User Story 2 — Sort any list by its columns (P1)

**Goal**: Clickable column headers sort server-side (asc→desc), state in
URL, globally consistent across pages; unsortable columns show no affordance.

**Independent Test**: `/components` sort by name/last-seen holds on page 2;
URL carries `sort`/`order`; invalid sort → 400.

### Tests for US2

- [X] T032 [P] [US2] Backend integration tests: sort ordering + id tiebreak + 400 on non-whitelisted sort key per endpoint family
- [X] T033 [P] [US2] Frontend unit tests: `SortableHeader` aria-sort cycling

### Implementation for US2

- [X] T034 [US2] Apply sort whitelists in each migrated service per contracts/list-contract.md (components done in T006; products/org/users/sessions/agents/credentials/docker/importer-configs/runs/errors/changes/sources/suggestions/audit)
- [X] T035 [P] [US2] Add sortable headers to `/components` table columns (name, category, resource type, owner, health, instances, last seen)
- [X] T036 [P] [US2] Add sortable headers to `/products` (name, type, owner, criticality, updated) — health/components/completeness unsortable
- [X] T037 [P] [US2] Add sortable headers to org tables (teams: name/lob/members/products/components; lobs cards: name/created) + users/sessions/credentials tables
- [X] T038 [P] [US2] Add sortable headers to agents/sources/docker-targets/importer tables + suggestions/activity ordering controls

**Checkpoint**: US2 functional — all SQL-expressible columns sortable everywhere.

---

## Phase 5: User Story 3 — Filter and search lists with correct, shareable state (P1)

**Goal**: All filters/search hit the server; full list state in URL;
gone-instances filter tells the truth; Clear appears only when dirty.

**Independent Test**: `/components` → Gone instances → "Shown" stays
selected, gone-only components appear, URL updates, reload preserves;
provider/category/search filter server-side across pages.

### Tests for US3

- [X] T039 [P] [US3] Backend integration tests: search field coverage + filter params per endpoint (components search fields, products missing facets, sources status/importerName, users role/isActive, suggestions status, audit filters)
- [X] T040 [P] [US3] Frontend unit tests: `ListToolbar` — no "All" on hide/show filters, Clear visibility per `emptyValue`; `useListState` URL round-trip incl. filters

### Implementation for US3

- [X] T041 [US3] Wire server-side search+filters into `/components` page: provider/category selects + debounced search → API params (drop client `data.filter`); gone filter becomes `{emptyValue:"hide"}` options Hidden/Shown (no "All")
- [X] T042 [P] [US3] Wire server-side filters into `/products` (type/criticality/lifecycle/missing-via-`?incomplete=1`→`missing=dependencies`)/search
- [X] T043 [P] [US3] Wire server-side filters into remaining lists: sources (status), agents (status), users (role/isActive), suggestions (status tabs→URL), audit activity (kind/entityType/action/actor/from/to where UI exposes)
- [X] T044 [US3] Ensure every list page's full state (page/size/sort/order/q/filters) round-trips through URL; invalid params fall back to defaults
- [X] T045 [US3] Playwright regression spec for the gone-instances defect + toolbar Clear behavior in `playwright/tests/` (fails on main, passes here)

**Checkpoint**: US3 functional — filters tell the truth everywhere.

---

## Phase 6: User Story 4 — Hover title summaries (P2)

**Goal**: Hovering/focusing a row title shows a curated summary card;
title cells truncate; zero extra requests.

**Independent Test**: `/components` + `/products` title hover → summary
card with key fields; long names truncate; network tab shows no new call.

### Tests for US4

- [X] T046 [P] [US4] Frontend unit tests: summary content map per entity + no secrets/details leakage
- [X] T047 [P] [US4] Playwright spec: hover summary appears on title focus/hover in `playwright/tests/`

### Implementation for US4

- [X] T048 [US4] Apply `TitleWithSummary` to `/components` + `/products` title cells (truncate + HoverCard; fields per data-model.md)
- [X] T049 [P] [US4] Apply `TitleWithSummary` to org/admin/ops list title cells (users, teams, lobs, agents, credentials, sources, docker-targets, importer configs/runs, suggestions, audit rows where a "title" exists)

**Checkpoint**: US4 functional — every list title previews its summary.

---

## Phase 7: Polish & cross-cutting

- [X] T050 Update `docs/openapi.yaml` for every touched endpoint (params, envelopes, sort enums, renamed `q`→`search`, migrated suggestions/audit) — ADR-104, same change
- [X] T051 Regenerate `docs/api.md` via `docs:api`; run `docs:*:check` variants
- [X] T052 Update `docs/ux.md` if ListToolbar/pagination conventions need documenting (ListToolbar docstring already promises URL sync — align text)
- [X] T053 Update `docs/roadmap.md` — mark spec 068 progress/shipped per convention
- [ ] T054 Flip spec `Status` Draft→Shipped only at merge time (ship commit)
- [X] T055 [P] Playwright coverage pass: pagination+sort+filter+URL-restore+hover on components/products + one admin list + suggestions/activity (per AGENTS.md — run `pnpm e2e` subset)
- [X] T056 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` across changed packages; `pnpm audit --prod --audit-level=high` clean
- [X] T057 Self-review diff vs spec FR-001…FR-015 + contracts/list-contract.md — every FR traceable

---

## Dependencies & Execution Order

- **Phase 1 → 2**: core schemas before services; helper before migrations.
- **Phase 2 → 3**: frontend infra + backend helper must exist before page rollout.
- **US1 backend (T018–T023) before US1 frontend (T024–T031)** per page family — but page families are independent of each other.
- **US2/US3** layer onto the same services — run after US1 per endpoint family.
- **US4** independent of US2/US3 (presentation only) — can parallel.
- **Phase 7** last.

### Parallel opportunities

- T002/T003 schemas; T009–T012/T014/T015 frontend infra; T019–T022 endpoint families; T024–T030 page rollouts; T035–T038 header wiring; T046–T049 summaries.

### Parallel example — US1 backend families

```text
Agent A: T018 products | Agent B: T019–T020 org/users/sessions/groups
Agent C: T021–T022 ops+run endpoints | Agent D: T023 suggestions+audit
```

## Implementation Strategy

**MVP**: Phases 1–3 (US1) — pagination everywhere is the headline value.
**Then**: US2 sort, US3 filters/state (incl. the reported bug), US4 hover.
Each phase leaves the app shippable; Phase 7 gates the PR.

---

## Phase 8: Convergence

- [X] T058 Extend sort whitelists for aggregate count columns on org lists — teams `memberCount`/`productCount`/`componentCount`, lobs `teamCount`/`productCount` (SQL count subqueries already computed per row) per FR-005 (partial): core schema sort enums → org-service ORDER BY via the same count expressions → openapi.yaml → frontend sortable headers (teams table) / ListSortSelect options (lobs grid)
- [X] T059 Extend sort whitelists for stored meta columns on audit/suggestions — audit activity + entity-history `kind`/`entityType`, suggestions `status` per FR-005 (partial): core schema enums → audit-query-service/edge-suggestion-service ORDER BY → openapi.yaml → frontend sortable headers where the columns render
- [X] T060 Audit + extend sort whitelists on remaining ops/admin lists per FR-005 (partial): agents (session/config counts if displayed), credentials (dependents count if displayed), sources (run/membership stats if displayed), importer-configs (run stats if displayed), users (team/sessions columns if displayed), sessions, docker-targets, run errors (`errorType`), run changes (`action`) — add sort keys only where the displayed value is SQL-expressible; core schema → service → openapi → frontend headers
- [X] T061 Omit the inert `search` param from list schemas of endpoints that do not filter on it (suggestions, audit activity/entity-history, importer runs/errors/changes) per FR-006 (partial) — e.g. `.omit({ search: true })` on those schemas; update docs/openapi.yaml accordingly
- [X] T062 Apply `TitleWithSummary` on remaining in-scope title-ish cells per FR-012 (partial): sessions list primary cell and run errors/changes rows if they present a title-like value — verify each surface and apply the `generic`/appropriate summary kind where a real title exists; skip pure log/status rows with no title semantics
