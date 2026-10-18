# Quickstart: Platform Product Workflow

Runnable validation for `020-platform-product-workflow`. Prerequisites:
`pnpm install` done; Postgres up via `docker compose up -d` (or a
`DATABASE_URL`); migrations applied (`pnpm db:migrate`).

```bash
pnpm dev          # backend :3001 (serves API + frontend), or run the split dev servers
```

Sign in as a user with the EDITOR role (default bootstrap admin is ADMIN).

## Scenario 1 — Detection surfaces a shared component

1. Create components `kafka-shared` and `kafka-solo` (importer-discovered or
   via the catalog; either works — promotion is a meaning-layer action).
2. Create products `Payments` and `Billing` (`BUSINESS_CAPABILITY`).
3. Wire `DEPENDS_ON` edges: Payments → kafka-shared, Billing → kafka-shared,
   Payments → kafka-solo.
4. `GET /api/v1/components/platform-candidates` → `candidates[]` contains
   `kafka-shared` with `dependerCount: 2` and both products in `dependents`;
   `kafka-solo` is absent (below threshold).
5. Open the dashboard → a **Platform candidates** section lists
   "kafka-shared — depended on by 2 products".

**Also verify**: retire `Billing` → `kafka-shared` drops off (dependerCount
falls to 1). Wire `Billing`'s dependency via a `ComponentGroup` edge instead
of a direct edge → still absent (group reach doesn't count).

## Scenario 2 — Guided promotion with consumer opt-out

1. On the dashboard card row for `kafka-shared`, click **Promote** (or open
   `/components/{id}` → **Promote to platform**).
2. Dialog pre-fills name `kafka-shared` / slug `kafka-shared`; set name to
   "Event Backbone", assign a Team owner, leave both consumers checked →
   confirm.
3. Lands on `/products/event-backbone`: type `PLATFORM`, Team owner set,
   shows `DEPENDS_ON` → kafka-shared and **Consumed by**: Payments, Billing.
4. Payments detail: kafka-shared no longer a direct dependency; "Consumes
   from" lists Event Backbone.
5. Candidates list/dashboard card: `kafka-shared` is gone (only the platform
   depends on it now).
6. Activity/audit: product `created` + per consumer `DEPENDS_ON_COMPONENT
   removed` / `CONSUMES_FROM added` + platform's `DEPENDS_ON_COMPONENT
   added`.

**Opt-out variant**: repeat with a third consumer `Checkout` unchecked →
Checkout keeps its direct `DEPENDS_ON` edge; `kafka-shared` stays a
candidate (platform + Checkout = 2 dependents).

## Scenario 3 — On-demand promotion, edge cases

1. Any component detail page (even zero dependents) shows **Promote to
   platform** for EDITOR+ → a component with no consumers produces a legal
   consumerless `PLATFORM` wired to it.
2. A `RETIRED` component's page does not offer the action; `POST` against it
   returns `409 CONFLICT`.
3. A name that collides on slug (e.g. an existing `kafka-shared` product)
   resolves to `kafka-shared-2` when slug is left auto — an explicit taken
   `slug` returns `409 SLUG_TAKEN`.
4. `consumerIds` containing a product that doesn't depend on the component →
   `400 VALIDATION_FAILED` with `details.offendingIds`; nothing is written.
5. A VIEWER can `GET` both endpoints but `POST` returns `403 AUTH_FORBIDDEN`.

## Automated coverage

```bash
pnpm --filter @componode/backend test:integration   # platform-workflow.test.ts:
                                                    # counting rules, txn,
                                                    # audit, guards, RBAC
pnpm --filter @componode/frontend test:unit         # candidates card +
                                                    # promote dialog
pnpm --filter @componode/backend docs:api:check     # openapi ↔ api.md sync
```

Expected: every scenario above is mirrored by a failing-first test written in
the same change (constitution VI).
