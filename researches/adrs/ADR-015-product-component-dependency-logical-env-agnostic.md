### ADR-015 — Product→Component dependency: logical, env-agnostic

> **Status:** Ratified

**Context**: The product hierarchy depends on components. The question is
whether the dependency is on the logical component or the env-specific instance.

**Decision**: **`DigitalProduct DEPENDS_ON Component`** (logical, env-agnostic)
for v1. Per-env blast-radius (product depends on specific instance) is
documented as a Phase 4+ evolution.

**Rationale**: "Checkout depends on payments-api" is the stable,
judgment-bearing statement; "and here are payments-api's instances across
dev/staging/prod" is a navigation, not a separate dependency. Matches LeanIX
(Application → IT Component) and Backstage (Component → Resource).

> **AMENDMENT ([ADR-110](./ADR-110-product-dependency-on-component-group.md))**:
> the dependency target is extended to `ComponentGroup` — a product may depend
> on a group in addition to a concrete component, via a persisted
> `product_depends_on_component_group` edge expanded at read time. Concrete
> component targets are unchanged; the dependency stays logical and
> env-agnostic.