# Feature Specification: Standardized list pages — server-side pagination, sorting, filters, and hover summaries

**Feature Branch**: `068-list-page-standards`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "Accessing /components, filters seem not working
properly (gone instances to show all doesn't select). For all the lists on
the UX they must: (1) have pagination based on 25, 50, 100 rows per page;
(2) be able to sort by the columns available on them; (3) consume the API
gradually and avoid waiting for all the data (especially above the
pagination) to show; (4) on hover over the item title, show a summary of the
item so the title column can be shorter than the full title content."
Design grilled and ratified in a seven-question session (all recommendations
accepted): scope = every primary list page; server-side pagination on every
in-scope endpoint unified on the spec-003 envelope; all SQL-expressible
columns sortable; list state synced to URL params (default pageSize 25);
HoverCard summaries on title cells; one feature spec containing the
ListToolbar fix; three adjacent backend correctness bugs folded in.

## Clarifications

### Session 2026-11-09

All decisions resolved in the grilling session — no open markers:

- **Scope**: every page whose primary content is a server-fed collection —
  products, components, component-groups, sources, agents, credentials,
  sessions, users, teams, lobs, docker-targets, importer configs/runs,
  suggestions, activity. Exempt: pickers/dialogs that legitimately need full
  sets (`useAllComponents` in edge-authoring, slug→id lookups), dashboard
  widgets, settings tables, detail-page sub-tables (instances, runs,
  memberships) unless they already paginate, and static manifest surfaces.
- **Backend**: `page`/`pageSize`/`sort`/`order` + filters on every in-scope
  endpoint, unified on the spec-003 `{data, pagination:{page,pageSize,total,pageCount,hasNext}}`
  envelope; suggestions/audit migrate off `{items,total}`+`limit/offset`;
  URL-check observations keep cursor pagination.
- **Sorting**: server-side whitelist per endpoint covering every
  SQL-expressible displayed column (stored fields + the same aggregate
  subqueries already used for display); app-computed columns (e.g. product
  Completeness) render without the sort affordance.
- **State**: page/pageSize/sort/filters/search sync to URL search params;
  default pageSize 25; filter/search/sort changes reset to page 1.
- **Hover summary**: `HoverCard` with curated per-entity key fields; title
  cells truncate. Components have no description field — importer `details`
  JSON is excluded as noisy.
- **Process**: one feature spec; Phase 1 = the ListToolbar gone-filter fix
  with Playwright regression; Phase 2+ = standards rollout.
- **Folded-in backend bugs**: `worstStatus` rollup counting GONE instances
  regardless of `includeGone` (contradicts ADR-127 Amendment 2); explicit
  `lifecycle=RETIRED` without `includeRetired` returning empty on
  `/components`; `GET /component-groups` 500ing on invalid query input.

## Problem

Two classes of defect motivate this spec.

**UX standards gap.** Every primary list page fetches its entire collection
before rendering: `/components` loops `pageSize=100` requests until
`hasNext` is false (`useAllComponents`), then filters provider/category/
search client-side; every other list endpoint returns unbounded arrays.
There is no pagination UI anywhere (`ui/pagination.tsx` exists unused), no
column sorting anywhere, and no filter state survives a reload or share.
On large catalogs the first paint waits on N sequential requests.

**Filter defect (reproduced).** On `/components`, the "Gone instances"
filter dropdown contains a force-injected "All" option that maps to
`includeGone=false` — selecting it snaps the control back to "Hidden",
reading as "doesn't select". The same defect makes the toolbar's "Clear"
button permanently visible (the filter's value is never `"all"`).
"Shown" does work (verified: 95 → 108 rows), but the control lies about
its options.

## User Scenarios & Testing

### User Story 1 - Browse any list one page at a time (Priority: P1)

A curator opens any primary list page — Components, Products, Sources,
Agents, Credentials, Users, Teams, LOBs, Suggestions, Activity, importer
configs and run history — and sees the first page of results rendered from
a single request, with a pager offering 25, 50, or 100 rows per page
(default 25) and an accurate total count. Moving to another page or
changing the page size fetches only that page.

**Why this priority**: This is the core of the request — large catalogs
currently block first paint on fetching every row, and there is no way to
navigate a long list at all.

**Independent Test**: Open `/components` on a catalog of >100 components;
verify exactly one list request fires on load, the pager offers
25/50/100, page 2 renders the next slice, and the result count matches the
server total.

**Acceptance Scenarios**:

1. **Given** a list endpoint with more rows than the page size, **When**
   the page loads, **Then** only the current page's rows are requested and
   rendered, with working previous/next and page-number navigation.
2. **Given** the page-size selector, **When** the user picks 50 or 100,
   **Then** the list refetches at that size, resets to page 1, and the
   choice persists in the URL.
3. **Given** a filtered result set smaller than one page, **When** the
   user changes a filter, **Then** the list returns to page 1 and never
   shows an out-of-range empty page.
4. **Given** a list whose total shrinks below the current page (e.g. after
   a mutation or filter change), **When** the page refetches, **Then** the
   user lands on a valid page or a clear empty state — never a blank table
   with a pager pointing past the end.

---

### User Story 2 - Sort any list by its columns (Priority: P1)

A curator clicks a column header on any list and the rows reorder —
ascending first, descending on the second click — with the sort applied by
the server so it holds across pages. Columns whose values are computed in
application code (not expressible as a query ordering) render without a
sort affordance rather than sorting only the visible page.

**Why this priority**: Sorting is the second explicit requirement; server-
side sorting is what makes it meaningful under pagination.

**Independent Test**: On `/components`, sort by name and by last-seen;
verify ordering holds when paging to page 2, and that the sort state
appears in the URL.

**Acceptance Scenarios**:

1. **Given** a sortable column header, **When** the user clicks it, **Then**
   rows reorder ascending with a visible sort indicator; a second click
   reverses to descending.
2. **Given** a sorted list spanning multiple pages, **When** the user
   navigates to page 2, **Then** the ordering remains globally consistent
   (no repeats or gaps from page-local sorting).
3. **Given** a column backed by an application-computed value, **When** the
   table renders, **Then** that header shows no sort control.
4. **Given** rows with equal sort keys, **When** sorting is applied,
   **Then** ordering is deterministic across requests (stable tiebreak).

---

### User Story 3 - Filter and search lists with correct, shareable state (Priority: P1)

A curator filters and searches any list; every control is applied by the
server against the full result set — not just the visible page — and the
complete list state (page, size, sort, filters, search) lives in the URL,
so a reload or a shared link restores exactly what they saw. The
"Gone instances" control on `/components` offers only meaningful choices
and actually applies them.

**Why this priority**: Filters that only search the visible page would be
a regression under pagination; the reported defect lives here.

**Independent Test**: On `/components`, select "Shown" under Gone
instances — the control stays selected, the URL updates, gone-only
components appear, and a reload preserves the state. Repeat for provider,
category, and search on another list.

**Acceptance Scenarios**:

1. **Given** the Gone instances filter, **When** the user selects "Shown",
   **Then** the control displays "Shown", gone-only components appear in
   the result set, and the URL reflects the choice.
2. **Given** the Gone instances filter, **When** the dropdown opens,
   **Then** it contains only its real options — no meaningless "All" that
   silently maps to "Hidden".
3. **Given** any active filter or search text, **When** the toolbar
   renders, **Then** "Clear" appears only because something is actually
   filtered — never permanently.
4. **Given** a shared URL containing list state, **When** another user (or
   the same user after reload) opens it, **Then** the identical page,
   filters, sort, and search are restored.
5. **Given** a list page, **When** the user changes search or a filter,
   **Then** the view returns to page 1 and the request carries the
   criteria to the server.

---

### User Story 4 - Preview an item's summary on title hover (Priority: P2)

A curator hovering (or keyboard-focusing) a row's title sees a compact
summary card of that item's key facts — enough to identify it without
opening the detail page — while the title cell itself can truncate long
names.

**Why this priority**: Explicit requirement 4; improves scannability but
depends on the paginated/sorted table existing first.

**Independent Test**: On `/components`, hover a component name; verify a
summary card appears with provider, category, resource type, owner,
lifecycle, instance count/health, last seen, and tags — and that the title
cell truncates visually.

**Acceptance Scenarios**:

1. **Given** a list row, **When** the user hovers or focuses the title,
   **Then** a summary card opens showing that entity's curated key fields.
2. **Given** a long component or product name, **When** the row renders,
   **Then** the title truncates within its column and the full name plus
   summary remain available on hover.
3. **Given** a summary containing sensitive-adjacent data, **When** it
   renders, **Then** it never shows secrets, credential values, or raw
   importer `details` JSON.

---

### Edge Cases

- **Invalid URL state**: hand-edited or stale params (unknown sort key,
  pageSize outside the allowed set, page beyond range, malformed filter
  values) resolve to documented defaults — never a 400 surfaced to the
  user for a GET list page.
- **Polling lists**: agents (15 s) and run history (3 s while active)
  refetch in place; pagination/sort/filter state must survive refetches
  and must not reset the user's page.
- **Multi-value filters**: CSV-valued facets keep working through the URL
  (`?provider=a,b` round-trips).
- **Default visibility preserved**: RETIRED records and GONE-only
  components stay hidden unless explicitly requested — the new controls
  must not change those defaults.
- **Bounded exceptions**: pickers and slug→id lookups may keep fetching
  full sets; they are not "lists" for this spec.
- **Cursor-paginated surfaces** (URL-check observations) already consume
  gradually — unchanged.
- **Empty vs error vs loading**: the existing state matrix (skeleton,
  EmptyState, ErrorState) applies to every list page.

## Requirements

### Functional Requirements

- **FR-001**: Every primary list page MUST render server-paginated results
  with a page-size selector offering exactly 25, 50, and 100 rows per page
  and a default of 25, plus previous/next and page navigation and an
  accurate total/result count.
- **FR-002**: List pages MUST NOT fetch the entire collection to render a
  page — the initial render issues requests only for the visible page
  (filter-option faceting may use a bounded separate query where needed).
- **FR-003**: Every list endpoint backing an in-scope page MUST accept
  `page`, `pageSize`, `sort`, `order` and return the unified envelope
  `{data, pagination:{page,pageSize,total,pageCount,hasNext}}` — the
  spec-003 contract extended to all lists.
- **FR-004**: Existing `{items,total}`+`limit/offset` list endpoints
  (suggestions, audit activity, entity history) MUST migrate to the
  unified envelope and param convention.
- **FR-005**: Each list MUST support sorting by every displayed column
  whose value is expressible as a query ordering (stored fields and the
  aggregate subqueries already used for display), applied server-side with
  a deterministic tiebreak; app-computed columns render without sort
  affordance.
- **FR-006**: Search and filters MUST be applied server-side against the
  full result set; per-entity search semantics MUST cover at least the
  fields the UI advertises (e.g. components: name, resource type, tags);
  search input is debounced.
- **FR-007**: List state — page, pageSize, sort, order, search, and every
  filter — MUST sync to URL search params; changing search/filters/sort
  resets to page 1; deep links restore state; invalid values fall back to
  defaults.
- **FR-008**: `ListToolbar` MUST NOT inject an "All" option into filters
  whose value domain excludes it; the gone-instances filter MUST offer
  only its real choices; "Clear" appears only when the list is actually
  filtered.
- **FR-009**: The component list health rollup (`worstStatus`) MUST
  exclude GONE instances when `includeGone=false`, consistent with
  ADR-127 Amendment 2 ("GONE is reconciliation state, never Component
  health").
- **FR-010**: An explicit `lifecycle=RETIRED` filter on the components
  list MUST return retired rows without also requiring `includeRetired`,
  matching the products/groups `else if` pattern.
- **FR-011**: `GET /component-groups` MUST validate query parameters at
  the route boundary and return `400 VALIDATION_FAILED` — never a 500 —
  on invalid input.
- **FR-012**: Title cells on every in-scope list MUST truncate and reveal
  a `HoverCard` summary of curated per-entity key fields on hover and
  keyboard focus; summaries never render secrets, credential values, or
  raw importer `details`.
- **FR-013**: `docs/openapi.yaml` MUST document every added/changed query
  param and response envelope in the same change, with `docs:api`
  regenerated; the route-coverage contract test must pass.
- **FR-014**: The standardized list contract (envelope, param names,
  sort whitelist convention) MUST be recorded as an ADR (new or
  amendment) per the ADR-fidelity rule, since it extends the surface
  ratified by spec 003.
- **FR-015**: Playwright coverage MUST exercise pagination, sorting,
  filtering, URL-state restoration, and the hover summary on
  representative lists, including a regression test for the
  gone-instances filter defect.

### Key Entities

- **List Query Contract**: the uniform set of list parameters — `page`,
  `pageSize` (25/50/100), `sort`, `order`, plus per-entity filters and
  `search` — validated at the route boundary.
- **Pagination Envelope**: `{data, pagination:{page,pageSize,total,pageCount,hasNext}}`
  — the single list response shape.
- **Table State**: the URL search-param encoding of page/size/sort/
  filters/search for a given list.
- **Item Summary**: the curated per-entity field set shown in the title
  hover card.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every primary list page renders its first page from a single
  collection request — no sequential page loop — verified by network
  inspection on `/components` with >100 rows.
- **SC-002**: 100% of in-scope list pages offer 25/50/100 rows-per-page
  pagination with accurate totals.
- **SC-003**: Sort and filter state round-trips through the URL: a copied
  link reproduces the identical view for any user.
- **SC-004**: The gone-instances filter selects, persists, and applies —
  regression test fails before the fix and passes after.
- **SC-005**: A user can reach any row of a 1,000-row list in at most 40
  page interactions at 25/page, or 10 at 100/page, without the client
  holding more than one page of rows.
- **SC-006**: Title hover shows the summary card on first hover with no
  additional network request (summary fields ride on the list payload).

## Assumptions

- Server-side `search` is extended per endpoint to preserve current UX
  semantics (substring matching over the advertised fields); the components
  endpoint's current prefix-match on name/slug widens to include resource
  type and tags. Search input debounces ~300 ms.
- The list contract change is recorded in a new ADR (or amendment to the
  spec-003 ratification) during planning; `docs/openapi.yaml` is the
  machine-checked contract.
- Pickers, slug→id lookups, dashboard widgets, settings tables, and
  detail-page sub-tables keep their current fetch behavior; only
  user-facing primary lists are held to the standard.
- `pageSize` remains capped at 100 server-side — the 25/50/100 options fit.
- Cursor pagination on URL-check observations is already gradual and stays.
- Card-grid pages fed by user-data collections (component-groups, lobs,
  teams, sources, agents, credentials, docker-targets, importer configs,
  suggestions) are in scope; purely static surfaces (importer manifest,
  settings notification table) are not.

## Out of Scope

- Saved views / filter presets, column show-hide customization, and
  server-driven column configuration.
- Infinite scroll — the requirement is explicit numbered pagination.
- Changing default visibility rules (RETIRED/GONE opt-ins) beyond the
  folded correctness fixes.
- Detail-page sub-tables (component instances, importer runs on detail,
  source memberships/runs, agent sessions/configs) — they keep current
  behavior unless already paginated.
- The disabled component-detail "Show gone" instances button (documented
  gap G26 — needs `includeGone` on the detail read; separate gap spec).
