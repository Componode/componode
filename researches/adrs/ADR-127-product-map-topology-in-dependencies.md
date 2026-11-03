# ADR-127 — Product Map topology inside Dependencies

> **Status:** Ratified (2026-11-03)
> **Amends:** ADR-118 and ADR-103 (`docs/ux.md`)
> **Spec:** `specs/059-product-map-topology`

## Context

The shipped product map duplicates the Components and Dependencies surfaces,
does not distinguish every relation returned by the product detail read, and
does not provide keyboard-operable focus or responsive topology. The reviewed
redesign keeps the map read-only but changes its information architecture and
adds focus/expansion/inspection behavior. ADR-118 ratifies the read-only map
and requires that all returned relationships remain visible; ADR-103 makes
`docs/ux.md` normative.

## Decision

Amend ADR-118 as recorded in its Amendment 1:

- Move the topology into the **top of the Dependencies tab** and retain the
  existing edge-authoring controls below it.
- Show the focused Product and one-hop related Products and ComponentGroups.
  Individual Components remain in their separate Components tab.
- Preserve every relation from the product detail read, including
  `composedBy`, `composes`, `consumesFrom`, `consumedBy`, and
  `dependsOnGroups`. Edge direction must reflect the source and target
  semantics, not only the column position. ComponentGroup dependencies render
  as group nodes; Components do not become topology nodes.
- Add related-Product health and Component count to the existing detail read
  in a bounded batch. Product health uses ADR-112 semantics; a missing value
  is shown as no data, not fabricated health.
- Permit keyboard-operable selection, focus, `+N` expansion, and a read-only
  inspection panel. Keep the layout deterministic and one-hop. Pan, zoom,
  drag, manual layout, and edge authoring remain out of scope.
- Meet the `docs/ux.md` accessibility, token, state, and responsive
  requirements, including usable layout at 768px, reduced-motion behavior,
  and no horizontal overflow.

`docs/ux.md` is amended to place the topology on Dependencies and preserve the
existing list-form edge-authoring surface below it.

## Amendments to earlier ADRs

- **ADR-118** — Amendment 1 moves the read-only topology into Dependencies,
  requires all returned Product relations (including `consumedBy`), and
  permits focus/inspection/expansion without permitting pan/zoom/edit.
- **ADR-103** — `docs/ux.md` records the new Dependencies-tab placement and
  the explicit read-only interaction boundary.

## Consequences

- The product detail response is extended with the fields needed for related
  Product health and Component counts. The route remains read-only and
  authenticated; OpenAPI and route contract tests change with the response.
- The frontend must expose all relation directions, including `consumedBy`,
  and cannot silently drop ComponentGroup dependencies.
- Product Map status presentation uses Product health, not ComponentInstance
  lifecycle or URL Check status directly.
- The Map tab is removed; existing deep links to `?tab=map` fall back to the
  Dependencies tab.

## Alternatives considered

- **Keep the Map tab** — rejected by the user during design grilling; topology
  is placed with dependency authoring and list content instead.
- **Remove ComponentGroup dependency nodes** — rejected; group edges are
  returned by the product detail read and must remain visible.
- **Put Components on the topology** — rejected; Components remain in their
  dedicated list to avoid duplicating a large, filterable collection.
- **Add pan/zoom or graph authoring** — rejected; this amendment remains a
  bounded read-only view.

## Amendment 2 — Direct Component dependencies as topology nodes (2026-11-03)

**Spec:** `specs/061-topology-component-deps`

**Context**: The original decision kept individual Components out of the
canvas. In practice, the most common product shape is a Product whose only
relations are direct `DEPENDS_ON` Component edges; for those products the map
rendered a false "No relationships yet" empty state and could not answer the
triage question it exists for ("what does a failure here touch"). The
component-exclusion refinement is narrowed to exclude only *group-mediated*
and `COMPOSES`-inherited paths — never authored direct edges.

**Refinements**:

- Direct `DEPENDS_ON` Component targets appear as typed nodes in a "Depends on
  components" lane on the outgoing (dependency) side, beside `dependsOnGroups`.
- Component nodes carry the derived operational status (worst status across
  their non-`GONE` ComponentInstances) or no-data; `RETIRED` targets are
  labeled, not dropped. `GONE` is never presented as Component health.
- Only direct edges produce nodes. Components reachable solely through a
  depended ComponentGroup remain represented by the group node ("via
  [ComponentGroup]" provenance, ADR-128), and `COMPOSES`-inherited components
  are not the focused product's dependencies.
- The lane reuses the existing mechanics: four-node cap with `+N` expansion,
  keyboard selection/inspection/Escape, and an Open component action.
- No read contract change: node data comes from the existing detail read
  (`components.declared` `DIRECT` sources + the instances rollup); the map
  stays read-only and bounded.

**Supersedes**: the "Individual Components remain in their separate Components
tab" and "Components do not become topology nodes" statements above, and the
"Put Components on the topology — rejected" alternative, for *direct*
dependency targets only. The Components tab remains the inventory surface.

---

**Amended by ADR-127**: Product Map topology is placed in Dependencies with
typed relation coverage and bounded read-only focus/expansion; see Amendment 1
to ADR-118. Amendment 2 adds direct Component dependency nodes.
