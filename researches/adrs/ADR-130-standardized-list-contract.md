### ADR-130 — Standardized list contract

> **Status:** Ratified (2026-11-09 grilling, spec 068)
> **Supersedes**: none
> **Amends**: ADR-080, ADR-081 (see "Amendments to earlier ADRs")

**Context**: Every primary list page in the UX fetched its entire
collection before rendering — `/components` looped `pageSize=100`
requests until `hasNext` was false, then filtered client-side; every
other list endpoint returned unbounded arrays. There was no pagination
UI, no column sorting, and no filter state in the URL. Meanwhile the API
surface had drifted into three pagination conventions
(`{data,pagination}` offset on `/components`, `{items,total}`+`limit/offset`
on suggestions/audit, cursor on URL-check observations) and two sort
formats (`sort`/`order` shipped vs. ADR-081's literal
`sort=field:direction`). ADR-080's cursor mandate for high-cardinality
lists could not satisfy the required UX: numbered 25/50/100 pages,
accurate totals, and sorting by arbitrary displayed columns are
incompatible with a fixed `(createdAt,id)` cursor.

**Decision**:

1. **One list contract for every primary list endpoint** —
   `GET` list routes accept `page` (int ≥1, default 1), `pageSize`
   (int 1–100, default 25), `sort` (per-endpoint whitelist), `order`
   (`asc|desc`, default `asc`), `search` (≤100 chars), plus their
   existing entity filters, all validated by `.strict()` Zod schemas in
   `packages/core` (ADR-095). Responses return
   `{data, pagination:{page,pageSize,total,pageCount,hasNext}}` — the
   spec-003 envelope extended to every list. Endpoint-specific extras
   remain top-level (e.g. `/products` `edges` scoped to page ids).

2. **Offset pagination for all UI lists** — numbered pages with totals.
   Cursor pagination remains only for append-mostly observation streams
   (`/url-checks/:id/observations`), where ordering is fixed and totals
   are meaningless. This amends ADR-080's cursor mandate for
   components/runs/audit: column sorting and "page N of M" UX require
   offset; the feared `OFFSET 40000` case is bounded by the sort-column
   index and dominated by the `COUNT(*)` any strategy must run.

3. **Sort = per-endpoint allow-list, two params** — `sort=<key>` +
   `order=asc|desc`, mapped through a whitelisted column/expression per
   service (never raw input — ADR-084). Sortable keys cover every
   displayed column expressible as a query ordering (stored fields,
   joined names, existing aggregate subqueries); application-computed
   columns render without sort affordance. A deterministic tiebreak
   (`orderBy` on a unique column) keeps pagination stable. This records
   the shipped `sort`/`order` format (amending ADR-081's
   `sort=field:direction`) and ratifies multi-value CSV filters
   (amending ADR-081's single-value v1 clause — shipped in spec 015).

4. **Filters stay fixed-param, AND-combined** — ADR-081's core rule is
   unchanged: each endpoint declares its supported filters; no filter
   DSL. `search` is a first-class param per endpoint with a documented
   field list (substring `ILIKE`), replacing client-side search.

5. **List state lives in the URL** — page/size/sort/order/search/filters
   sync to search params (the `?tab=` precedent), so views are
   shareable and restorable; invalid values fall back to defaults.

6. **Scope boundary** — pickers, slug→id lookups, dashboard widgets,
   settings tables, and detail-page sub-tables are exempt unless they
   already paginate; `/search`, `/dashboard/summary`, `/health`,
   `/metrics`, and all detail GETs are unchanged.

**Rationale**: One contract removes three divergent conventions and the
fetch-all-then-filter pattern; offset is the only mechanism satisfying
sortable columns + totals + numbered pages; the whitelisted sort map is
the injection-safe pattern already proven on `/components`; URL-synced
state matches the UX doc's filter convention and makes every list view
deep-linkable.

**Consequences**: ~18 endpoints gain/standardize the contract
(`docs/openapi.yaml` updated in the same change, ADR-104); frontend
list pages adopt shared patterns (`useListState`, `ListPagination`,
sortable headers, `ListToolbar` fix, title hover summaries); suggestions
and audit migrate off `{items,total}`; audit moves from in-memory
slicing to SQL `LIMIT/OFFSET`. Breaking change for direct API consumers
of the migrated envelopes — acceptable for the pre-2.0 internal
contract; the frontend is updated atomically.

**Amendments to earlier ADRs**:

- **ADR-080** — cursor mandate for high-cardinality lists is narrowed to
  observation/append streams; UI lists are offset everywhere (see
  ADR-080 Amendment 1).
- **ADR-081** — `sort=field:direction` is superseded by the shipped
  `sort`+`order` params; single-value filters are superseded by
  multi-value CSV params where shipped (spec 015); sort allow-list rule
  retained (see ADR-081 Amendment 1).
