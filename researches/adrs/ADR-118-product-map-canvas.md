# ADR-118 — In-app product map graph canvas

**Status**: Accepted (2026-10-30) | **Amends**: ADR-103 (scope boundary in `docs/ux.md` §8)

## Context

`docs/ux.md` §8 (ratified via ADR-103) declared: *"No in-app graph canvas —
the product 'Map' is the textual relations view; a node-edge canvas still
requires its own ADR (deferred)."* The spec-029 UX rewrite ported the v0
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
