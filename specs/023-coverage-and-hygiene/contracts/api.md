# API Contract Deltas: Catalog Coverage & Hygiene

Normative source of truth is `docs/openapi.yaml` (updated in the same
change, per ADR-104; `docs/api.md` is regenerated via `docs:api`). This
document lists the deltas for task authoring.

All endpoints are under `/api/v1`, authenticated (`verifySession` only —
read-only derivations, no `x-permission` beyond session), side-effect-free
`GET`s (ADR-094), returning `{code, message, details?}` error shapes.
**No new endpoints; no writes.**

## `GET /api/v1/dashboard/summary` — extended

- **Response 200** — adds `coverage`:

```json
{
  "counts": { "...": "unchanged" },
  "lastImportAt": "…",
  "attention": [ "…" ],
  "lastRuns": [ "…" ],
  "coverage": {
    "components": { "active": 1112, "wired": 812, "wiredPct": 73.0 },
    "products": {
      "total": 42,
      "missingOwner": 4,
      "missingDependencies": 9,
      "missingDescription": 11
    }
  }
}
```

- `coverage.components.wiredPct` is `null` when `active` is 0 (renders
  "—", never `0%`). Percentage precision: one decimal is sufficient.
- `AttentionItem.kind` enum gains `SUNSET_OVERDUE_PRODUCT` and
  `SUNSET_OVERDUE_COMPONENT`. Sunset items appear **after** all
  operational kinds within the existing 20-item cap; `at` is the entity's
  `sunsetAt`; `href` is `/products/{slug}` or `/components/{id}`.
- **Errors**: unchanged (`401 AUTH_NO_SESSION`).

## `GET /api/v1/components` — extended

- **Query** (`listComponentsQuerySchema`) — adds:

| Param | Type | Default | Notes |
|---|---|---|---|
| `wired` | CSV of `"wired" \| "unwired"` | — | Facet-style multi-value, OR within the facet. `unwired` = default-visible components (`ACTIVE`, not instances-all-`GONE`) with no `DEPENDS_ON` path (direct or group-expanded) from a non-retired product. Both values apply the population predicate — `includeRetired`/`includeGone` never surface out-of-population rows. Count matches `coverage.components` for the same catalog state |

- **Response 200**: unchanged (`{data, pagination}`).
- **Errors**: unchanged (`400 VALIDATION_FAILED` on unknown keys,
  `401 AUTH_NO_SESSION`).

## `GET /api/v1/products` — extended

- **Query** (`listProductsQuerySchema`) — adds:

| Param | Type | Default | Notes |
|---|---|---|---|
| `missing` | CSV of `"owner" \| "dependencies" \| "description"` | — | Facet-style multi-value, OR within the facet; composable with `type`, `tag`, `criticality`, `q`, `lifecycle`/`includeRetired` |

- **Response 200** — each `products[]` row gains:

```json
{
  "completeness": { "owner": true, "description": false, "dependencies": true },
  "consumedByCount": 3
}
```

- `completeness.dependencies` = dependency surface non-empty (own
  `DEPENDS_ON` incl. group targets, own `CONSUMES_FROM`, or a non-retired
  `COMPOSES` descendant's `DEPENDS_ON` — see `data-model.md`).
- `consumedByCount` = `CONSUMES_FROM` in-degree; `0` for non-platforms.
- **Errors**: unchanged.

## `GET /api/v1/products/{slug}` — extended

- **Response 200** — adds `completeness` (same shape as above). The
  consumer count stays `consumedBy.length` — the detail payload already
  carries the array.

## Side effects on existing endpoints

None — all changes are additive response fields or new optional query
params; every derivation is recomputed per read.
