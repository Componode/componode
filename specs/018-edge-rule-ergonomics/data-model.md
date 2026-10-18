# Data Model: Edge-Rule Ergonomics

No schema changes. This document records the *validation rule* deltas.

## `COMPOSES` (`product_composes`)

**Legal edge, after this feature**:

```text
parentId ∈ digital_products   (any type: BC | CF | PLATFORM)
childId  ∈ digital_products   (any type)
parentId ≠ childId            → else 422 INVALID_EDGE_TYPE / SELF_EDGE
no cycle                      → else 409 CYCLE_DETECTED
```

**Removed rule** (ADR-109, was ADR-018):

```text
-parent.type ∈ {BUSINESS_CAPABILITY, CUSTOMER_FACING}
+parent.type ∈ <any>
```

## `CONSUMES_FROM` (`product_consumes_from`) — unchanged

```text
platformId.type = PLATFORM    → else 422 INVALID_EDGE_TYPE / CONSUMES_FROM_TARGET_TYPE
```

## `updateProduct` type-change guard — delta

```text
 retyping TO PLATFORM:
-  block if product has COMPOSES children      ← removed (ADR-109)
 retyping AWAY from PLATFORM:
   block if product is a CONSUMES_FROM target  ← unchanged
   (409 TYPE_CHANGE_BLOCKED, details.edges names offenders)
```

## State transitions

None. `product_composes` rows already present for PLATFORM parents can only
have been created by direct insert — there is no data migration either way.
