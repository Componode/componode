# API Contract Deltas: Edge Suggestions

Normative source of truth is `docs/openapi.yaml` (updated in the same
change, per ADR-104; `docs/api.md` is regenerated via `docs:api`). This
document lists the deltas for task authoring.

All endpoints are under `/api/v1`, authenticated (`verifySession`), and
return `{code, message, details?}` error shapes. New module:
`routes/suggestions.ts` registered in `app.ts`.

## `GET /api/v1/suggestions` — new

The review queue. Any authenticated role may read (ADR-113 §7) —
`verifySession` only, no `x-permission`.

- **Query** (Zod-strict, `listSuggestionsQuerySchema`):

| Param | Type | Default | Notes |
|---|---|---|---|
| `status` | `"PENDING" \| "DISMISSED"` | `"PENDING"` | The only two queryable states — `ACCEPTED`/`SUPERSEDED` are machinery, not a view |
| `limit` | integer | `50` | max `200` |
| `offset` | integer | `0` | offset pagination (ADR-080 low-cardinality) |

- **Response 200**:

```json
{
  "items": [
    {
      "id": "0192...",
      "productId": "0192...",
      "componentId": "0193...",
      "reason": "NAME_MATCH",
      "score": 1.05,
      "status": "PENDING",
      "createdAt": "2026-10-19T10:14:03.000Z",
      "decidedAt": null,
      "decidedBy": null,
      "decidedByName": null,
      "product":   { "id": "0192...", "name": "Payments Shop", "slug": "payments-shop" },
      "component": { "id": "0193...", "name": "payments-shop-api", "slug": "payments-shop-api", "category": "REPOSITORY" }
    }
  ],
  "total": 17
}
```

- `status=PENDING` ordering: `score DESC, createdAt ASC, id`; rows whose
  product or component is `RETIRED` are excluded (spec FR-007).
- `status=DISMISSED` ordering: `decidedAt DESC`; no lifecycle filtering.

- **Errors**:

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Bad query params / unknown keys |
| 401 | `AUTH_NO_SESSION` | Unauthenticated |

## `POST /api/v1/suggestions/{id}/accept` — new

Decides a pending candidate by wiring the real `DEPENDS_ON` edge through
`addDependsOnEdge` — no parallel write path (spec FR-010).

- **x-permission**: `product:edge:add` (EDITOR+)
- **Path param**: `id` — suggestion id (uuid)
- **Body**: none (empty JSON body allowed)
- **Response 200**: `{ suggestion }` envelope — the suggestion object,
  `status` = `ACCEPTED` (or `SUPERSEDED` if the pair was wired
  concurrently — idempotent, edge is not duplicated),
  `decidedAt`/`decidedBy` set.
- **Errors**:

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_NO_SESSION` | Unauthenticated |
| 403 | `AUTH_FORBIDDEN` | Role below EDITOR |
| 404 | `NOT_FOUND` | Suggestion id unknown |
| 404 | `NOT_FOUND` | Component (or product) no longer exists — propagated from the edge path; suggestion stays `PENDING` |
| 409 | `CONFLICT` | Suggestion not `PENDING` (already decided/superseded) |

- **Audit**: the accept produces the standard `DEPENDS_ON_COMPONENT`
  `added` edge-change row attributed to the actor; the suggestion's
  `decidedBy`/`decidedAt` records the same decision.

## `POST /api/v1/suggestions/{id}/dismiss` — new

Permanently dismisses a pending candidate — no un-dismiss (spec FR-012).

- **x-permission**: `product:edge:add` (EDITOR+)
- **Path param**: `id` — suggestion id (uuid)
- **Body**: none
- **Response 200**: `{ suggestion }` envelope — the suggestion object,
  `status` = `DISMISSED`, `decidedAt`/`decidedBy` set.
- **Errors**: same table as accept minus the component/product `404` (no
  edge write occurs).

## `POST /api/v1/suggestions/rescan` — new

Runs a whole-catalog generation pass so pre-existing or stale catalogs can
populate the queue without waiting for a scheduled import run (spec
FR-014). Synchronous — bounded by SC-002 (<1 min at 10k components).

- **x-permission**: `product:edge:add` (EDITOR+)
- **Body**: none
- **Response 200**:

```json
{
  "productsScanned": 42,
  "componentsScanned": 9813,
  "staged": 87,
  "superseded": 12
}
```

`staged` counts pairs inserted or rescored as `PENDING`; `superseded`
counts pairs tombstoned by coverage this pass. Idempotent — a second
rescan with unchanged data returns `staged: 0` (modulo rescoring of
still-pending rows).

- **Errors**:

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_NO_SESSION` | Unauthenticated |
| 403 | `AUTH_FORBIDDEN` | Role below EDITOR |

## Side effects on existing endpoints (no API change)

- `POST /products/{id}/depends-on` (all union forms), bootstrap edge
  wiring, and the create-from-components path now also upsert `SUPERSEDED`
  tombstones for the wired pairs — internal bookkeeping; response shapes
  unchanged.
- Importer run completion, product create/rename, and component
  rename/group-moves now trigger scoped generation — internal only.
