# Research: Catalog Coverage & Hygiene

> Phase 0 output for `023-coverage-and-hygiene`. The spec is fully ratified
> (metric set, filters, chip scope settled by the 2026-10-18 grilling
> addendum; dependency-surface and retired-edge semantics settled by the
> 2026-10-20 clarification session). The open questions were all *how* —
> carrier endpoint, shared semantics, and param/filter mechanics — resolved
> here against existing code conventions.

## Decision 1 — Coverage rides on `GET /dashboard/summary`

**Decision**: Extend the existing dashboard summary response with a
`coverage` object rather than adding a new endpoint.

**Rationale**: The improvement plan calls for "one aggregate endpoint; no
new state." The dashboard page already loads `useDashboardSummary()` once;
a section on the same payload means zero additional requests, one
loading/error surface, and automatic consistency with the attention feed
computed in the same call. The summary already computes per-product health
(a heavier derivation) — coverage aggregates are lighter.

**Alternatives considered**: A dedicated `GET /dashboard/coverage` route —
rejected: an extra round-trip and a second failure domain for data drawn
from the same tables; the page-level state matrix already handles section
errors without needing a separate endpoint.

## Decision 2 — One shared "wired" definition, SQL-side

**Decision**: `catalog-coverage-service.ts` exposes a
`wiredComponentIdsQuery()` — a Kysely `UNION` subquery of

- `product_depends_on_component.componentId` joined to non-retired
  `digital_products`, and
- `components.id` where `components.componentGroupId` is in
  `product_depends_on_component_group` joined to non-retired products

used verbatim by the coverage count (`count`) and the `wired` list filter
(`whereRef("components.id", "in" / "not in", subquery)`).

**Rationale**: FR-006 requires metric and worklist to agree — sharing the
subquery makes disagreement impossible. Keeping it SQL-side avoids
materializing up to ~10k component ids into an application-side `IN`
array; junction tables are indexed for both directions. The coverage
*population* (default-visible: `ACTIVE` and not instances-all-`GONE`) is
applied as a separate predicate shared by the metric and both filter
values — per the 2026-10-20 clarification, gone-only components inflate
neither the denominator nor the worklist.

**Alternatives considered**: Materializing the id set in JS and passing it
as a parameter list — rejected on scale grounds and because the filter
would then depend on a service return value rather than the predicate
itself.

## Decision 3 — Dependency surface = own edges + live descendant edges

**Decision**: `computeDependencySurfaces()` returns the set of non-retired
product ids with a non-empty surface:

- own `DEPENDS_ON` — `productId` present in
  `product_depends_on_component` **or** `product_depends_on_component_group`
  (an edge to an empty group still counts — declared intent),
- own `CONSUMES_FROM` — `consumerId` present in `product_consumes_from`
  (the edge is the product's own declaration; the platform's lifecycle is
  irrelevant to whether the consumer declared a dependency),
- a `DEPENDS_ON` edge on any **non-retired** `COMPOSES` descendant,
  computed with the same `WITH RECURSIVE` parent→child expansion the
  detail page already uses for its Inherited view
  (`product-service.ts` `descendants` CTE).

A retired descendant's `DEPENDS_ON` does **not** relieve the parent —
consistent with the ratified rule that retired-product edges confer no
coverage.

**Rationale**: Matches the domain model — a product's dependency surface
is "Declared + Inherited," exactly what `getProductDetail` renders. A
`BUSINESS_CAPABILITY` composed of wired applications is correctly not
dep-less (clarification answer C). Computing the whole-catalog map once
(all products are bounded — hundreds, not thousands) serves the metric,
the `missing` filter, and the chip with identical semantics.

**Alternatives considered**: (a) Declared-only — rejected by the
clarification session (every aggregate parent would flag as dep-less).
(b) Per-product recursive queries — rejected: N+1 over the products list.
(c) Including descendant `CONSUMES_FROM` — rejected: consumption is never
inherited, the same rule ADR-112 applies to health rollups.

## Decision 4 — Facet-shaped list params

**Decision**:

- `GET /components` gains `wired` — comma multi-value (`wired`, `unwired`),
  matching the existing `stringOrStringArray` facet convention; values
  combine with OR within the facet (both selected = unfiltered).
- `GET /products` gains `missing` — comma multi-value (`owner`,
  `dependencies`, `description`), OR within the facet; composable with
  `type`, `tag`, `criticality`, `q`, `lifecycle` as usual.

**Rationale**: `docs/ux.md` §4 puts filters in the URL; the existing
facets are multi-value-OR (ADR-081 multi-value enums shipped in 015). The
dashboard tiles link to single-value selections, which is all the spec
requires, while multi-select costs nothing extra.

**Alternatives considered**: Three separate boolean params
(`noOwner`, `noDeps`, `noDescription`) — rejected: diverges from the
faceted-filter convention and triples the param surface for the same
semantics.

## Decision 5 — Sunset overdue joins the existing attention feed as two kinds

**Decision**: `AttentionItem.kind` gains `SUNSET_OVERDUE_PRODUCT` and
`SUNSET_OVERDUE_COMPONENT`. Query: `sunsetAt < now()` on
`lifecycle = 'ACTIVE'` products and components. Items append **after** all
operational kinds (failed runs → product errors → instance errors/gone →
sunsets) inside the existing `ATTENTION_LIMIT` cap; `at` carries the
`sunsetAt` timestamp.

**Rationale**: One kind per entity type matches the existing granularity
(`INSTANCE_ERROR` vs `PRODUCT_ERROR` are already distinct kinds) and lets
the label text read "Product sunset overdue" / "Component sunset
overdue." Sharing the cap with last-place ordering means a burst of
overdue sunsets can never crowd out a failed importer run (spec edge
case).

**Alternatives considered**: A single `SUNSET_OVERDUE` kind — rejected:
loses the entity-type distinction the label pattern relies on. A separate
"hygiene" dashboard section — rejected: `docs/ux.md` §10 defines one
attention section; splitting adds chrome without new information.

## Decision 6 — Completeness chip and consumer count are server-side row fields

**Decision**: `listProducts` attaches `completeness: {owner, description,
dependencies}` and `consumedByCount` to every product row (same place
`status` health is already attached); `getProductDetail` adds
`completeness`. The platform consumer count on the detail page derives
client-side from the existing `consumedBy` array — no duplicate
derivation, so FR-011's "count equals the Consumed-by list" holds by
construction.

**Rationale**: List rows carry no dependency data today, so the chip
cannot be computed client-side; computing it where health is already
computed keeps per-product derivation in one place. `consumedByCount` is
one `GROUP BY` query over `product_consumes_from` restricted to the
listed ids. The count inherits the Consumed-by section's existing
conventions verbatim — including listing retired consumers — which is
what makes "agree in 100% of cases" trivially true.

**Alternatives considered**: Client-side derivation — impossible for deps
(rows lack edge data). A separate `consumedByCount` query on detail —
rejected: the array is already loaded.

## Decision 7 — No schema, no new route modules, no writes

**Decision**: Zero migrations; `sunsetAt`, the junction tables, and
`componentGroupId` already carry every input. No new endpoints — only
response fields and query params on existing routes. Nothing in the
feature writes.

**Rationale**: Ratified scope ("no new state", "read-only derivation").
The products list is unpaginated (flat list + client-built tree), so the
surface map is computed once per request over the filtered id set —
bounded and cheap.

**Alternatives considered**: A `catalog_snapshots`/`coverage_cache` table
for speed — rejected outright (non-goal: derived per read; premature at
catalog scale).
