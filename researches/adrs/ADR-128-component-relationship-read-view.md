# ADR-128 — Read-only Component relationship view

> **Status:** Ratified (2026-11-03)
> **Amends:** ADR-103 (`docs/ux.md`)
> **Spec:** `specs/060-component-relationships`

## Context

Component detail currently exposes Component metadata, ComponentInstances, and
URL Checks, but has no read surface for the typed relationships in ADR-016 or
for DigitalProducts that depend on a Component. The relationship tables exist
under ADR-048, but no application read/write route or UI exposes the
Component-to-Component relationships. A product-centered graph cannot be
reused unchanged: the relation types are asymmetric and many-to-many, and a
ComponentInstance is an owned operational child rather than a peer Component.

## Decision

1. **Read-only Relationships tab.** Component detail gains a distinct
   Relationships tab. It presents a deterministic one-hop view with `+N`
   progressive disclosure. It has no relation editing, drag, manual layout,
   pan, or zoom.

2. **Typed relation lanes.** The view presents:
   - `DEPENDS_ON` Components in both directions;
   - `SOURCES_FROM` repositories and Components that source from this
     Component;
   - `EXPOSES` API Components and Components that expose this Component;
   - DigitalProducts with direct `DEPENDS_ON` edges to this Component; and
   - Products that reach this Component through a ComponentGroup, explicitly
     attributed as “via [ComponentGroup]”.

   ComponentGroups are provenance for a Product dependency, not peer
   Components. Direct and group-mediated paths remain distinct.

3. **ComponentInstances remain nested.** The tab presents ComponentInstances
   as children of the focused Component, with environment and operational
   status. `GONE` instances remain excluded by default unless the caller
   explicitly requests them. Instance status and URL Check observations are
   displayed according to ADR-126; URL Check history is not rendered as a
   Component relationship. The existing Overview Instances table remains;
   showing the instances in both surfaces is intentional.

4. **Typed read contract.** The backend exposes the relationship groups from
   the existing typed junction tables, product dependency tables, and
   ComponentInstance foreign key. The response preserves relation direction
   and direct-versus-group provenance. It does not introduce a polymorphic
   persistence table or a generic graph contract that erases relation types.

5. **No automatic relationship creation.** The view displays relations
   already present in the catalog. It does not infer or create
   `DEPENDS_ON`, `SOURCES_FROM`, or `EXPOSES` edges. If no Component edge data
   exists, the corresponding lanes show an honest empty state. A future
   authoring or ingestion capability needs its own decision and specification.

6. **Reuse of UX patterns, not a generic graph module.** The view reuses the
   Product Map's accessible focus, selection, inspection, overflow, and
   responsive patterns. It keeps Component-specific direction, node data,
   operational state, and typed relation lanes. A shared graph module is
   deferred until a second concrete implementation demonstrates a stable seam.

## Amendments to earlier ADRs

- **ADR-103** — `docs/ux.md` adds a read-only Component Relationships tab
  with typed one-hop relation lanes and nested ComponentInstances.

## Consequences

- The Component detail read path gains a typed, bounded relationship read
  interface. It remains authenticated and side-effect-free.
- ComponentInstances appear in both the existing Overview table and as
  nested children in Relationships; this duplication is the confirmed
  navigation choice.
- `docs/openapi.yaml`, generated `docs/api.md`, backend contract tests, and
  frontend mappers/types must cover the relationship response.
- Frontend work uses a gap-registry entry and matching flag until the new read
  capability is available; fallback states do not invent relationships.
- The view follows `docs/ux.md` WCAG 2.1 AA, status-token, loading/error/empty,
  reduced-motion, and responsive rules.

## Alternatives considered

- **Reuse the ProductMap module as a universal graph** — rejected; Product and
  Component relation types, directions, health, and ownership differ.
- **Show ComponentInstances as peer graph nodes** — rejected; `HAS_INSTANCE`
  is one-to-many and instance state is operational, not a Component
  relationship.
- **Add Component relationship authoring to this view** — rejected; it would
  require separate RBAC, audit, validation, and cycle-policy decisions.
- **Infer Component edges from names or imported metadata** — rejected; the
  catalog must display stored relationships, not fabricate them.

---

**Amended by ADR-128**: `docs/ux.md` adds a read-only Component Relationships
tab with typed, one-hop relations and nested ComponentInstances.
