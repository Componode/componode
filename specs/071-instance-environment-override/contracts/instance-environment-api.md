# Contract: Instance environment override API

## `PATCH /component-instances/{instanceId}`

Set or clear a component instance's environment override.

- **Auth**: session required; role `component:update` (Editor+). Same gate as `POST /components/{id}/instances`.
- **Path param**: `instanceId` — UUID v7 of the `component_instances` row.

### Request body

```json
{ "environment": "PRODUCTION" }
```

| Field | Type | Required | Semantics |
|---|---|---|---|
| `environment` | `"DEV" \| "TEST" \| "STAGING" \| "DEMO" \| "PRODUCTION" \| "OTHER" \| null` | yes | Catalog environment value → sets override; `null` → clears override (effective returns to latest reported). Key must be present — absent key is a 400. `additionalProperties: false`. |

### Responses

**200** — override applied/cleared:

```json
{
  "instance": {
    "id": "…",
    "componentId": "…",
    "environment": "PRODUCTION",
    "reportedEnvironment": "OTHER",
    "environmentOverride": "PRODUCTION",
    "environmentOverriddenBy": "…",
    "environmentOverriddenAt": "2026-11-12T…",
    "…": "all existing ComponentInstance fields unchanged"
  }
}
```

**400** `VALIDATION_FAILED` — missing/invalid `environment`, unknown fields.
**401** `UNAUTHORIZED` — no session.
**403** `FORBIDDEN` — role lacks `component:update`.
**404** `NOT_FOUND` — instance id does not exist.

No new error codes introduced.

### Read contract (all instance payloads)

Every `ComponentInstance` emitted by the API (`GET /components/{id}` `instances[]`, `POST /components/{id}/instances`, composite `POST /components` `{instance}`, relationship instance payloads) carries:

| Field | Meaning |
|---|---|
| `environment` | **Effective** environment (`override ?? reported`) |
| `reportedEnvironment` | Importer-reported/baseline value (always present) |
| `environmentOverride` | Override value or `null` |
| `environmentOverriddenBy` / `environmentOverriddenAt` | Override provenance or `null` |

### Audit

Each successful PATCH writes `writeEntityChange` — `entityType: "component_instance"`, `action: "update"`, `changes: { environment, previousEnvironment, environmentOverride, reportedEnvironment }` — inside the same transaction.

### Importer interaction (contractual guarantee)

Import runs continue to write only the reported `environment` column. While an override is active, reported values keep refreshing underneath; the override wins until cleared. Reconciliation, GONE handling, slug, externalId, and memberships are unaffected.
