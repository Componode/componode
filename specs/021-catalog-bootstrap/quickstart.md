# Quickstart: Catalog Bootstrap

Runnable validation for the three slices. Prereqs: stack running per
`README.md` (`docker compose up` or `pnpm dev`), signed in as an EDITOR+
user (default bootstrap admin is ADMIN), and a catalog containing at least a
few imported Components plus one LineOfBusiness and Team (create them under
Settings if empty).

The reference document for the API shapes is [contracts/api.md](contracts/api.md).

## Scenario 1 — Bootstrap import (US1)

Prepare `inventory.yaml`:

```yaml
version: 1
products:
  - name: Payments Shop
    type: CUSTOMER_FACING
    description: Storefront checkout product
    owner: { team: <a-real-team-slug>, lob: <a-real-lob-slug> }
    tags: [checkout]
    criticality: HIGH
    dependsOn: [<an-existing-component-slug>, "ghost-component"]
```

1. Products page → **Import products** → choose `inventory.yaml` → the
   dry-run preview shows `created: 1`, `edgesAdded: 1`, and a `skipped`
   entry for `ghost-component`.
2. Confirm — the product appears in the tree with fields set; its detail
   page lists the resolved component under Dependencies; the skipped ref is
   reported, not created.
3. Re-import the same file — report shows `created: 0`, `updated: 0`,
   `edgesAdded: 0` (idempotent: unchanged items write nothing, audit-free).
4. Edit the file to introduce a malformed row (bad `type`, or `version: 2`)
   — the upload is rejected with per-item errors; the catalog is unchanged.
5. Activity feed shows an entry for the product create and each edge,
   attributed to you.
6. CLI equivalent: `curl -X POST localhost:3000/api/v1/products/bootstrap
   -H 'Content-Type: application/yaml' --data-binary @inventory.yaml`
   (with session cookie + CSRF header, or via the UI flow above).

## Scenario 2 — Create product from components (US2)

1. Components page — select two ACTIVE components via the new row
   checkboxes → the selection bar offers **Create product**.
2. Fill the product form (name, type) → submit.
3. The new product's detail page shows exactly the two selected components
   as declared dependencies — one action, no picker round-trips.
4. Audit shows one product-create entry and one edge entry per component.

## Scenario 3 — Bulk dependency wiring (US3)

1. Open an existing product → add a `DEPENDS_ON` edge → the picker lists
   components with checkboxes.
2. Select three components → **Add** → all three appear as dependencies
   after one action.
3. Pick a `(group · N)` entry instead → single-target group behavior is
   unchanged; group and component selections never mix in one action.

## Test commands

```bash
pnpm --filter @componode/backend test   # incl. test/integration/product-bootstrap.test.ts
pnpm --filter @componode/core test      # bootstrapDocumentSchema unit tests
pnpm --filter @componode/frontend test  # picker multi-select + import dialog tests
pnpm docs:api                           # regenerates docs/api.md from openapi.yaml
```

Expected: all green; the OpenAPI contract test passes with the new
`/products/bootstrap` path documented.
