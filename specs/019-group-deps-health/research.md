# Research: Group Dependencies & Product Health

Both capabilities were ratified before this spec existed —
[ADR-110](../../researches/adrs/ADR-110-product-dependency-on-component-group.md)
(+ 2026-10-18 bulk amendment) and
[ADR-112](../../researches/adrs/ADR-112-product-health-rollup.md) — and the
feature packaging itself was fixed by the improvement-plan addendum
(`researches/digital_product_concepts_review_research.md`). No NEEDS
CLARIFICATION items remain from Technical Context; this document records the
ratified inputs, the `/speckit-clarify` answers, and the mechanics decisions
the ADRs leave to implementation.

## Ratified inputs (not re-decided)

- Group edges are **persisted, not expanded at write**; expansion happens at
  read with "via {group name}" attribution and dedup (ADR-110 §1–2).
- Add-dependency accepts **exactly one of** `{componentId}` |
  `{componentGroupId}` | `{componentIds[]}`; DELETE takes a target-kind
  discriminator; audit `toEntityType: "component_group"` (ADR-110 §3,
  amendment).
- Edge to an empty group is valid; expansion is single-hop and cycle-free
  because groups cannot nest (ADR-110 §4).
- Health shape `{status, perEnv, sourceCount}`; declared sources only —
  clarified 2026-10-18 that `COMPOSES`-inherited deps do **not** feed health;
  worst-of `ERROR > STOPPED > RUNNING` over non-`GONE` instances;
  `PRODUCTION` headline with all-env fallback; `RETIRED`-component instances
  excluded; empty → `null` → muted "—" (ADR-112, spec Clarifications).
- Products with `ERROR` health appear in dashboard attention; `GONE`-only
  never appear (ADR-112 §5).
- A `ComponentGroup` cannot be hard-deleted while product→group edges
  reference it — `409 REFERENCED` naming the depending products (spec
  Clarifications, FR-009).

## Codebase findings

- `addDependsOnEdgeSchema` (`packages/core/src/schemas/product.ts:63`) is a
  strict `{componentId}` object → becomes the union schema.
- `addDependsOnEdge`/`removeDependsOnEdge`
  (`packages/backend/src/services/product-edge-service.ts:161,189`) insert
  into `product_depends_on_component` with `onConflict doNothing` —
  idempotent adds are the existing convention bulk reuses per edge.
- `getProductDetail` (`product-service.ts:126`) already splits
  declared/inherited deps by `viaId` and surfaces `via` attribution —
  expansion slots into the same query set; `countProductEdges` (:284) is the
  delete guard that must count the new junction (FR-008).
- `deleteComponentGroup` (`component-group-service.ts:217`) hard-deletes
  with no guard today — the junction is its first dependent table.
- `component_groups` rows list without member counts
  (`listComponentGroups`, :38) — picker labels need a count.
- Dashboard attention (`dashboard-service.ts:85-129`) is a typed
  `AttentionItem[]` (`FAILED_RUN|INSTANCE_ERROR|INSTANCE_GONE`) — new kind
  `PRODUCT_ERROR` fits the same shape (`href: /products/{slug}`).
- FK convention: edge junctions use `onDelete cascade` at the DB level while
  service guards (`deleteProduct`) produce `409 REFERENCED` — apply the same
  pairing to the group side: cascade FKs as safety net + service guard for
  UX/audit (FR-009).
- Frontend: `EdgePicker` (`edge-picker.tsx`) selects components only;
  `useComponentGroups()` hook already exists; `ComponentDepRef.via` is the
  current inherited-attribution field; `useRemoveEdge` calls
  `DELETE /products/{id}/{kind}/{otherId}` path-only — gains the `?kind=`
  query param.

## Mechanics decisions (implementation-owned)

### Decision: DELETE discriminator is `?kind=component|group` (default `component`)

- **Rationale**: `DELETE /products/:id/depends-on/:componentId` is a live
  route; adding an optional query enum keeps existing callers working while
  satisfying ADR-110's "target-kind discriminator". Explicit `kind=group`
  removes a group edge; absence/other values behave exactly as today.
- **Alternatives considered**: split routes
  (`/depends-on/components/:id` + `/depends-on/groups/:id`) — rejected:
  breaks the existing path for zero benefit; body-based DELETE — rejected:
  non-idiomatic and complicates the contract.

### Decision: dependency rows carry a `sources[]` array (replaces `via` on `ComponentDepRef`)

- **Rationale**: FR-002 requires showing a component once with *all* sources
  attributed — direct edge, each covering group, and/or inherited products.
  The current `via?: productRef` cannot express >1 source.
  `DepSource = {kind:"DIRECT"} | {kind:"GROUP"; group:{id,name,slug}} |
  {kind:"INHERITED"; product:{id,name,slug}}`. `declared[]` = rows with ≥1
  `DIRECT`/`GROUP` source; `inherited[]` = rows with only `INHERITED`
  sources — same two buckets as today, one row per component.
- **Alternatives considered**: keep `via` + add `viaGroups[]` — rejected:
  still can't mark a row as both direct and group-sourced without a third
  flag; `sources[]` is one extensible field and the API is ours (openapi
  updated same-change).

### Decision: product detail gains `dependsOnGroups: GroupRef[]`

- **Rationale**: an edge to an **empty** group expands to zero component
  rows — without an explicit group-edge list it would be invisible and
  unremovable. The list also drives the remove affordance (FR-006) and the
  delete-guard story.
- **Alternatives considered**: derive groups from `sources[]` — rejected:
  empty-group edges vanish.

### Decision: `listComponentGroups` gains `memberCount`

- **Rationale**: FR-010's "(group · N)" picker label; a subquery count on
  `components.componentGroupId` — cheap at catalog scale, no client-side
  counting over paginated component lists.
- **Alternatives considered**: count members client-side — rejected: picker
  fetches a page of components, so counts would be wrong beyond pageSize.

### Decision: pure aggregation in `packages/core`, batch loader in `packages/backend`

- **Rationale**: ADR-112 calls the rollup "a pure aggregation function
  (unit-testable) plus service wiring". `computeProductHealth` in
  `packages/core` takes `{environment, status, componentLifecycle}` rows →
  `ProductHealth | null`, no DB. Backend `product-health-service` does the
  batch fetch (edges → group members → instances) and computes per product
  for detail/list/dashboard with a constant query count.
- **Alternatives considered**: per-product query loop — rejected: N+1 on
  list/dashboard; stored health column — rejected by ADR-112.

### Decision: attention ordering — `PRODUCT_ERROR` after `FAILED_RUN`, before instance items

- **Rationale**: product-level "is my product affected" ranks above raw
  instance noise but below operational failures that can poison the data
  itself. Keeps existing ordering for the rest.
- **Alternatives considered**: first overall — rejected: failed importer
  runs are the operational root-cause signal.

### Decision: bulk `componentIds[]` — `.min(1).max(100)`, deduped, atomic

- **Rationale**: non-empty per spec edge case; `max(100)` is a sanity bound
  well above real wiring needs (spec Assumptions allows a schema bound);
  service dedupes the array, validates all ids exist (any miss → `404
  NOT_FOUND` listing the misses, consistent with single-target), applies all
  edges + one audit row per edge in one transaction.
- **Alternatives considered**: partial-apply with per-item report — rejected:
  spec requires all-or-nothing.

### Decision: retired group targets follow the existing component convention

- **Rationale**: `addDependsOnEdge` performs no lifecycle check on component
  targets today — same for group targets (existence only). The pickers
  filter `RETIRED` options, matching current component behavior. A `RETIRED`
  group still expands to members (membership is the component FK).
- **Alternatives considered**: reject retired targets — rejected: new
  rule with no ratified basis and inconsistent with the direct-edge path.

### Decision: list-row field is `status` (verbatim ADR-112)

- **Rationale**: ADR-112 specifies `health` on detail and `status` on list
  rows; `status` holds the headline value (`RUNNING`|`STOPPED`|`ERROR`|
  `null`). Distinct from `lifecycle`, which stays untouched.
