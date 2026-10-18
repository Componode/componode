# API Contract Delta: Edge-Rule Ergonomics

**No surface change** — same endpoints, bodies, and response envelopes.
The delta is *which requests stop failing*.

## `POST /api/v1/products/:id/composes` — `product:edge:add`

| Scenario | Before | After |
|---|---|---|
| parent `PLATFORM`, child any | `422 INVALID_EDGE_TYPE` (`details.rule: COMPOSES_PARENT_TYPE`) | `204` |
| parent BC/CF, child any | `204` | `204` (unchanged) |
| parentId == childId | `422 INVALID_EDGE_TYPE` (`SELF_EDGE`) | unchanged |
| edge creates cycle | `409 CYCLE_DETECTED` | unchanged |
| parent/child missing | `404 NOT_FOUND` | unchanged |
| duplicate edge | `204` (idempotent `onConflict doNothing`) | unchanged |

## `PATCH /api/v1/products/:id` — `product:update`

| Scenario | Before | After |
|---|---|---|
| type → `PLATFORM`, has `COMPOSES` children | `409 TYPE_CHANGE_BLOCKED` | `200` |
| type away from `PLATFORM`, is `CONSUMES_FROM` target | `409 TYPE_CHANGE_BLOCKED` | unchanged |

`COMPOSES_PARENT_TYPE` disappears as a possible `details.rule` value; it was
never a top-level error `code`, so the error-code contract (ADR-071) is
unchanged. `docs/openapi.yaml` needs no edits; ADR-104 contract test
verifies.
