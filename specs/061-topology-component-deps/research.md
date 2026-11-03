# Research: Component dependencies in Product topology

**Date**: 2026-11-03 | **Feature**: `061-topology-component-deps`

## Decisions

### D1 — Which Component dependencies become nodes?

**Decision**: Only `ComponentDepRef`s in `components.declared` carrying a
`DIRECT` `DepSource`.

**Rationale**: `components.declared` also contains group-mediated members
(`GROUP` sources) — rendering those as component nodes would double-count a
path already represented by the `dependsOnGroups` node and break spec-060's
"via [ComponentGroup]" provenance rule. `inherited` components belong to
`COMPOSES` descendants, not to this product's own dependency set.

**Alternatives considered**: all declared components (rejected — duplicate
provenance); a collapsed `N components · M groups` summary node (v0-draft Q4
fallback — rejected as a second, inconsistent disclosure mechanism; the `+N`
lane expansion already handles scale).

### D2 — Node status source

**Decision**: Reuse `worstInstanceStatus(instances, componentId)` — the same
rollup `mapDepComponent` uses for the Components tab — over
`instances.declared + instances.inherited` from the same detail read.

**Rationale**: Consistent with the Components tab and spec-039 rollup;
`InstanceStatus` is a superset of the map's `HealthStatus` and `HEALTH_META` is
already keyed by it, so `StatusDot` needs only a widened prop type. `GONE`
instances are excluded by the backend's default visibility, so `GONE` can
never surface as Component health.

**Alternatives considered**: a per-node backend health field (rejected —
unbounded read growth for zero information gain over the existing join).

### D3 — Where the mapping happens

**Decision**: Extend `mapProductTopology(d, { instances, catalog })` in
`api/mappers/catalog.ts`; `$slug.tsx` passes the same `allInstances` and
catalog arrays it already builds for the Components tab.

**Rationale**: The mapper's doc comment declares it "the sole conversion seam"
for the detail response → topology view-model; adding a second seam in the
page would violate that convention and duplicate the `DIRECT`-source filter.

**Alternatives considered**: filter in `product-map.tsx` (rejected — view
components don't own dep-source semantics); filter in `product-detail.tsx`
(rejected — same reason, plus it would split the topology shape).

### D4 — Lane model and copy

**Decision**: New `LaneKey = "dependsOnComponents"` with
`incoming: false` (outgoing lane on the right side, beside
`dependsOnGroups`), title "Depends on components", hint `${product} →
components`. Empty-state and card-description copy rewritten to distinguish
composition, platform consumption, Component dependencies, and ComponentGroup
dependencies.

**Rationale**: Mirrors the Relations card which already separates
`DEPENDS ON COMPONENTS` from `DEPENDS ON GROUPS`; keeps edge-direction-true
semantics (product → component) rather than the v0 mockup's dependency-axis
columns, which the spec-059 grilling rejected for inverting `COMPOSES`.

**Alternatives considered**: merging components into `dependsOnGroups` as one
"Depends on" lane (rejected — loses the direct/group provenance the Relations
card and spec 060 both preserve).

### D5 — Governance

**Decision**: Amendment 2 to `researches/adrs/ADR-127-*.md` superseding the
"Individual Components remain in the Components list" refinement for direct
dependency targets; `docs/ux.md` topology bullet updated in the same change.
No ADR-118 change needed — its data-true constraint is *strengthened* (a
fetched relation stops being silently dropped). `docs/roadmap.md` gains the
shipped entry at merge.

**Rationale**: ADR-127 Amendment 1 made the exclusion; the same instrument
records its reversal, per the repo's amendment convention (ADR-036, ADR-047,
ADR-118 all carry amendments).
