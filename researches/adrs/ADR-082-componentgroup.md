### ADR-082 — ComponentGroup (v1 inclusion)

> **Status:** Ratified

**Context**: Principle IV originally deferred human-declared component
aliasing (Case B — three distinct source assets considered one logical
component) to v1.1. The user noted Case B "happens quite often."

**Decision**: **`ComponentGroup` pulled into v1.** A first-class entity with
its own `slug`, `name`, `description`, `lifecycle` (`ACTIVE`/`RETIRED`),
`teamOwnerId`/`lobOwnerId` (ownership via the same `OWNS` FK pattern).
`components.componentGroupId` is a nullable FK. The group is NOT a graph node
— no `DEPENDS_ON` to a group; products depend on member components
individually. Sub-feature of spec 003 (component-catalog).

**Rationale**: If Case B is frequent, the cost of *not* having it (user
confusion on the main dashboard, every day) exceeds the cost of one entity +
one FK + one UI section. A first-class concept in the user's mental model
deserves a first-class entity, not an edge or a column. The group's lifecycle
is separate (a group is `ACTIVE` as long as it has ≥1 `ACTIVE` component, or
the human sets it explicitly). Ownership at the group level is distinct from
ownership of individual components.

> **AMENDMENT ([ADR-129](./ADR-129-source-scoped-auto-component-groups.md),
> ratified 2026-11-07)**: ComponentGroup gains a second provisioning mode —
> **system-provisioned, source-scoped groups**. For importers declaring the
> capability, each ImporterSource gets at most one auto-managed group linked
> by `importer_sources.componentGroupId`, whose membership is derived from
> source memberships (sole effective-active reporter), not human assignment.
> "Human-declared" remains the default origin; the lifecycle rule extends to
> auto-managed groups deriving `ACTIVE`/`RETIRED` from member activity, with
> human `lifecycle` writes rejected on them.