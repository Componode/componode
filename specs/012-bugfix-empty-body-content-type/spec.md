# Bugfix Specification: Empty-Body Requests Sent With JSON Content-Type

**Feature Branch**: `bugfix/012-empty-body-content-type`

**Created**: 2026-09-15

**Status**: Draft

**Input**: Triggering a saved GitHub importer via the Run button returned
`400 INTERNAL_ERROR` — `"Body cannot be empty when content-type is set to
'application/json'"` (Fastify `FST_ERR_CTP_EMPTY_JSON_BODY`).

## Root Cause

`apiFetch` in `packages/frontend/src/api/client.ts` unconditionally set
`Content-Type: application/json` on **every** request, including requests with
no payload. Fastify's JSON content-type parser rejects an empty body when that
header is declared — for `POST`/`PUT`/`PATCH`/`DELETE` alike.

The API contract (`docs/openapi.yaml`) defines no `requestBody` for the
affected endpoints, so the correct request carries no `Content-Type` at all.

## Affected Surface

All frontend HTTP calls funnel through `apiFetch` (verified: it is the only
`fetch` call site in `src/`). The body-less state-changing calls that were
rejected with 400:

| Hook | Endpoint | Method |
|---|---|---|
| `useTriggerImportRun` | `/importer-configs/{id}/trigger` | POST |
| `useCancelImportRun` | `/importer-configs/{configId}/runs/{runId}/cancel` | POST |
| `useLogout` | `/auth/logout` | POST |
| `useRevokeSession` | `/sessions/{id}/revoke` | POST |
| `useDeleteImporterConfig` | `/importer-configs/{id}` | DELETE |
| `useDeleteProduct` | `/products/{id}` | DELETE |
| `useDeleteEdge` | `/products/{id}/{composes,consumes-from,depends-on}/{otherId}` | DELETE |
| `useDeleteLob`, `useDeleteTeam` | `/{lobs,teams}/{id}` | DELETE |
| `useDeleteComponentGroup` | `/component-groups/{id}` | DELETE |

All corresponding OpenAPI operations declare **no** `requestBody`. Every
mutation that does send a payload matches a declared `requestBody` — the bug
is in the client, not the API.

## User Scenarios & Testing

### User Story 1 — Trigger and Manage Importer Runs

As an EDITOR, I want to click Run on a saved importer and cancel a running
import so that I can populate and control the catalog.

**Acceptance Scenarios**:

1. **Given** a saved importer config, **When** the user clicks Run, **Then**
   `POST /api/v1/importer-configs/{id}/trigger` is sent with **no**
   `Content-Type` header and returns `202` with a `runId`.
2. **Given** an in-progress run, **When** the user cancels it, **Then**
   `POST .../cancel` is sent with no `Content-Type` and returns `204`.

### User Story 2 — Session and Entity Management

As a user/admin, I want logout, session revoke, and all delete actions to work
so that state-changing UI actions are not silently broken.

**Acceptance Scenarios**:

1. **Given** an authenticated session, **When** the user logs out or revokes a
   session, **Then** the body-less POST succeeds.
2. **Given** an entity row, **When** the user deletes it, **Then** the
   body-less DELETE succeeds without a 400.
3. **Given** any mutation that sends a JSON payload, **Then** the request
   still carries `Content-Type: application/json`.

## Requirements

### Functional Requirements

- **FR-001**: `apiFetch` MUST NOT send `Content-Type: application/json` when
  `options.body` is absent.
- **FR-002**: `apiFetch` MUST still send `Content-Type: application/json`
  whenever a body is present.
- **FR-003**: CSRF header behavior is unchanged — `x-csrf-token` is still sent
  on state-changing methods when the cookie exists.
- **FR-004**: Caller-supplied headers in `options.headers` still override
  defaults.

## Success Criteria

- **SC-001**: Triggering an importer run from the UI returns `202` and the run
  appears in the runs panel.
- **SC-002**: A unit test asserts no `Content-Type` on body-less POST/DELETE
  and `application/json` on requests with a body.
- **SC-003**: `pnpm typecheck`, `pnpm lint`, and the frontend unit suite pass.

## Out of Scope (Related Finding)

- `POST /auth/oidc/login` is reached from the login page via a plain
  `<a href>` — a GET navigation to a POST-only route (would 404 when OIDC is
  enabled). Different failure mode, different fix; recorded here for a
  follow-up.

## Assumptions

- `GET`/`HEAD` requests carry no body and are unaffected by the JSON parser
  (Fastify does not parse bodies on safe methods).
- No backend change is required — Fastify's rejection is correct contract
  enforcement.
