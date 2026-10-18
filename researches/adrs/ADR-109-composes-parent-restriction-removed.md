### ADR-109 — COMPOSES parent-type restriction removed

> **Status:** Ratified

**Context**: ADR-018 restricted `COMPOSES` parents to
`BUSINESS_CAPABILITY` and `CUSTOMER_FACING` — the `PLATFORM` type was created
for `CONSUMES_FROM`, not composition. In practice, real platforms have parts
("Identity Platform" composes "SSO Service" and "MFA Service"), and users
modelling them hit the restriction. Since `COMPOSES` children were *already*
unrestricted and the product type enum is closed at three values, "allow
`PLATFORM` as a parent" is equivalent to removing the parent-type check
entirely.

**Decision**:

1. **Any `DigitalProduct` type may be a `COMPOSES` parent.** The backend
   parent-type check is removed; `COMPOSES` is a fully general DAG guarded
   only by self-edge rejection and cycle detection
   ([ADR-049](./ADR-049-composes-hierarchy-dag-with-unlimited-depth.md),
   [ADR-050](./ADR-050-composes-cycle-detection-implementation.md)), both
   unchanged.

2. **`CONSUMES_FROM` remains the canonical "uses a platform" edge.** A
   product consuming shared platform machinery is still `CONSUMES_FROM`
   (target must be `PLATFORM`); `COMPOSES` means "is a part of." That a
   `PLATFORM` could now legally compose a `CUSTOMER_FACING` product is an
   accepted permissiveness, not a modeling recommendation.

3. **Amends [ADR-018](./ADR-018-product-types-enum-with-enforced-composition-rules.md)** —
   the rule `COMPOSES parent ∈ {BUSINESS_CAPABILITY, CUSTOMER_FACING}` is
   superseded. The type enum and the `CONSUMES_FROM` target rule are
   unchanged.

**Consequences**: `addComposesEdge` drops the `COMPOSES_PARENT_TYPE`
validation; the UI no longer gates the "Composes" action by parent type;
`CONTEXT.md` glossary and `docs/digital-products.md` rules are updated when
the change ships.

**Alternatives considered**: `PLATFORM` parents restricted to `PLATFORM`
children — rejected (arbitrary; a platform's part may be a business
capability). `PLATFORM` parents excluded `CUSTOMER_FACING` children —
rejected (partial restriction with the same enforcement cost and less
clarity than "any parent, no cycles").
