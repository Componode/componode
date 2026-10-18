### ADR-110 — Product dependency may target a ComponentGroup

> **Status:** Ratified

**Context**: ADR-015 defined `DEPENDS_ON_COMPONENT` as product → concrete
`components.id`. When "the same logical thing" is discovered as N components
(e.g. one Postgres in each of three AWS accounts, unified by a
`ComponentGroup` per [ADR-082](./ADR-082-componentgroup.md)), a product needs
N edges to express one logical dependency — tedious to wire and silently
incomplete when a new member appears.

**Decision**:

1. **`DEPENDS_ON_COMPONENT` gains a group target.** A product may depend on a
   `ComponentGroup` in addition to a concrete `Component`. The edge is stored
   in a new `product_depends_on_component_group` junction
   (`productId`/`componentGroupId` composite PK + `createdAt`, mirroring the
   existing junction per ADR-048) — **persisted, not expanded at write
   time** — so group membership changes propagate automatically.

2. **Read-time expansion.** Dependency reads expand group edges to their
   member components, annotate each with "via {group name}", and deduplicate
   against direct edges — a component reachable both ways is shown once with
   both sources. No auto-merge; the redundancy is legitimate.

3. **Union API.** `POST /products/{id}/depends-on` accepts exactly one of
   `{componentId}` or `{componentGroupId}` (Zod refinement on the existing
   route, ADR-095); the DELETE route takes a target-kind discriminator.
   Audit records use `toEntityType: "component_group"` (free-text column —
   no constraint change, ADR-052).

4. **Edge cases.** An edge to an empty group is valid and expands to nothing;
   it contributes no instances to derived views. Groups cannot nest
   (schema: `componentGroupId` lives on `components`, not on
   `component_groups`), so expansion is single-hop and cycle-free by
   construction.

5. **Amends [ADR-015](./ADR-015-product-component-dependency-logical-env-agnostic.md)** —
   extends, does not replace: concrete component targets remain; the group
   is an additional legal target at the same logical, env-agnostic level.

**Consequences**: one migration, a union edge schema, expanded read paths,
group entries in the edge picker (`(group · N)` suffix), and "via {group}"
attribution on the product detail page.

**Alternatives considered**: expand-to-members at write time — rejected
(stales silently when membership changes, the common case for
discovery-driven groups); persist both the group edge *and* materialized
member edges — rejected (denormalization cost with no read benefit over
expansion).

> **AMENDMENT (2026-10-18 DPAM review grilling)**: the union input is
> extended — the route may also accept `componentIds[]` (bulk component
> targets in one request/transaction, one audit entry per edge). Still
> exactly-one-of the three forms. Ratified in the same session as
> [ADR-113](./ADR-113-staged-edge-suggestions.md); see
> `researches/digital_product_concepts_review_research.md`.
