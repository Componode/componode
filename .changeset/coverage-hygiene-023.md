---
"@componode/core": minor
"@componode/backend": minor
"@componode/frontend": minor
---

Catalog coverage & hygiene (spec `023-coverage-and-hygiene`): a read-only derived layer showing how complete the catalog is and where the next curation action is.

- Dashboard **Catalog coverage** card: wired share of the default-visible component set, plus non-retired products missing an owner, a dependency surface, or a description — every figure links to its filtered worklist; zero denominators render `—`, never `0%`.
- New list facets: `/components?wired=unwired` (the gap worklist; group-reached components count as wired, pending suggestions don't) and `/products?missing=owner,description,…` (OR'd gap facets).
- **Completeness chip** on product rows and detail headers — three independent facets (owner / description / dependency surface), no score.
- `consumedByCount` on platform list rows and detail — how many products hold a `CONSUMES_FROM` edge on the platform.
- Overdue `sunsetAt` on non-retired products and components joins the dashboard attention feed below operational items. All figures computed on read — nothing persisted, nothing can go stale.
