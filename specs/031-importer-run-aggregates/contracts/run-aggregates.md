# Contract: `GET /api/v1/importer-configs/:id/run-aggregates`

Per-day run aggregates for one importer config, windowed by `days`.

**Auth**: `verifySession` (any role — same posture as sibling run routes).

## Query

| Param | Type | Default | Bounds |
|---|---|---|---|
| `days` | int | `14` | clamped to `1–90` |

## Response `200`

```json
{ "days": [
  { "day": "2026-10-23", "runs": 3, "created": 40, "updated": 5, "failed": 1 }
] }
```

- `day`: ISO `YYYY-MM-DD` (UTC day of `createdAt`).
- `runs`: runs started that day (all statuses).
- `created` / `updated`: sums of `assetsCreated` / `assetsUpdated`.
- `failed`: runs with status `FAILED`.
- Series is complete — every day in the window appears, ascending.
- `401 AUTH_NO_SESSION` unauthenticated; empty series for unknown ids.
