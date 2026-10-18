### ADR-018 — Product types: enum with enforced composition rules

> **Status:** Ratified

**Context**: The Composable Product Model defines product roles (business
capability, platform, customer-facing).

**Decision**: **`DigitalProduct.type` enum: `BUSINESS_CAPABILITY` | `PLATFORM`
| `CUSTOMER_FACING`.** Composition rules enforced:
- `COMPOSES` parent ∈ {BUSINESS_CAPABILITY, CUSTOMER_FACING}
- `CONSUMES_FROM` target = PLATFORM

**Rationale**: The Platform Product workflow ([ADR-017](./ADR-017-platform-product-workflow-full-guided-workflow-in-v1.md)) requires a `PLATFORM`
type to exist. `CONSUMES_FROM`'s semantic ("business product consumes shared
platform product") only holds if the target is typed `PLATFORM`. Without the
type, `CONSUMES_FROM` collapses into a synonym for `COMPOSES`.

> **CORRECTION (Session 2, [ADR-049](./ADR-049-composes-hierarchy-dag-with-unlimited-depth.md))**: The original "Relationship Type Set"
> table listed `COMPOSES` cardinality as "Child has one parent; parent has many
> children" (tree). This was incorrect. `COMPOSES` is a **DAG** — a child can
> have many parents (a shared platform product composed into multiple business
> capabilities). See [ADR-049](./ADR-049-composes-hierarchy-dag-with-unlimited-depth.md) for the full rationale and the cycle-detection
> strategy ([ADR-050](./ADR-050-composes-cycle-detection-implementation.md)). The relationship table in the ADR index has been corrected.

> **AMENDMENT ([ADR-109](./ADR-109-composes-parent-restriction-removed.md))**: The
> rule `COMPOSES parent ∈ {BUSINESS_CAPABILITY, CUSTOMER_FACING}` is removed —
> any product type may be a `COMPOSES` parent (platforms have parts; children
> were already unrestricted). Cycle detection and the `CONSUMES_FROM` target
> rule are unchanged.