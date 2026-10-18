# Quickstart Validation: Edge-Rule Ergonomics

Prereqs: dev stack up (`docker compose up`, seeded admin), or run the
integration suite (`packages/backend/test/integration/products.test.ts`).

## 1. PLATFORM parent composes a child (US1)

```bash
# create "Identity Platform" (PLATFORM) and "SSO Service" (PLATFORM)
curl -X POST /api/v1/products -d '{"name":"Identity Platform","type":"PLATFORM"}'
curl -X POST /api/v1/products -d '{"name":"SSO Service","type":"PLATFORM"}'
curl -X POST /api/v1/products/<platformId>/composes -d '{"childId":"<ssoId>"}'
```

**Expect**: `204`. Before this feature: `422 INVALID_EDGE_TYPE`.
Both detail pages show the edge under Composes / Composed by.

## 2. Safety rails still hold (US1, FR-002/003)

```bash
curl -X POST /api/v1/products/<id>/composes -d '{"childId":"<id>"}'        # → 422 SELF_EDGE
# with A→B→C already composed:
curl -X POST /api/v1/products/<C>/composes -d '{"childId":"<A>"}'         # → 409 CYCLE_DETECTED
```

## 3. Retype to PLATFORM keeps children (US2)

```bash
# "Payments" (BUSINESS_CAPABILITY) composes "Ledger"
curl -X PATCH /api/v1/products/<paymentsId> -d '{"type":"PLATFORM"}'       # → 200, edges intact
```

## 4. CONSUMES_FROM target rule untouched (US2, FR-004)

```bash
# product X is a CONSUMES_FROM target:
curl -X PATCH /api/v1/products/<X> -d '{"type":"BUSINESS_CAPABILITY"}'     # → 409 TYPE_CHANGE_BLOCKED
```

## 5. UI flow (US1/AC4)

Open a `PLATFORM` product → Composition tab → Composes → **Add** — the
select is enabled, no "only Business Capability and Customer-Facing" notice;
any non-retired product is selectable.

## 6. Automated gate

`pnpm lint && pnpm typecheck && pnpm test && pnpm build` — including the
flipped `products.test.ts` cases and the ADR-104 api-docs contract test.
