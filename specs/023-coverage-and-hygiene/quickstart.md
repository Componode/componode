# Quickstart: Catalog Coverage & Hygiene

Runnable validation scenarios proving the feature end-to-end. Prerequisites:
dev stack running (`pnpm dev` or the Docker Compose deploy), a session as a
user with EDITOR rights, and a catalog with a few imported components and
products. References: [contracts/api.md](./contracts/api.md),
[data-model.md](./data-model.md).

## Scenario 1 — Coverage on the dashboard (US1)

1. Seed a mixed catalog: some components wired to products, at least one
   unwired; products in mixed completeness states (one ownerless, one
   without dependencies, one without a description).
2. `GET /api/v1/dashboard/summary` → `coverage` is present.
3. Verify against manual counts:
   - `coverage.components.active` = default-visible components (`ACTIVE`,
     not instances-all-`GONE`); `wired` = those with a `DEPENDS_ON` path
     (direct or via a depended-on group) from a non-retired product;
     `wiredPct` agrees.
   - `coverage.products.*` = the three gap counts over non-retired
     products.
4. Retire every component (or use a fresh DB) → `wiredPct` returns `null`;
   the dashboard renders "—", not `0%`.
5. Retire a product that was the sole dependent of a component → the
   component flips to unwired on the next read.

## Scenario 2 — Filtered worklists (US2)

1. From the dashboard, follow the wired-coverage tile → lands on
   `/components?wired=unwired`; row count equals
   `active − wired`.
2. `GET /api/v1/components?wired=unwired` → every row has no `DEPENDS_ON`
   path; a component that is a member of a depended-on `ComponentGroup`
   (no direct edge) is absent; `RETIRED` and gone-only rows never appear —
   even with `includeRetired`/`includeGone` set.
3. `GET /api/v1/components?wired=wired` → the complement; the two lists
   partition the filtered component set.
4. `GET /api/v1/products?missing=owner` → only products with neither
   `lobOwnerId` nor `teamOwnerId`; `missing=dependencies` → only products
   with empty dependency surface; `missing=description` → blank/absent
   descriptions only.
5. `missing=owner,description` → the union (OR); combined with
   `type=PLATFORM` → the intersection across facets.
6. Copy a filtered URL into a fresh tab → identical results (filters live
   in the query string).

## Scenario 3 — Sunset-overdue attention (US3)

1. Set `sunsetAt` to yesterday on one `ACTIVE` product and one `ACTIVE`
   component; set tomorrow's date on another.
2. `GET /api/v1/dashboard/summary` → `attention` contains one
   `SUNSET_OVERDUE_PRODUCT` and one `SUNSET_OVERDUE_COMPONENT` item; the
   future-sunset entity is absent; `at` equals `sunsetAt`.
3. Retire the overdue product → its item disappears.
4. With a failed importer run or `ERROR` instance present → operational
   items still rank above the sunset items.
5. The overdue entities' `lifecycle` is unchanged — display-only.

## Scenario 4 — Completeness chip (US4)

1. `GET /api/v1/products` → each row carries `completeness
   {owner, description, dependencies}`.
2. Spot-check rows: a product with only a LOB owner → `owner: true`; a
   whitespace-only description → `description: false`; a product whose
   only edge is `DEPENDS_ON` → empty group → `dependencies: true`.
3. A product with no own edges but a wired `COMPOSES` child →
   `dependencies: true`; retire that child → `dependencies` flips false
   (if no other surface).
4. Product list rows and `GET /products/{slug}` show the same three
   booleans; the UI renders per-facet indicators — no aggregate score
   anywhere.

## Scenario 5 — Platform consumer count (US5)

1. Give a `PLATFORM` product three `CONSUMES_FROM` consumers → its
   product row shows `consumedByCount: 3`; the detail header surfaces
   "consumed by 3 products", equal to the Consumed-by section's list.
2. Remove all consumers → muted "not consumed" state.
3. A non-platform product shows no consumer figure.

## Scenario 6 — Invariants (cross-cutting)

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — full gate.
2. No `sql.raw()`/`sql.fragment()` in new code (ADR-084); query params are
   Zod-strict — `GET /components?bogus=1` → `400 VALIDATION_FAILED`.
3. All reads side-effect-free: repeat every `GET` and diff a DB dump —
   identical.
4. `docs/openapi.yaml` covers the new params/fields and the contract test
   passes (`api-docs-contract.test.ts` — ADR-104); `docs/api.md`
   regenerated via `pnpm docs:api`.
