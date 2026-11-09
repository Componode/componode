# Research: Standardized list pages — server-side pagination, sorting, filters, hover summaries

**Feature**: `068-list-page-standards` | **Date**: 2026-11-09
**Inputs**: spec.md (grilling session 2026-11-09, 8 ratified decisions),
codebase exploration (frontend + backend sub-agent reports), live API
verification, ADR-080/ADR-081/ADR-103 review.

All NEEDS CLARIFICATION resolved — decisions below are ratified by the
spec's Clarifications section and the user's "yes" answers.

---

## D1 — Pagination mechanism: offset everywhere for UI lists

- **Decision**: `page`/`pageSize` offset pagination on every in-scope list
  endpoint. Cursor pagination remains only on URL-check observations
  (`limit`+`before`, already shipped and already gradual).
- **Rationale**: Requirements demand numbered 25/50/100 pages, accurate
  totals, and sorting by arbitrary displayed columns. Cursor pagination
  cannot sort by `name`/`lastSeenAt`/etc. — it walks one fixed ordering.
  ADR-080's cursor rationale (`OFFSET 40000` on 50k components) is real but
  the count query dominates request cost under any strategy, and the sort
  column index keeps offset scans bounded. Single-org DPAM scale makes
  offset acceptable; keyset-per-sort-column is disproportionate complexity.
- **Alternatives considered**: cursor for high-cardinality per ADR-080
  (rejected — contradicts sortable-columns requirement); keyset
  pagination parameterized by sort column (rejected — N cursor formats,
  still no cheap totals); infinite scroll (rejected — user asked for
  numbered pages).
- **ADR impact**: amends ADR-080 → recorded in ADR-130.

## D2 — Response envelope: spec-003 `{data, pagination}` unified

- **Decision**: Every in-scope list endpoint returns
  `{data: T[], pagination:{page,pageSize,total,pageCount,hasNext}}`.
  `{items,total}`+`limit/offset` endpoints (suggestions, audit activity,
  entity history) migrate to it. Endpoint-specific extras stay top-level
  (e.g. `/products` keeps `edges` scoped to the page's ids).
- **Rationale**: The envelope is already ratified by spec 003 FR-001 and
  implemented on `/components`; it carries `pageCount`/`hasNext` the
  `{items,total}` shape lacks. One envelope = one frontend adapter.
- **Alternatives considered**: keep `{items,total}` for audit/suggestions
  (rejected — two conventions forever, frontend needs per-endpoint
  adapters); `{items,total}` everywhere (rejected — regresses the richer
  ratified shape).

## D3 — Parameter convention: `page`, `pageSize`, `sort`, `order`, `search`

- **Decision**: Uniform params across all in-scope endpoints. `page`
  int ≥1 default 1; `pageSize` int 1–100 default 25 (UI offers exactly
  25/50/100); `sort` per-endpoint enum; `order` `asc|desc` default `asc`;
  `search` string ≤100 chars (products' legacy `q` renames to `search`);
  entity filters keep existing names.
- **Rationale**: `page`/`pageSize`/`sort`/`order` already shipped on
  `/components` and documented in openapi.yaml — extending it is cheaper
  than adopting ADR-081's literal `sort=field:direction` or the
  `limit`/`offset` convention. `search` unifies the two existing names
  (`search` on components, `q` on products).
- **Alternatives considered**: `limit`/`offset` (rejected — weaker page
  semantics, no `pageSize` cap story); `sort=field:direction` per ADR-081
  literal (rejected — already diverged in shipped API; amending ADR-081
  records reality); keeping `q` on products (rejected — two names for one
  concept).
- **ADR impact**: amends ADR-081 → recorded in ADR-130.

## D4 — Shared core list-params schema + per-endpoint sort whitelists

- **Decision**: Add a shared base query schema in `packages/core`
  (e.g. `listParamsSchema` = page/pageSize/sort?/order?/search?) that each
  endpoint extends with its own `sort` enum + filters, plus a shared
  `Paginated<T>` response type. Each service keeps a whitelisted
  `SORTABLE` map param→column/expression (Kysely `orderBy` on the mapped
  expression only — never raw input, per ADR-084/ADR-095).
- **Rationale**: Removes today's per-endpoint drift (ad-hoc `req.query`
  casts on `/users`, missing route validation on `/component-groups`,
  three different pagination conventions). The whitelist is the
  injection-safe pattern already proven in `component-catalog-service.ts`.
- **Alternatives considered**: per-endpoint schemas duplicated (status
  quo — rejected); generic sort DSL (rejected per ADR-081's own
  rationale); client-side sorting (rejected — meaningless under
  pagination).

## D5 — Sortable columns = SQL-expressible displayed columns

- **Decision**: Each list sorts by every displayed column whose value is
  expressible as a query ordering — stored columns, joined names, and the
  aggregate subqueries already used for display (e.g. components'
  `instanceCount`, `worstStatus`, `lastSeenAt`). App-computed values
  (product health rollup, completeness facets, JS-enriched counts) render
  without sort affordance. Every sort adds a deterministic tiebreak
  (`orderBy` on a unique column, typically `id`).
- **Rationale**: Matches spec FR-005 exactly; avoids fake affordances.
- **Per-endpoint whitelists** are enumerated in `contracts/list-contract.md`.

## D6 — Filter options are static enum metadata, not facet queries

- **Decision**: Every filter currently in the UI is backed by a controlled
  enum in `packages/core` (provider, category, lifecycle, product type,
  criticality, instance status, user role, source/agent status). Filter
  dropdown options render from `ux/lib/domain.ts` META tables — no
  distinct-values endpoint needed, and options can't be skewed by the
  current page's contents.
- **Rationale**: With server-side pagination the client only holds one
  page — deriving options from `data` would show only values present on
  that page. Static enums are complete by definition.
- **Alternatives considered**: `/components/facets` endpoint (rejected —
  unnecessary for enum-backed filters, extra request per page); keep
  client-derived options (rejected — wrong under pagination).

## D7 — Server-side search preserves and extends current UX semantics

- **Decision**: `search` becomes a server param on every in-scope list.
  Per-endpoint field lists (substring `ILIKE %term%`):
  - components: `name`, `slug`, `resourceType`, `externalId`, and `tags`
    (via `EXISTS unnest(tags) ILIKE`) — replaces today's client-side
    `name+resourceType+tags` substring and the API's narrower prefix match.
  - products: `name`, `slug`, owner display names (joined), `tags` —
    mirrors the current client search.
  - org/users/agents/credentials/sources/groups/importers/suggestions/
    audit: `name`/`slug`/`username`/`displayName`/`label` as applicable.
- **Rationale**: Client-side search over one page would be a regression;
  the server predicate must cover at least the advertised fields (spec
  FR-006). Input debounces ~300 ms client-side.
- **Alternatives considered**: keep API's existing narrow prefix search
  (rejected — UX regression vs. today's substring+tags matching);
  full-text/trigram indexes (rejected — out of scope, ILIKE is fine at
  DPAM scale).

## D8 — `/products` pagination with JS-computed enrichments

- **Decision**: `listProducts` gains page/pageSize/sort/order/search.
  Existing params (`q`→`search`, `type`, `lifecycle`, `tag`, `criticality`,
  `missing`, `includeRetired`) stay. `missing=owner|description` become SQL
  predicates; `missing=dependencies` uses the existing
  `computeDependencySurfaces()` Set → `id IN/NOT IN` (products are
  low-cardinality per ADR-080 — the IN list is small). Health,
  componentCount, consumedByCount, and completeness are computed only for
  the page's ids via the existing helpers (same per-request cost as
  today). `edges` stays top-level, scoped to page ids (no frontend
  consumer today, but preserves the contract).
- **Rationale**: The two catalog-wide helper queries
  (`computeDependencySurfaces`, health/count helpers) already run once per
  list call; paginating the product rows does not change their cost.
- **Alternatives considered**: rewrite completeness/health as SQL
  subqueries (rejected — large rework, no user-visible gain); drop
  `edges` (rejected — keep contract stable); exempt products from
  pagination (rejected — spec scope).

## D9 — Org list endpoints return derived counts

- **Decision**: `GET /lobs` and `GET /teams` (and component-groups where
  useful) return SQL-derived count fields (e.g. `productCount`,
  `teamCount`, `componentCount`, `memberCount`) so the org pages stop
  fetching entire products/components collections for card counts.
- **Rationale**: Today `lobs/index.tsx` and `teams/index.tsx` call
  `useProducts`/`useAllComponents` purely to compute counts — exactly the
  fetch-everything pattern this spec removes.
- **Alternatives considered**: keep fetch-all for counts (rejected —
  violates FR-002); separate `/counts` endpoint (rejected — counts belong
  on the row).

## D10 — Audit endpoints get real SQL pagination + envelope migration

- **Decision**: `GET /audit/activity` and `GET /audit/entities/:type/:id`
  move from fetch-all-then-slice to SQL `LIMIT/OFFSET` with the unified
  envelope. Entity-history UI adapts to the new envelope (keeps its
  existing controls; it's a detail sub-table).
- **Rationale**: In-memory slicing still reads every matching row —
  violates "consume gradually". Filters (`kind`, `entityType`, `action`,
  `actor`, `from`, `to`) are all SQL-expressible.
- **Alternatives considered**: keep in-memory slice (rejected); cursor
  (rejected — D1).

## D11 — Frontend shared infrastructure (new patterns, no new deps)

- **Decision**: Build on existing primitives — no TanStack Table, no new
  dependencies:
  - `useListState` hook: `useSearchParams`-backed table state
    (`page`, `pageSize`, `sort`, `order`, `search`, filter keys) with
    per-page validation, defaults, and reset-to-page-1 on
    filter/search/sort change.
  - `ListPagination` pattern wrapping the existing unused
    `ui/pagination.tsx` + a page-size `Select` (25/50/100).
  - `SortableHeader`/sortable `TableHead` (`aria-sort`, asc/desc/none
    cycle) — plain buttons inside `TableHead`.
  - `ListToolbar` fix: `FilterDef` gains an explicit `emptyValue`
    (default `"all"`); the "All" option renders only when the filter
    declares it; `dirty` compares against each filter's `emptyValue`.
    The gone-instances filter declares `emptyValue: "hide"` (or is
    reworked to a checkbox/switch — decide in tasks; recommendation:
    keep Select with options Hidden/Shown, no "All").
  - `useDebouncedValue` (~300 ms) for search inputs.
  - `EntitySummaryCard`/`TitleWithSummary`: `HoverCard` wrapping the
    title link, fed by a per-entity summary-content map (curated fields,
    no `details` JSON, no secrets). Title cells truncate.
  - Per-entity list hooks send list-state → query params and consume the
    envelope; `useAllComponents`/`useAllProducts`-style fetch-all helpers
    remain for pickers/lookups only.
- **Rationale**: Matches docs/ux.md §3 patterns layer and §5 conventions
  (`?tab=` URL-state precedent, state matrix, mapper rule). Zero new
  dependencies.
- **Alternatives considered**: adopt TanStack Table (rejected — new dep
  for what a thin pattern covers; repo has no DataTable abstraction and
  the UX doc prescribes patterns not libraries); nuqs (rejected — same);
  per-page ad-hoc state (rejected — the bug being fixed).

## D12 — Folded backend correctness fixes

- **Decision** (spec FR-009/010/011):
  1. `worstStatus` CASE omits the `GONE` rung when `includeGone=false`
     (built conditionally at query construction — Kysely `eb.case()`
     supports conditional `.when` chaining). `instanceCount` already
     guards correctly.
  2. `listComponents`: explicit `lifecycle` filter overrides the default
     `!= RETIRED` exclusion via `else if` (products/groups pattern).
  3. `GET /component-groups`: route `safeParse`s
     `listComponentGroupsQuerySchema` → `400 VALIDATION_FAILED` instead
     of the service `.parse()` ZodError → 500.
- **Rationale**: All three are list-filter correctness bugs on the same
  surfaces; small, testable, and discovered during this work's exploration.
- **Deferred**: component-detail `includeGone` (gap G26, flag-gated —
  separate gap spec); `status`+`includeGone` interaction edge cases are
  documented but unchanged (explicit `status` already bypasses the
  gone-only exclusion by design).

## D13 — In-scope endpoint inventory

Server-paginated + sorted (contracts/list-contract.md is authoritative):

| Endpoint | Today | Change |
|---|---|---|
| `GET /components` | offset envelope ✓ | extend sort keys + search fields; bugfixes D12.1/.2 |
| `GET /products` | unbounded `{products,edges}` | full contract (D8) |
| `GET /component-groups` | unbounded `{groups}` | contract + route validation fix |
| `GET /lobs`, `GET /teams` | unbounded, no params | contract + derived counts (D9) |
| `GET /users` | unbounded, ad-hoc query | Zod schema + contract |
| `GET /sessions` | unbounded | contract |
| `GET /agents` | unbounded | contract |
| `GET /credentials` | unbounded | contract |
| `GET /docker-targets` | unbounded | contract |
| `GET /importer-configs` | unbounded | contract |
| `GET /importer-configs/:id/runs` | unbounded | contract |
| `GET /importer-configs/:id/runs/:runId/errors` | unbounded | contract |
| `GET /importer-configs/:id/runs/:runId/changes` | unbounded | contract |
| `GET /importer-sources` | unbounded + status/importerName filters | contract (keep filters) |
| `GET /suggestions` | `{items,total}`+limit/offset | migrate envelope + page/pageSize |
| `GET /audit/activity` | `{items,total}`+limit/offset, in-memory | SQL pagination + envelope (D10) |
| `GET /audit/entities/:type/:id` | same | same |

Exempt (unchanged): `/search`, `/dashboard/summary`, `/health`,
`/metrics`, all detail GETs (`/components/:id`, `/products/:slug`,
`/component-groups/:slug`, `/importer-sources/:id`, `/agents/:id`,
`/credentials/:id`, `/users/:id`), detail sub-lists (`/teams/:id/members`,
`/users/:id/sessions`, `/agents/:id/{configs,runs,sessions}`,
`/importer-sources/:id/{runs,memberships}`, `/components/:id/{dependents,
relationships,url-checks}`, `/components/platform-candidates`), and
`/url-checks/:id/observations` (cursor — already gradual).

## D14 — ADR-130 + amendments

- **Decision**: New `ADR-130-standardized-list-contract.md` ratifying the
  unified list contract; appends `## Amendment 1` to ADR-080 (offset
  everywhere for UI lists; cursor remains for observation streams) and
  `## Amendment 1` to ADR-081 (records shipped `sort`/`order` params,
  multi-value CSV filters, per-endpoint sort whitelists). Back-pointers +
  `architecture-decisions.md` index updates per ADR fidelity.
- **Rationale**: spec FR-014; the changes extend surfaces both ADRs
  present as closed.

## D15 — Testing strategy

- Backend: integration tests per touched endpoint family — pagination
  math, sort ordering + tiebreak, filter/search params, envelope shape,
  the three bugfixes (worstStatus/includeGone, lifecycle override,
  component-groups 400). Extend existing `components.test.ts`,
  `catalog-coverage.test.ts`, org/users/sessions/audit test files.
- Frontend: unit tests for `useListState` (URL round-trip, reset rules,
  invalid-param fallback), `ListToolbar` fix (no phantom "All", Clear
  visibility), mapper updates.
- Playwright: representative coverage — `/components` (paginate, sort,
  filter, gone regression, hover summary, URL restore), `/products`
  (paginate+sort), one admin list (users or credentials), suggestions or
  activity (migrated envelope). Per AGENTS.md testing rules.
- Contract: `docs/openapi.yaml` updated for every endpoint; `docs:api`
  regenerated; route-coverage contract test must pass.
