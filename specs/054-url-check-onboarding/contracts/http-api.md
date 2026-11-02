# API Contract: URL Check Onboarding Completion

## `POST /api/v1/components/:id/instances`

Creates the first manual `ComponentInstance` for an existing ACTIVE Component.

### Authorization

- Session required.
- `x-permission`: `component:update` (EDITOR).

### Path

- `id`: UUID of an existing Component.

### Request

Uses the existing `createInstanceBlockSchema`, strict mode:

```json
{
  "environment": "PRODUCTION",
  "url": "https://example.com",
  "version": "1.0.0",
  "region": "us-east-1"
}
```

- `environment` is required and must be one of `DEV`, `TEST`, `STAGING`, `DEMO`, `PRODUCTION`, `OTHER`.
- `url`, `version`, and `region` are optional.
- Unknown fields are rejected.

### Responses

`201 Created`

```json
{
  "instance": {
    "id": "<uuid>",
    "componentId": "<uuid>",
    "environment": "PRODUCTION",
    "status": "RUNNING",
    "externalId": "manual:<component-slug>",
    "slug": "<unique-slug>"
  }
}
```

`400 VALIDATION_FAILED`: malformed UUID or invalid request body.

`401 AUTH_NO_SESSION`: unauthenticated.

`403 AUTH_FORBIDDEN`: caller lacks `component:update`.

`404 NOT_FOUND`: Component is missing or unavailable for this path (`RETIRED`).

`409 CONFLICT`: Component already has a `ComponentInstance` or the manual identity collides.

### Semantics

- Creates exactly one `ComponentInstance` and one `component_instance` `created` audit event inside a transaction.
- Server sets `status=RUNNING`, `externalId=manual:<component-slug>`, and a unique slug.
- It never creates or mutates the parent Component and never creates a URL Check; the normal check editor owns the next step.

## Existing monitoring writes: role-sensitive fields

These rules apply to `POST /components` composite monitoring, `POST /components/:componentId/url-checks`, `PATCH /url-checks/:id`, and `PUT /components/:componentId/monitoring-setup`:

- Selecting or changing credential-bearing authentication (`credentialId`, `authMode`, or `authConfig`) requires `credential:read` (ADMIN); resubmitting unchanged values does not.
- Switching to `vantage: "AGENT"` or changing `agentId` requires `agent:read` (ADMIN); preserving an existing Agent vantage while changing unrelated fields does not.
- Removing a Credential or switching away from Agent vantage does not itself require the selector read.
- Violations return `403 AUTH_FORBIDDEN` and change no domain state.
