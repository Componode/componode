# Contract: Topology view-model extension

**Feature**: `061-topology-component-deps` | **Date**: 2026-11-03

No HTTP/API contract change — `GET /api/v1/products/:slug` response shape is
unchanged. This document pins the internal view contract between the detail
read, the mapper, and the `ProductMap` component.

## Producer → view-model

`mapProductTopology(detail, extras)` where
`extras = { instances?: InstanceDepRef[] }`:

| Output | Rule |
|---|---|
| `dependsOnComponents` | `detail.components.declared` filtered to `sources.some(kind === "DIRECT")`, mapped to `TopologyComponent` |
| `worstStatus` | existing `worstInstanceStatus` rollup over `extras.instances`; `null` when none |
| `lifecycle` | `narrow<Lifecycle>` — `RETIRED` preserved |
| `category` | pass-through from `ComponentDepRef` |

Absent `extras` degrade to `worstStatus: null` — never fabricated status
(same convention as `mapRelatedProduct`).

## View-model → canvas

- Lane `"dependsOnComponents"`: `incoming: false`, title "Depends on
  components", hint `${product.name} → components`. Rendered in the outgoing
  column after `consumesFrom`, before/after `dependsOnGroups` is free — both
  are outgoing; order: `composes`, `consumesFrom`, `dependsOnComponents`,
  `dependsOnGroups`.
- Node `kind: "component"`: name + status dot; sublabel shows the mapped
  category label when present; `Retired` label when `lifecycle === "RETIRED"`.
- Edge: `product → component` (arrowhead at the component), same draw path as
  other outgoing lanes.
- Inspection panel (component kind): name, "Component dependency" context
  line, status/no-data, Open component link.
- Empty state: rendered only when every lane is empty; copy names the covered
  relation kinds (composition, platform consumption, component dependencies,
  group dependencies) — never "depends on nothing".
- `unavailableRelationGroups` behavior unchanged — `dependsOnComponents` is
  not a degradable family; it fails with the detail read as a whole.

## Invariants

- Direct edges only: `GROUP`- and `INHERITED`-only `ComponentDepRef`s never
  produce nodes.
- Zero additional requests; zero writes.
- `HEALTH_META`-derived tones only; `GONE` never presented as status.
