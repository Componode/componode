# ADR-118 — In-app product map graph canvas

**Status**: Accepted (2026-10-30) | **Amends**: ADR-103 (scope boundary in `docs/ux.md` §8)

## Context

`docs/ux.md` §8 (ratified via ADR-103) declared: _"No in-app graph canvas —
the product 'Map' is the textual relations view; a node-edge canvas still
requires its own ADR (deferred)."_ The spec-029 UX rewrite ported the v0
prototype's product map verbatim — an SVG bezier-edge canvas
(`ux/components/products/product-map.tsx`) that ships in 1.1.0 — in direct
contradiction of that boundary. The 1.1.0 conformance review (spec 038)
surfaced the contradiction and the disposition was grilled: the canvas is
kept and the boundary is redrawn by this ADR.

## Decision

The product "Map" MAY be an in-app graph canvas. The shipped
`product-map.tsx` implementation is ratified as the canonical relations
visualization for product detail.

Constraints that stand:

- **Read-only.** The canvas renders relations; edge authoring is a
  separate governed gap (G31), not a canvas capability.
- **Data-true.** Every relation the detail read returns
  (`composedBy`/`composes`/`consumesFrom`/`dependsOnGroups`) must be
  displayed — labeled edge kinds or an equivalent relations summary.
  Nothing fetched is silently dropped.
- **Tokenized.** Status tones come from `HEALTH_META`/domain `*_META`
  tables; no ad-hoc status→color maps.
- A full node-edge graph editor (drag, layout, authoring) still requires
  its own ADR — this ratifies the display canvas only.

## Consequences

- `docs/ux.md` §8's canvas prohibition is superseded by the read-only
  canvas carve-out above; §8 is amended with this back-pointer.
- Edge authoring (G31) and any interactive graph work (pan/zoom/edit)
  need their own spec + ADR.

## Amendment 1 — Product topology in Dependencies (2026-11-03, ADR-127)

**Context**: The shipped map duplicates the Components and Dependencies
surfaces, omits `consumedBy`, and has keyboard and responsive gaps. The
approved redesign consolidates topology with dependency authoring without
making the canvas itself an authoring surface.

**Refinements**:

- The one-hop topology renders at the top of Dependencies; existing
  edge-authoring and list controls remain below it.
- ComponentGroup dependency targets appear as group nodes. Individual
  Components remain in the Components list, but their dependency/source
  information remains visible in that tab.
- The detail read's complete product relation set is visible:
  `composedBy`, `composes`, `consumesFrom`, `consumedBy`, and
  `dependsOnGroups`. Arrows and accessible text preserve each relation's
  actual source and target.
- Related Product nodes include health/count details from the existing
  product detail read, computed in a bounded batch using ADR-112. A missing
  health value remains no data.
- Read-only focus, selection, inspection, keyboard traversal, and `+N`
  expansion are allowed view interactions. Pan, zoom, drag, manual layout,
  and edge authoring remain outside the carve-out.

---

**Amended by ADR-127**: the Product Map is relocated to Dependencies and its
relation coverage and allowed read-only interactions are refined in Amendment 1.
