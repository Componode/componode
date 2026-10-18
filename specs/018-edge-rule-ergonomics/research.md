# Research: Edge-Rule Ergonomics

## Decision: remove the `COMPOSES` parent-type check wholesale

**Rationale**: ADR-109 ratified this — the type enum is closed at three
values, children were already unrestricted, so "allow `PLATFORM` parents"
≡ "no parent check." Enforcement cost with zero modeling benefit.

**Alternatives considered** (rejected in ADR-109): PLATFORM-parents-only-
PLATFORM-children (arbitrary); excluding CUSTOMER_FACING children (same
enforcement cost, less clarity).

## Touch-point survey (all verified in code)

| Site | Current behavior | Change |
|---|---|---|
| `product-edge-service.ts:70-75` | 422 `INVALID_EDGE_TYPE`/`COMPOSES_PARENT_TYPE` when parent ∉ {BC, CF} | Delete the check; `SELF_EDGE` + `assertNoCycle` remain |
| `product-service.ts:367-383` | type→PLATFORM blocked when product has `COMPOSES` children (`409 TYPE_CHANGE_BLOCKED`) | Delete that offenders branch; keep the `CONSUMES_FROM` target branch; update doc-comment (ADR-109 note added in 017) |
| `edge-picker.tsx:63-64, 89-94` | `canBeParent` gates the composes select + shows "only BC/CF" notice | Remove both; picker works for all types |
| `products.test.ts:253` | asserts PLATFORM parent → 422 | Flip: PLATFORM parent → success; keep cycle case |
| `docs/digital-products.md:39-56` | "parent must be BUSINESS_CAPABILITY or CUSTOMER_FACING" + gating subgraph | Update rule text + diagram |
| `AGENTS.md` | "COMPOSES parent must be BUSINESS_CAPABILITY or CUSTOMER_FACING" | Update to any-type + cite ADR-109 |

## Non-touch-points (verified unchanged)

- `edge-picker.tsx` *target* filter for `consumes-from` (`PLATFORM` targets
  only) — stays; it's the target rule, not the parent rule.
- `product-detail.tsx` "Consumed by" section gated on `type === "PLATFORM"` —
  stays; it renders existing edges, not permissions.
- Error enum: `INVALID_EDGE_TYPE` still used for `SELF_EDGE` and
  `CONSUMES_FROM_TARGET_TYPE`; `COMPOSES_PARENT_TYPE` was a `details.rule`
  string, not an API-level `code` — no contract breaking change for clients
  (they never relied on it succeeding).
- OpenAPI: no schema or endpoint change; `docs/api.md` route table
  unaffected. ADR-104 contract test should pass unchanged — verify at gate.
