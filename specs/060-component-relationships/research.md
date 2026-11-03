# Research: Read-only Component Relationships

## Decision: Add a typed, read-only Relationships tab

Component detail gains a distinct Relationships tab with a deterministic
one-hop view and local `+N` expansion. It displays stored Component edges,
Products that depend directly or through a ComponentGroup, and
ComponentInstances nested under the focused Component. It does not create or
infer relationships.

**Rationale**: Component detail currently shows Component metadata and
ComponentInstances but no relationship read surface. The database has typed
Component edge tables; there are no application routes or UI for them.

**Alternatives considered**: make the entire view editable (rejected; separate
RBAC, audit, validation, and cycle decisions are required), or build a generic
graph module (rejected; Product and Component relation semantics differ).

**Ratified in**: ADR-128.

## Decision: Preserve typed relation semantics

Show `DEPENDS_ON`, `SOURCES_FROM`, and `EXPOSES` in typed incoming/outgoing
lanes. A Product's direct `DEPENDS_ON Component` is shown distinctly from a
Product dependency that reaches the Component through a ComponentGroup. The
group path is labeled “via [ComponentGroup]”; it is not a direct edge.

`HAS_INSTANCE` is one-to-many through `component_instances.componentId`.
ComponentInstances remain nested operational children, not peer Components.
The Overview Instances table remains; the Relationships tab repeats the
instances as context, per the user-selected layout.

**Evidence**: [ADR-016](../../researches/adrs/ADR-016-component-component-relationships.md),
[ADR-048](../../researches/adrs/ADR-048-graph-relationship-persistence.md),
[Component relationship tables](../../packages/backend/src/db/migrations/001_initial_schema.ts#L446-L498),
[Component detail read](../../packages/backend/src/services/component-catalog-service.ts#L231-L282),
and [Component routes](../../packages/backend/src/routes/components.ts#L19-L37).

## Decision: Read existing rows and show empty states

The read path returns typed relationship groups from the existing junction
tables, Product dependency tables, and ComponentInstance foreign key. The
Component-to-Component tables currently have no application writer, and the
v1 importer contract has no relationship output. The tab shows empty states
when those tables have no rows; it never infers relationships from names,
URLs, tags, or provider metadata.

**Alternatives considered**: add manual authoring or importer-declared
Component edges (rejected for this read-only feature; these require their own
specification and ADR decision).

## Decision: Reuse interaction patterns, not ProductMap implementation

Reuse deterministic placement, focus/selection, inspection, `+N` expansion,
keyboard behavior, state handling, and reduced-motion conventions. Keep
Component-specific relation lanes, directions, status semantics, and
ComponentInstance nesting. Do not create a generalized graph module before a
second concrete interface requires the same contract.

## Data-access recommendation

Add one authenticated, side-effect-free Component relationship read rather
than one request per node. Return each relation type in a typed group and
preserve direct versus group-mediated Product provenance. When a group of
relation rows is unavailable but others can be read, identify the unavailable
group explicitly and render the available groups; never silently omit it.

## Ratified in

- [ADR-128 — Read-only Component relationship view](../../researches/adrs/ADR-128-component-relationship-read-view.md)
- [ADR-016 — Component relationships](../../researches/adrs/ADR-016-component-component-relationships.md)
- [ADR-048 — Graph relationship persistence](../../researches/adrs/ADR-048-graph-relationship-persistence.md)
