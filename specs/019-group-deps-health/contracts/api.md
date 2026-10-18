# API Contract Deltas: Group Dependencies & Product Health

Normative source of truth is `docs/openapi.yaml` (updated in the same
change, per ADR-104; `docs/api.md` is regenerated via `docs:api`). This
document lists the deltas for task authoring.

## `POST /api/v1/products/{id}/depends-on` — modified

Request body becomes an exactly-one-of union:

```json
{ "componentId": "uuid" }          // one direct edge (unchanged behavior)
{ "componentGroupId": "uuid" }     // one group edge (new)
{ "componentIds": ["uuid", …] }    // bulk direct edges (new, 1–100 items)
```

| Case | Result |
|---|---|
| `componentId` | Direct edge; audit `toEntityType: "component"` |
| `componentGroupId` | Group edge persisted (never expanded at write); audit `toEntityType: "component_group"` |
| `componentIds` | All edges in one transaction, one audit row per edge; unknown id → whole request fails `404 NOT_FOUND` (details list the misses); existing pairs idempotent |
| Zero or ≥2 forms present | `400 VALIDATION_FAILED` |
| Unknown product | `404 NOT_FOUND` |

## `DELETE /api/v1/products/{id}/depends-on/{targetId}?kind=` — modified

New optional query param `kind` enum `component|group`, default `component`
— backward compatible. `kind=component` deletes from
`product_depends_on_component`; `kind=group` deletes from
`product_depends_on_component_group`. `404 NOT_FOUND` when the (product,
target, kind) edge doesn't exist; audit entry records removal.

## `GET /api/v1/products/{slug}` — extended

- `components.declared[]` / `components.inherited[]` rows replace `via` with
  `sources: DepSource[]` — each row unique per component, carrying
  `{kind:"DIRECT"}`, `{kind:"GROUP",group:{id,name,slug}}`, and/or
  `{kind:"INHERITED",product:{id,name,slug}}` entries.
- New top-level `dependsOnGroups: [{id,name,slug,memberCount}]` — the raw
  group edges (visible even when a group is empty; drives removal).
- New `health: {status, perEnv, sourceCount} | null` — declared sources
  only; `null` renders "—".

## `GET /api/v1/products` — extended

Each product item gains `status: "RUNNING"|"STOPPED"|"ERROR"|null` — the
health headline (ADR-112). Computed in constant queries across the listed
set; respects existing filters (e.g. `RETIRED` excluded by default).

## `GET /api/v1/dashboard/summary` — extended

`attention[]` items gain kind `PRODUCT_ERROR` — products whose computed
health is `ERROR` (`href: /products/{slug}`), ordered after `FAILED_RUN`
and before instance items; `GONE`-only and null-health products excluded;
`ATTENTION_LIMIT` still applies.

## `GET /api/v1/component-groups` — extended

List items gain `memberCount: integer` (count of `components` rows carrying
the group's FK).

## `DELETE /api/v1/component-groups/{id}` — new error

Returns `409 REFERENCED` while `product_depends_on_component_group` rows
reference the group; `details.products` names the depending products.
Unchanged otherwise (`204` / `404`); retiring via `PATCH` remains allowed.
