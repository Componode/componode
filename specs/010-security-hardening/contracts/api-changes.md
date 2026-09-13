# API Contract Changes: Security Hardening

Endpoint behavior changes that must be reflected in `docs/openapi.yaml` and
the regenerated `docs/api.md` (ADR-104; enforced by
`test/contract/api-docs-contract.test.ts`).

## `POST /api/v1/sessions/{id}/revoke`

- **New 403**: `AUTH_FORBIDDEN` when a non-admin targets a session owned by
  another user.
- **New 404**: `NOT_FOUND` when the `publicId` does not resolve.
- 204 unchanged for own-session (any role) and any-session (ADMIN).

## `GET /api/v1/importer-configs` and `GET /api/v1/importer-configs/{id}`

- `secretRefs` items narrow from `{ key, env?, file? }` to `{ key }` —
  `env` and `file` are never returned. Response schema in openapi.yaml is
  updated accordingly.

## `POST /api/v1/auth/register`

- A self-registered user is never created with `role: ADMIN`; an effective
  `ADMIN` default is clamped to `VIEWER` (documented behavior note).

## `PATCH /api/v1/settings`

- New `400 VALIDATION_FAILED` case: payloads that would make
  `allowSelfRegistration` effective together with `defaultUserRole: ADMIN`
  are rejected.

## `GET /api/v1/auth/oidc/callback`

- Error surface unchanged in shape; `OIDC_TOKEN_VERIFICATION_FAILED` now also
  covers signature/issuer/audience/expiry/nonce failures (was: missing token
  or missing `sub` only).

## `GET /api/v1/sessions` (response)

- Unchanged shape — `tokenLast4` continues to be returned, now backed by a
  stored column.
