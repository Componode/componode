# Data Model: Component dependencies in Product topology

**Date**: 2026-11-03 | **Feature**: `061-topology-component-deps`

No persistence or API changes. This document describes the view-model delta.

## Existing inputs (unchanged)

| Field | Type | Notes |
|---|---|---|
| `ProductDetail.components.declared` | `ComponentDepRef[]` | `{ id, name, slug, category, lifecycle, sources: DepSource[] }` |
| `DepSource.kind` | `"DIRECT" \| "GROUP" \| "INHERITED"` | `DIRECT` = authored Product→Component edge |
| `ProductDetail.instances.{declared,inherited}` | `InstanceDepRef[]` | `{ componentId, status, ... }` — non-GONE by default |
| `ProductDetail.unavailableRelationGroups` | `RelationGroupKey[]` | unchanged — components are not a degradable family (they ride the core detail read) |

## New view-model (frontend only)

```ts
// ux/lib/view-types.ts
interface TopologyComponent {
  id: string;
  name: string;
  slug: string;
  category: string;
  lifecycle: Lifecycle;            // RETIRED labeled, never dropped
  worstStatus: InstanceStatus|null; // worst over non-GONE instances; null = no data
}

interface ProductTopology {
  composedBy: RelatedProduct[];
  composes: RelatedProduct[];
  consumesFrom: RelatedProduct[];
  consumedBy: RelatedProduct[];
  dependsOnGroups: TopologyGroup[];
  dependsOnComponents: TopologyComponent[];  // NEW — DIRECT sources only
  unavailableGroups: string[];
}
```

## Derivation rules

- `dependsOnComponents = components.declared.filter(c => c.sources.some(s => s.kind === "DIRECT"))`
- `worstStatus = worstInstanceStatus(declared+inherited instances, id)` — same
  rollup as `mapDepComponent` (RANK: ERROR < GONE < STOPPED < RUNNING; GONE rows
  absent by default visibility).
- Dedup: a `ComponentDepRef` appears at most once in `declared`; no extra dedup
  needed. A component reachable via direct + group paths still renders once in
  the components lane while the group node represents the group edge.

## Map-side node shape

`TopologyNode` gains `{ kind: "component"; data: TopologyComponent }`.
- `nodeStatus(component) = worstStatus` (`StatusDot` widened to `InstanceStatus`).
- Accessible name: `"<name>, <product> depends on, <status label | no status data>"` (+ `", retired"` when `RETIRED`).
- Inspection panel: name, "Component" kind context, status or no-data,
  "Open component" → `ux("/components/<slug>")`.
