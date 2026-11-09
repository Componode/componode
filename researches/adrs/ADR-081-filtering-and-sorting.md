### ADR-081 — Filtering and sorting

> **Status:** Ratified

**Context**: List endpoints need filtering and sorting.

**Decision**: **Fixed query params per endpoint, AND-only, single-value
filters in v1. `sort=field:direction` with allow-listed sortable fields.**
Each endpoint declares its supported filters (e.g.
`GET /api/v1/components?category=COMPUTE&provider=AWS&lifecycle=ACTIVE`).
Ranges and OR-combinations are v1.1 needs.

**Rationale**: v1 UI's filter needs are single-value, AND-combined (category
select, provider select, lifecycle select, owner select). A generic filter
DSL is overkill and creates a security surface (arbitrary column filtering).
Ranges/OR can be added later as multi-value params or a structured filter
extension without breaking existing params. Sort allow-list prevents sorting
on unindexed columns.

## Amendment 1 — Shipped param shapes ratified (2026-11-09, via ADR-130)

**Context**: Implementation diverged from this ADR's literal text in
three ways without an amendment: sort shipped as `sort=<key>` +
`order=asc|desc` (not `sort=field:direction`); filters accept
comma-separated multi-values (spec 015) rather than single-value only;
and the sort allow-list is per-endpoint whitelists of displayed,
SQL-expressible columns.

**Refinement**: The ratified rules that survive: fixed query params per
endpoint, AND-combined, no filter DSL, and the sort allow-list (now
covering every displayed column expressible as a query ordering, with
application-computed columns unsortable). The superseded literal details:
`sort=field:direction` → `sort`+`order` params; single-value filters →
multi-value CSV where shipped. ADR-130 records the unified contract.

---

**Amended by ADR-130**: standardized list contract.