# API Contract: Hub Docker targets

All routes are session-authenticated under `/api/v1`. All permissions are ADMIN-only.

## `GET /docker-targets`

Permission: `importer:target:read`

Response `200`: `{ "targets": DockerTarget[] }`

## `POST /docker-targets`

Permission: `importer:target:create`

Request:

```json
{
  "targetId": "prod-docker-1",
  "label": "Production Docker",
  "description": "Swarm manager",
  "profile": { "transport": "socket", "path": "/var/run/docker.sock" }
}
```

Response `201`: `{ "target": DockerTarget }`

Errors: `400 VALIDATION_FAILED`, `409 CONFLICT` for duplicate `targetId`.

## `GET /docker-targets/:id`

Permission: `importer:target:read`

Response `200`: `{ "target": DockerTarget }`  
Errors: `404 TARGET_NOT_FOUND`

## `PATCH /docker-targets/:id`

Permission: `importer:target:update`

Request supports only `{ "label"?, "description"? }`. Attempts to send `targetId`, `profile`, or route fields fail `400 VALIDATION_FAILED`.

Response `200`: `{ "target": DockerTarget }`  
Errors: `404 TARGET_NOT_FOUND`

## `POST /docker-targets/:id/enable`

Permission: `importer:target:update`

Response `200`: `{ "target": DockerTarget }`

## `POST /docker-targets/:id/disable`

Permission: `importer:target:update`

Marks the target disabled, audits the action, and requests cancellation for active Hub runs/tests using it. Returns after cancellation is requested, not after calls drain.

Response `200`: `{ "target": DockerTarget }`

## `DELETE /docker-targets/:id`

Permission: `importer:target:delete`

Response `204`.  
Errors: `404 TARGET_NOT_FOUND`, `409 TARGET_IN_USE` when any config references `targetId`.

## `POST /docker-targets/:id/test`

Permission: `importer:target:test`

Request: `{ "configId"?: uuid }`. `configId` is required when the target profile contains `*Key` references; it must identify a Hub-bound Docker config that references the target. The service resolves the config’s `STORED` credentials and calls Docker’s `/version` probe only.

Response `200`: `{ "ok": boolean, "error"?: string }`. Disabled/unknown/malformed targets return `ok:false` with a non-secret reason and are audited.

## Changed run contract

`ImportRun` responses add:

```json
"cancelReason": "USER_REQUESTED" | "TARGET_DISABLED" | null
```

No Agent wire-protocol frame changes.

## Changed error enum

- `TARGET_NOT_FOUND` — 404
- `TARGET_DISABLED` — 409
- `TARGET_IN_USE` — 409
