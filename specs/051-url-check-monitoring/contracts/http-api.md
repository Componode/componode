# HTTP API Contract — URL Check Monitoring (spec 051)

All routes under `/api/v1`. Error envelope `{code,message,details?}` /
problem+json per ADR-071. Permissions per `PERMISSIONS` map (R8); GET routes
use `verifySession` only. Everything is mirrored in `docs/openapi.yaml`
(ADR-104).

## Monitoring setup

### `GET /components/:componentId/monitoring-setup`
→ `200 {setup: MonitoringSetup}` | `404 MONITORING_SETUP_NOT_FOUND`

### `PUT /components/:componentId/monitoring-setup` — `monitoringSetup:update`
Body (strict): `{cadenceSeconds?, vantage?, agentId?}` — upsert semantics;
`vantage:'AGENT'` requires `agentId` of an active agent.
→ `200 {setup}` | `400 VALIDATION_FAILED` | `404 NOT_FOUND` (component)

## Checks

### `GET /components/:componentId/url-checks`
→ `200 {setup: MonitoringSetup | null, checks: UrlCheckListItem[]}` —
each item includes `latest` (last observation summary) so the table needs one
round trip.

### `POST /components/:componentId/url-checks` — `urlCheck:create`
Body (strict): `{name, url, componentInstanceId, method?, enabled?,
cadenceSeconds?, successPolicy?, availabilityTarget?, targetWindow?,
authMode?, credentialId?, authConfig?}`.
Auto-creates the setup with defaults (HUB, 300 s) if absent.
→ `201 {check}` | `400 VALIDATION_FAILED` | `404 NOT_FOUND` (component or instance)

### `GET /url-checks/:id`
→ `200 {check: UrlCheck}` (includes resolved setup cadence/vantage labels)
| `404 URL_CHECK_NOT_FOUND`

### `PATCH /url-checks/:id` — `urlCheck:update`
Partial update of any mutable field incl. `enabled` (enable/disable).
Editing `url` preserves identity/history (FR-003).
→ `200 {check}` | `400 VALIDATION_FAILED` | `404 URL_CHECK_NOT_FOUND`

### `DELETE /url-checks/:id` — `urlCheck:delete`
Removes check + observations (cascade).
→ `204` | `404 URL_CHECK_NOT_FOUND`

## Metrics and history

### `GET /url-checks/:id/metrics?window=24h|7d|30d`
→ `200 {window, availability|null, errorRate|null, coverageGap, p50|null,
p95|null, p99|null, counts:{success,failure,missed}, latest?: ObservationLite,
vantage}` | `404 URL_CHECK_NOT_FOUND` | `400 VALIDATION_FAILED`

### `GET /url-checks/:id/observations?limit=50&before=<iso>`
→ `200 {observations: UrlCheckObservation[], nextBefore: string|null}` —
desc by `scheduledAt`, cursor via `before`.

## Composite create (US5)

### `POST /components` extended
`createComponentSchema` gains optional `instance` (`{environment, url?,
version?, region?}`) and `monitoring` (`{setup?: {cadenceSeconds?, vantage?,
agentId?}, checks: CreateUrlCheckInput[]}` — ≥1 when `instance`+`monitoring`
used together). Entire graph created in one transaction; validation failure
creates nothing (US5 AS2). Permission: `component:create` + `urlCheck:create`.
→ `201 {component, instance, setup, checks}` | `400 VALIDATION_FAILED`

## New error codes

`URL_CHECK_NOT_FOUND`, `MONITORING_SETUP_NOT_FOUND` (join ERROR_CODES,
ERROR_TYPES, openapi `Problem.code` enum, `CODE_MEANINGS`). Reused:
`VALIDATION_FAILED`, `NOT_FOUND`, `AGENT_OFFLINE`, `CREDENTIAL_IN_USE`,
`FORBIDDEN`.
