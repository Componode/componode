# API Reference

> Generated regions below are produced from [`docs/openapi.yaml`](./openapi.yaml)
> (OpenAPI 3.0) by `pnpm --filter @componode/backend docs:api` — do not edit
> inside `<!-- GENERATED -->` markers. Route coverage is enforced by a backend
> contract test (ADR-104).

All endpoints are prefixed with `/api/v1` unless noted otherwise. The single
exception is `GET /metrics`, which is served at the root.

## Conventions

- **Authentication**: session cookie (`componode_session`, `HttpOnly`) set by
  `POST /auth/login`, `POST /auth/register`, or the OIDC callback.
- **CSRF**: mutating requests must send `X-CSRF-Token` matching the
  `componode_csrf` cookie (double-submit pattern). The token is returned in the
  login/register response body and in the `csrf` query param of the OIDC
  callback redirect.
- **Roles**: `ADMIN`, `EDITOR`, `VIEWER`. The Access column lists the RBAC
  permission enforced by the `requireRole` plugin (declared as `x-permission`
  in the OpenAPI spec); "Authenticated" means any valid session, "Public" means
  no session required.
- **Errors**: all errors are returned as
  [RFC 7807 Problem Details](https://tools.ietf.org/html/rfc7807) documents
  with `Content-Type: application/problem+json`. The standard fields `type`,
  `title`, `status`, and `detail` are always present, and the legacy
  Componode fields `code`, `message`, and `details` are preserved for
  backward compatibility. Validation failures also include an `invalid-params`
  array. Codes are a controlled enum (`ERROR_CODES` in `packages/core`).
- **Identifiers**: entity IDs are UUID v7; human-readable refs use `slug`.
- **Listing rules**: list queries exclude `RETIRED` records and `GONE`
  instances unless explicitly requested (`includeRetired`, `includeGone`).
- **GET/HEAD** routes are side-effect-free on domain state (ADR-094).
- **Rate limits**: `POST /auth/login` — 5 req/min; `POST /auth/register` —
  3 req/min. A global rate limit also applies.

## Error codes

<!-- GENERATED:error-codes -->
| Code | Meaning |
|---|---|
| `AUTH_INVALID_CREDENTIALS` | Bad username/password |
| `AUTH_RATE_LIMITED` | Too many auth attempts |
| `AUTH_NO_SESSION` | Missing/expired session (401) |
| `AUTH_FORBIDDEN` | Insufficient role (403) |
| `AUTH_USERNAME_TAKEN` | Username conflict (409) |
| `AUTH_RESET_TOKEN_INVALID` | Invalid password reset token |
| `AUTH_RESET_TOKEN_EXPIRED` | Expired password reset token |
| `AUTH_RESET_TOKEN_USED` | Password reset token already used |
| `OIDC_NOT_CONFIGURED` | OIDC is not configured (503) |
| `OIDC_INVALID_STATE` | OIDC state mismatch |
| `OIDC_INVALID_CODE` | Missing or invalid OIDC code |
| `OIDC_TOKEN_VERIFICATION_FAILED` | OIDC token verification failed |
| `OIDC_DISCOVERY_FAILED` | OIDC issuer discovery failed |
| `CSRF_TOKEN_MISMATCH` | Missing/mismatched CSRF token on a state-changing request (403) |
| `VALIDATION_FAILED` | Zod input validation failed (400) |
| `NOT_FOUND` | Resource not found (404) |
| `CONFLICT` | Generic conflict (409) |
| `CYCLE_DETECTED` | COMPOSES edge would create a cycle (409) |
| `INVALID_EDGE_TYPE` | Edge type/target constraint violated |
| `REFERENCED` | Delete blocked by existing references |
| `TYPE_CHANGE_BLOCKED` | Product type change not allowed |
| `SLUG_TAKEN` | Slug uniqueness conflict |
| `SLUG_CONFLICT` | Component-group slug already in use (409) |
| `CONFIG_NOT_FOUND` | Importer config missing at run time (surfaced via run error fields) |
| `RUN_IN_PROGRESS` | An import run is already in progress for this config (409) |
| `RUN_NOT_ACTIVE` | Run is not PENDING/RUNNING and cannot be cancelled (409) |
| `INTERNAL_ERROR` | Unhandled server error |
| `CREDENTIAL_NOT_FOUND` | Credential not found (404) |
| `CREDENTIAL_IN_USE` | Credential delete/update blocked by existing references (409) |
| `CREDENTIAL_REVOKED` | Revoked credential cannot be resolved (409) |
| `CREDENTIAL_MISSING_KEY` | Required secret key not covered by referenced credentials (400) |
| `CREDENTIAL_KEY_COLLISION` | Same secret key provided by more than one source (400) |
| `CREDENTIAL_KEY_UNAVAILABLE` | Credential store master key unavailable (503) |
| `MANIFEST_NO_TEST` | Importer does not support credential testing (400) |
| `CONVERSION_NOTHING_TO_CONVERT` | Config has no legacy env/file secret refs to convert (400) |
| `LEGACY_SECRET_UNRESOLVABLE` | Legacy env/file secret reference could not be resolved (502) |
<!-- /GENERATED:error-codes -->

---

## Auth

<!-- GENERATED:table:Auth -->
| Method | Path | Description | Access |
|---|---|---|---|
| POST | `/api/v1/auth/login` | Local username/password login | Public |
| POST | `/api/v1/auth/logout` | Revoke the current session | Public |
| POST | `/api/v1/auth/register` | Self-registration | Public |
| GET | `/api/v1/auth/session` | Get the current authenticated user | Authenticated |
| POST | `/api/v1/auth/password/change` | Change own password | Authenticated |
| POST | `/api/v1/auth/password/reset` | Generate a password reset token for a user | `password:reset:generate` |
| POST | `/api/v1/auth/password/reset/confirm` | Confirm a password reset with a token | Public |
| GET | `/api/v1/auth/oidc/status` | Check whether OIDC login is enabled | Public |
| POST | `/api/v1/auth/oidc/login` | Initiate OIDC login (redirects to the IdP, PKCE) | Public |
| GET | `/api/v1/auth/oidc/callback` | OIDC callback — exchanges code, creates session (JIT provisioning), redirects | Public |
<!-- /GENERATED:table:Auth -->

### Request bodies

- `POST /auth/login`: `{ username, password }` → `200 { user, csrfToken }`
- `POST /auth/register`: `{ username, password, displayName? }` → `201 { user, csrfToken }`
- `POST /auth/password/change`: `{ currentPassword, newPassword }` → `204`
- `POST /auth/password/reset`: `{ userId }` → `200 { token }`
- `POST /auth/password/reset/confirm`: `{ token, newPassword }` → `204`

Notes:

- `POST /auth/register` only works when `allow_self_registration` is enabled
  (returns 404 otherwise); it creates a `VIEWER` user and auto-logs in.
- `GET /auth/oidc/callback` exchanges `code`+`state`, JIT-provisions the user,
  sets cookies, and 302-redirects with `?csrf=<token>`.
- Username rules: 3–50 chars, `^[a-z0-9_-]+$`. Password: 8–128 chars.

## Users

<!-- GENERATED:table:Users -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/users` | List users | `user:list` |
| POST | `/api/v1/users` | Create a user | `user:create` |
| GET | `/api/v1/users/me` | Get the current user's profile | Authenticated |
| GET | `/api/v1/users/:id` | Get a user by ID | `user:list` |
| PATCH | `/api/v1/users/:id` | Update a user (role, display name, email, team, active flag) | `user:update` |
<!-- /GENERATED:table:Users -->

`Person` fields: `id, username, oidcSubject?, role, displayName?, email?,
teamId?, slug, isActive, createdAt, updatedAt` (`passwordHash` is never
returned).

## Sessions

<!-- GENERATED:table:Sessions -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/users/:id/sessions` | List sessions for a user | `user:listSessions` |
| GET | `/api/v1/sessions` | List the current user's sessions | Authenticated |
| POST | `/api/v1/sessions/:id/revoke` | Revoke a session by ID | Authenticated |
<!-- /GENERATED:table:Sessions -->

`Session` fields: `id` (**non-secret public identifier** — the bearer token is
never returned by the API), `tokenLast4` (last 4 chars of the token, display
only), `userId, createdAt, lastSeenAt, expiresAt, revokedAt?`.
`POST /sessions/:id/revoke` takes the public `id`.

## Settings

<!-- GENERATED:table:Settings -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/settings` | Read application settings | `settings:update` |
| PATCH | `/api/v1/settings` | Update application settings | `settings:update` |
| GET | `/api/v1/settings/oidc` | Read OIDC configuration | `oidc:configure` |
| PUT | `/api/v1/settings/oidc` | Update OIDC configuration (tests issuer discovery) | `oidc:configure` |
<!-- /GENERATED:table:Settings -->

Timeout values must be ≥ 60000 ms. `roleMapping` maps IdP claim values to
`ADMIN`/`EDITOR`/`VIEWER`. `PUT /settings/oidc` tests issuer discovery.

## Health & metrics

<!-- GENERATED:table:Health -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/health` | Health + database connectivity check | Public |
| GET | `/metrics` | Prometheus metrics | Public |
<!-- /GENERATED:table:Health -->

`GET /metrics` has **no `/api/v1` prefix** and is network-restricted in
production (Docker Compose internal network).

## Products

<!-- GENERATED:table:Products -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/products` | List products | Authenticated |
| POST | `/api/v1/products` | Create a product | `product:create` |
| GET | `/api/v1/products/:slug` | Get product detail by slug | Authenticated |
| PATCH | `/api/v1/products/:id` | Update a product | `product:update` |
| DELETE | `/api/v1/products/:id` | Delete a product | `product:delete` |
| POST | `/api/v1/products/:id/composes` | Add a COMPOSES edge (this product composes a child product) | `product:edge:add` |
| DELETE | `/api/v1/products/:id/composes/:childId` | Remove a COMPOSES edge | `product:edge:remove` |
| POST | `/api/v1/products/:id/consumes-from` | Add a CONSUMES_FROM edge (this product consumes a platform product) | `product:edge:add` |
| DELETE | `/api/v1/products/:id/consumes-from/:platformId` | Remove a CONSUMES_FROM edge | `product:edge:remove` |
| POST | `/api/v1/products/:id/depends-on` | Add a DEPENDS_ON edge (product depends on a component) | `product:edge:add` |
| DELETE | `/api/v1/products/:id/depends-on/:componentId` | Remove a DEPENDS_ON edge | `product:edge:remove` |
<!-- /GENERATED:table:Products -->

Notes:

- Product types: `BUSINESS_CAPABILITY`, `PLATFORM`, `CUSTOMER_FACING`.
  Lifecycle: `ACTIVE`, `RETIRED`.
- Create body: `{ name, type, slug?, description?, lobOwnerId?, teamOwnerId? }`
  (slug auto-derives from name). Update accepts the same fields plus
  `lifecycle`.
- `COMPOSES` forms a DAG — adding an edge that creates a cycle returns
  `409 CYCLE_DETECTED`. The parent must be `BUSINESS_CAPABILITY` or
  `CUSTOMER_FACING`.
- `CONSUMES_FROM` targets must be `PLATFORM` products (`INVALID_EDGE_TYPE`
  on violation).
- All edge mutations return `204` on success.

## Components

<!-- GENERATED:table:Components -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/components` | List components (paginated, filterable) | Authenticated |
| GET | `/api/v1/components/:id` | Get a component by ID | Authenticated |
| PATCH | `/api/v1/components/:id` | Update component group/team assignment | `component:update` |
<!-- /GENERATED:table:Components -->

Query params for `GET /components`: `page`, `pageSize` (max 100), `category`,
`provider`, `lifecycle`, `status`, `componentGroup`, `group`, `search`, `sort`
(`name`/`lastSeenAt`/`createdAt`), `order`, `includeRetired`, `includeGone`.

Components are created/updated by importers, not via the API — `PATCH` only
reassigns `{ componentGroupId?, teamOwnerId? }` (nullable).

## Component groups

<!-- GENERATED:table:ComponentGroups -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/component-groups` | List component groups | Authenticated |
| POST | `/api/v1/component-groups` | Create a component group | `componentGroup:create` |
| GET | `/api/v1/component-groups/:id` | Get a component group by ID | Authenticated |
| PATCH | `/api/v1/component-groups/:id` | Update a component group | `componentGroup:update` |
| DELETE | `/api/v1/component-groups/:id` | Delete a component group | `componentGroup:delete` |
<!-- /GENERATED:table:ComponentGroups -->

Create body: `{ name, slug, description?, teamOwnerId? }`; update accepts the
same fields plus `lifecycle`.

## Importers

<!-- GENERATED:table:Importers -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/importers` | List available importer manifests | Authenticated |
| GET | `/api/v1/importers/:name/schema` | Get an importer's config schema | Authenticated |
| GET | `/api/v1/importer-configs` | List importer configurations | Authenticated |
| POST | `/api/v1/importer-configs` | Create an importer configuration | `importer:config:create` |
| GET | `/api/v1/importer-configs/:id` | Get an importer configuration | Authenticated |
| PATCH | `/api/v1/importer-configs/:id` | Update an importer configuration | `importer:config:update` |
| DELETE | `/api/v1/importer-configs/:id` | Delete an importer configuration | `importer:config:delete` |
| POST | `/api/v1/importer-configs/:id/convert-secrets` | Convert legacy secret refs to a stored credential | `importer:config:update` |
| POST | `/api/v1/importer-configs/:id/trigger` | Trigger an import run | `importer:run:trigger` |
| GET | `/api/v1/importer-configs/:id/runs` | List runs for an importer configuration | Authenticated |
| GET | `/api/v1/importer-configs/:configId/runs/:runId` | Get an import run | Authenticated |
| GET | `/api/v1/importer-configs/:configId/runs/:runId/errors` | List errors for an import run | Authenticated |
| POST | `/api/v1/importer-configs/:configId/runs/:runId/cancel` | Cancel a running or pending import run | `importer:run:cancel` |
| GET | `/api/v1/importer-configs/:configId/runs/:runId/changes` | Import-run consequential changes | Authenticated |
<!-- /GENERATED:table:Importers -->

Notes:

- `secretRefs` items: `{ key, env?, file? }` — either `env` or `file` is
  required. Secrets are resolved from environment/files at run time and are
  never stored or logged.
- `POST /importer-configs/:id/trigger` returns `202 { runId }`.
- Run statuses: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`,
  `INTERRUPTED`. Cancelling a non-active run returns `409 RUN_NOT_ACTIVE`;
  triggering while a run is in progress returns `409 RUN_IN_PROGRESS`.

## Credentials

<!-- GENERATED:table:Credentials -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/credentials` | List credentials | `credential:read` |
| POST | `/api/v1/credentials` | Create a credential | `credential:create` |
| GET | `/api/v1/credentials/:id` | Get credential detail | `credential:read` |
| PATCH | `/api/v1/credentials/:id` | Update, rotate, or revoke a credential | `credential:update` |
| DELETE | `/api/v1/credentials/:id` | Delete a credential | `credential:delete` |
| POST | `/api/v1/credentials/:id/test` | Test a credential | `credential:update` |
<!-- /GENERATED:table:Credentials -->

Notes:

- Credential secret values are **write-only**: they are encrypted at rest
  (AES-256-GCM) and never returned by any endpoint. `keyHints` shows the
  last 4 characters of each stored key for identification.
- `POST /credentials` accepts `{ label, expiresAt?, secrets: { key: value } }`.

## Organization

<!-- GENERATED:table:Organization -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/lobs` | List lines of business | Authenticated |
| POST | `/api/v1/lobs` | Create a line of business | `lob:create` |
| PATCH | `/api/v1/lobs/:id` | Update a line of business | `lob:update` |
| DELETE | `/api/v1/lobs/:id` | Delete a line of business | `lob:delete` |
| GET | `/api/v1/teams` | List teams | Authenticated |
| POST | `/api/v1/teams` | Create a team | `team:create` |
| PATCH | `/api/v1/teams/:id` | Update a team | `team:update` |
| DELETE | `/api/v1/teams/:id` | Delete a team | `team:delete` |
| GET | `/api/v1/teams/:id/members` | List members of a team | Authenticated |
<!-- /GENERATED:table:Organization -->

`/lobs` and `/teams` share an identical CRUD shape. Body:
`{ name, slug?, description? }` (strict — unknown fields rejected). Slug
pattern: `^[a-z0-9]+(?:-[a-z0-9]+)*$`.

## Dashboard

<!-- GENERATED:table:Dashboard -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/dashboard/summary` | Dashboard summary aggregates (health & attention view) | Authenticated |
<!-- /GENERATED:table:Dashboard -->

## Search

<!-- GENERATED:table:Search -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/search` | Global search (Ctrl+K palette) | Authenticated |
<!-- /GENERATED:table:Search -->

Query params: `q` (required, ≤100 chars), `limit` (1–20, default 8).

## Audit

<!-- GENERATED:table:Audit -->
| Method | Path | Description | Access |
|---|---|---|---|
| GET | `/api/v1/audit/activity` | Global activity feed | `audit:feed` |
| GET | `/api/v1/audit/entities/:entityType/:entityId` | Per-entity history | Authenticated |
| POST | `/api/v1/audit/corrections` | Append a correction entry | `audit:correct` |
<!-- /GENERATED:table:Audit -->
