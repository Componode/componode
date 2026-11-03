# Research: Product Map topology in Dependencies

## Decision: Move the topology into Dependencies

The read-only topology appears at the top of the Dependencies tab. Existing
edge-authoring controls and dependency lists remain below it. The Map tab is
removed; old `?tab=map` links fall back to Dependencies.

**Rationale**: The current map duplicates the Components and Dependencies
surfaces and is the least scannable of the three. Placing it beside edge
authoring makes the relation view and relation controls discoverable together.

**Alternative considered**: keep a separate Map tab (rejected by the user
during design grilling).

**Ratified in**: ADR-118 Amendment 1 and ADR-127.

## Decision: Include the complete product relation set and ComponentGroups

The focused Product's detail read provides `composedBy`, `composes`,
`consumesFrom`, `consumedBy`, and `dependsOnGroups`. Every returned relation
must remain visible. ComponentGroups appear as typed dependency nodes;
individual Components stay in the Components tab.

**Rationale**: `consumedBy` is a real inverse `CONSUMES_FROM` relation and is
currently used by the shipped map. ComponentGroup dependencies are persisted
as Product-owned edges, including empty groups; their members are a different
catalog surface.

**Alternatives considered**: omit `consumedBy` (rejected; silently drops a
returned relation), display Component nodes in the topology (rejected;
duplicates a filterable list), omit ComponentGroup nodes (rejected; loses
the Product's declared group dependency).

**Ratified in**: ADR-127.

## Decision: Preserve actual edge direction

The backend semantics are:

- `composedBy`: Products whose `COMPOSES` edge targets the focused Product;
- `composes`: Products targeted by the focused Product's `COMPOSES` edges;
- `consumesFrom`: Platform Products targeted by the focused consumer;
- `consumedBy`: Products whose `CONSUMES_FROM` edge targets the focused
  Platform;
- `dependsOnGroups`: ComponentGroups targeted by the focused Product.

The canvas may group nodes into left/right lanes, but arrowheads and
accessible text preserve each relation's source and target.

**Evidence**: [`getProductDetail`](../../packages/backend/src/services/product-service.ts#L172-L205)
and the Product detail view-model contract
[`ProductDetail`](../../packages/frontend/src/api/types.ts#L340-L356).

## Decision: Related Product detail uses one bounded read

The existing Product detail response gains related Product health and
Component count fields. The response includes type and criticality for the
inspection panel. Product health uses ADR-112's direct dependency rollup and
nullable no-data semantics. All related-node data is read in a bounded batch;
the frontend does not fetch each Product detail independently.

**Rationale**: The panel needs useful context without request fan-out or
fabricated status. ADR-112 already defines Product health and its direct,
non-transitive source set.

**Evidence**: [`ProductDetail`](../../packages/frontend/src/api/types.ts#L340-L356),
[`getProductDetail`](../../packages/backend/src/services/product-service.ts#L424-L446),
and [ADR-112](../../researches/adrs/ADR-112-product-health-rollup.md).

## Decision: Keep interactions read-only and one-hop

Users may focus/select nodes, inspect details, and expand `+N` overflow.
The layout is deterministic, one-hop, keyboard-operable, responsive, and
reduced-motion aware. Pan, zoom, drag, manual layout, and edge authoring are
not part of this feature.

**Rationale**: Focus and local expansion improve inspection without turning
the map into a graph editor. Existing edge-authoring controls remain below
the topology and continue to own mutations.

**Ratified in**: ADR-118 Amendment 1 and ADR-127.

## Verified current implementation

- The current map uses fixed consumer/Product/ComponentGroup/Component
  regions and displays several other relations as prose:
  [`product-map.tsx`](../../packages/frontend/src/ux/components/products/product-map.tsx#L64-L110).
- The current focus handlers are on a non-focusable `div`, and the SVG
  connectors are hidden below `lg`:
  [`product-map.tsx`](../../packages/frontend/src/ux/components/products/product-map.tsx#L143-L249).
- The product detail read already returns the relation arrays, but related
  ProductRefs do not contain health/count data:
  [`types.ts`](../../packages/frontend/src/api/types.ts#L340-L356).

## Ratified in

- [ADR-118 Amendment 1](../../researches/adrs/ADR-118-product-map-canvas.md)
- [ADR-127](../../researches/adrs/ADR-127-product-map-topology-in-dependencies.md)
