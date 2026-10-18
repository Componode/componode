# API Contract Deltas: Platform Product Workflow

Normative source of truth is `docs/openapi.yaml` (updated in the same
change, per ADR-104; `docs/api.md` is regenerated via `docs:api`). This
document lists the deltas for task authoring.

All endpoints are under `/api/v1`, authenticated (`verifySession`), and
return `{code, message, details?}` error shapes.

## `GET /api/v1/components/platform-candidates` — new

Static route — resolves ahead of `GET /components/{id}` (find-my-way static
precedence; pinned by an integration test).

- **x-permission**: none (any authenticated role)
- **Response 200**:

```json
{
  "candidates": [
    {
      "component": { "id": "uuid", "name": "payments-events", "slug": "payments-events", "category": "QUEUE", "provider": "AWS" },
      "dependerCount": 4,
      "dependents": [
        { "id": "uuid", "name": "Payments", "slug": "payments", "type": "BUSINESS_CAPABILITY" }
      ]
    }
  ]
}
```

Emission rule: component `ACTIVE` with `dependerCount >= 2` over distinct
non-`RETIRED` products holding a **direct** `DEPENDS_ON` edge — group
expansion excluded; `PLATFORM` dependers count. Ordered by `dependerCount`
desc, then `component.name`. Empty catalog ⇒ `{ "candidates": [] }`.

## `GET /api/v1/components/{id}/dependents` — new

- **x-permission**: none (any authenticated role)
- **Response 200**: `{ "dependents": [ { "id", "name", "slug", "type" } ] }`
  — every non-`RETIRED` product with a direct `DEPENDS_ON` edge on the
  component; ordered by name. Empty set ⇒ `[]`.
- **Errors**: `404 NOT_FOUND` when the component does not exist.

## `POST /api/v1/components/{id}/promote-to-platform` — new

- **x-permission**: `product:create` (EDITOR+; composed edge permissions are
  also EDITOR-level)
- **Request body** (strict — unknown fields rejected, ADR-095):

```json
{
  "name": "Event Backbone",            // optional; default = component name
  "slug": "event-backbone",            // optional; default = derived
  "description": "…",                  // optional
  "lobOwnerId": "uuid|null",           // optional owner prompt (ADR-017 step 3)
  "teamOwnerId": "uuid|null",
  "links": [], "tags": [],             // optional — same shape as POST /products
  "criticality": "HIGH|null",
  "sunsetAt": "iso8601|null",
  "consumerIds": ["uuid"]              // optional; absent = ALL active direct
                                       // consumers; present = that subset only
}
```

`type` is not accepted — the created product is always `PLATFORM`.

- **Response 201**:

```json
{
  "product": { "id": "uuid", "name": "Event Backbone", "slug": "event-backbone", "type": "PLATFORM", "lifecycle": "ACTIVE", … },
  "consumers": [ { "id": "uuid", "name": "Payments", "slug": "payments", "type": "BUSINESS_CAPABILITY" } ]
}
```

`consumers` = the products whose `DEPENDS_ON` edge was rewritten to
`CONSUMES_FROM` → the new platform.

- **Errors**:

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Bad body shape; or `consumerIds` contains an id that is not a current active direct consumer (`details.offendingIds`) |
| 401 | `AUTH_NO_SESSION` | Unauthenticated |
| 403 | `AUTH_FORBIDDEN` | Role below EDITOR |
| 404 | `NOT_FOUND` | Component does not exist |
| 409 | `CONFLICT` | Component `lifecycle` is `RETIRED` |
| 409 | `SLUG_TAKEN` | Explicit `slug` already in use (derived slugs auto-suffix instead) |

- **Atomicity**: product INSERT + platform `DEPENDS_ON` edge + all consumer
  rewrites + all audit rows commit in one transaction — any failure leaves
  the catalog unchanged (SC-003).
- **Audit**: entity `created` event for the platform; per consumer a
  `DEPENDS_ON_COMPONENT removed` + `CONSUMES_FROM added` pair; one
  `DEPENDS_ON_COMPONENT added` for the platform→component edge. All carry
  the acting user's actor record.

## Unchanged endpoints

`GET /dashboard/summary` is **not** extended — the dashboard card queries
`platform-candidates` directly (research.md D1). All product and edge
endpoints keep their current contracts.
