# API Contract Deltas: Catalog Bootstrap

Normative source of truth is `docs/openapi.yaml` (updated in the same
change, per ADR-104; `docs/api.md` is regenerated via `docs:api`). This
document lists the deltas for task authoring.

All endpoints are under `/api/v1`, authenticated (`verifySession`), and
return `{code, message, details?}` error shapes.

## `POST /api/v1/products/bootstrap` — new

Static segment under `/products` — no conflict with
`GET /products/{slug}` (different method).

- **x-permission**: `product:create` (EDITOR+)
- **Query**: `dryRun` — `"true"` returns the would-be report with zero
  writes; `"false"` or absent applies normally; other values (and
  unknown query keys) are rejected `400` per ADR-095.
- **Request body**: the document itself — `application/yaml`,
  `application/x-yaml`, `text/yaml` (raw YAML text, via a registered
  content-type parser) or `application/json` (parsed object; YAML 1.2
  subsumes JSON). Strict schema — unknown fields, `version !== 1`, malformed
  items, or duplicate derived slugs reject the whole upload.

```yaml
version: 1
products:
  - name: Payments Shop            # required
    type: CUSTOMER_FACING          # required enum
    description: "Storefront"      # optional
    owner:                         # optional strict object
      lob: retail                  # LineOfBusiness slug | null clears
      team: shop-platform          # Team slug | null clears
    tags: [checkout, storefront]   # optional
    criticality: HIGH              # optional enum | null clears
    sunsetAt: null                 # optional iso8601 | null clears
    dependsOn:                     # optional — component refs
      - payments-db                # matches component slug → name → externalId
```

- **Response 200** — report identical for apply and dry run:

```json
{
  "created": 12,
  "updated": 3,
  "edgesAdded": 41,
  "skipped": [
    { "item": "payments-shop → dependsOn \"paymets-db\"", "reason": "component not found" }
  ]
}
```

- **Errors**:

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Unparseable body, schema violation, or duplicate derived slugs — `details` carries per-item zod issues (`products.N.field` paths) |
| 401 | `AUTH_NO_SESSION` | Unauthenticated |
| 403 | `AUTH_FORBIDDEN` | Role below EDITOR |
| 413 | `PAYLOAD_TOO_LARGE` | Body exceeds the 1 MB limit |

- **Apply semantics**: per-item atomic — each product item (upsert + its
  edges) commits independently; an item that fails mid-apply (e.g.
  `TYPE_CHANGE_BLOCKED`) lands in `skipped` and the apply continues.
  Upsert key is the slug derived from `name`; updates merge (present fields
  applied, omitted untouched, lifecycle never changed). `dependsOn` refs
  resolve component slug → name → `externalId`; unresolved/ambiguous refs
  are `skipped`, never fabricated. Re-running the same file is idempotent.
- **Audit**: `digital_product` `created`/`updated` per applied item +
  `DEPENDS_ON_COMPONENT` `added` per edge, attributed to the acting user,
  reason `"catalog bootstrap import"`.

## `POST /api/v1/products` — extended

Request schema gains one optional field (backward compatible):

```json
{ "name": "…", "type": "…", …, "componentIds": ["uuid", "uuid"] }
```

When present (1–100 uuids), the product is created and `DEPENDS_ON` edges to
every listed component are wired in the same transaction — product +
edges + audit commit or roll back together. Unknown ids fail the whole
request: `404 NOT_FOUND` with `details.missingIds`. Response unchanged:
`201 { product }`.

## Unchanged endpoints

- `POST /products/{id}/depends-on` — already accepts `componentIds[]`
  (ADR-110 amendment, shipped); this feature only adds the multi-select
  picker UI on top. No contract change.
- All other product/edge endpoints keep their current contracts.
