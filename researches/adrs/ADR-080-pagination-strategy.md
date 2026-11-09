### ADR-080 — Pagination strategy

> **Status:** Ratified

**Context**: List endpoints need pagination. A deployer with 50,000 components
needs it.

**Decision**: **Cursor-based for high-cardinality (components, instances, runs,
audit logs) + offset-based for low-cardinality (products, LOBs, teams,
persons, importer configs).** Cursor is `(createdAt, id)` (UUID v7 is time-
sortable per [ADR-045](./ADR-045-entity-identifier-format.md)). Frontend `usePaginatedQuery` hook abstracts both.

**Rationale**: Cardinality asymmetry is real (5-20 products vs 50,000
components). Forcing cursor on products loses "page 1 of 2" UX; forcing offset
on components makes `OFFSET 40000` a 2-second query. Right tool per endpoint.
Estimated counts (`pg_class.reltuples`) for display if needed ("~50,000
components").

## Amendment 1 — Offset for all UI lists (2026-11-09, via ADR-130)

**Context**: The ratified split assumed lists would not need arbitrary
column sorting or "page N of M" navigation. Spec 068's requirements —
numbered 25/50/100 pages, accurate totals, and sorting by every displayed
column — are incompatible with a fixed `(createdAt,id)` cursor, and the
shipped `/components` endpoint had already adopted offset pagination
(spec 003 FR-001) without an amendment.

**Refinement**: Offset (`page`/`pageSize`) pagination is the contract for
**all UI list endpoints**, including the high-cardinality ones this ADR
assigned to cursor (components, runs, audit). Cursor pagination is
retained only for append-mostly observation streams where ordering is
fixed and totals are meaningless (`/url-checks/:id/observations`).
`OFFSET` cost is bounded by indexing the active sort column; the
`COUNT(*)` a numbered pager requires dominates request cost under any
strategy. ADR-130 records the unified contract.

---

**Amended by ADR-130**: standardized list contract — offset everywhere
for UI lists; cursor only for observation streams.