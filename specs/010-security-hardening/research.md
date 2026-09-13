# Research: Security Hardening

Phase 0 output. Resolves the technical decisions behind `spec.md`.

## R1: OIDC ID-token verification — `openid-client` v6

**Decision**: Use the already-declared `openid-client@6.8.5` dependency for the
whole code-exchange + ID-token validation path.

**API confirmed against installed `node_modules/openid-client@6.8.5`**:

- `discovery(server: URL, clientId, metadata?, clientAuthentication?, options?)`
  → `Configuration` (fetches `/.well-known/openid-configuration`, caches server
  metadata including `jwks_uri`, `authorization_endpoint`, `token_endpoint`).
- `buildAuthorizationUrl(config, params)` → `URL` with `redirect_uri`, `scope`,
  `state`, `nonce`, `code_challenge`, `code_challenge_method`.
- `authorizationCodeGrant(config, currentUrl | Request, checks)` where
  `checks = { expectedState, expectedNonce, pkceCodeVerifier, idTokenExpected: true }`
  → performs code exchange **and** validates the ID token: signature via
  fetched JWKS, `iss`, `aud`, `exp`, `iat`, `azp`, `nonce`. Returns
  `TokenEndpointResponse & TokenEndpointResponseHelpers`; `tokens.claims()`
  returns the validated claims (throws if unvalidated/absent).
- Client auth helpers: `ClientSecretPost(secret)` (current behavior posts
  `client_secret` in the body) and `None()` for public clients.
- HTTPS-only by default; `allowInsecureRequests(config)` exists for local dev
  against non-TLS IdPs (not enabled — documented only).
- Uses global `fetch` by default → the existing test approach of mocking
  `globalThis.fetch` continues to work (mock must also serve `jwks_uri`).

**Rationale**: removes hand-rolled endpoint concatenation (latent bug: code
assumes `{issuer}/authorize` + `{issuer}/oauth/token` and ignores the
discovery document), gives spec-compliant ID-token validation for free, and
matches the foundation research decision (`specs/001-foundation/research.md`
R2) that the current implementation never honored.

**Alternatives considered**: manual `fetch` + `jose.jwtVerify` with
`createRemoteJWKSet` — rejected because it re-implements what openid-client
already does (endpoint discovery, aud/iss/exp/azp/nonce checks) and leaves the
hardcoded-endpoint bug in place.

## R2: Node.js LTS target — 24

**Decision**: Migrate runtime to Node 24 LTS (`node:24-alpine` pinned to a
patch, `engines.node >=24.0.0`, `.nvmrc` = `24`, CI `node-version-file`).

**Rationale**: Node 20 EOL 2026-04-30 (finding 8.2.6); user selected Node 24
(support ~April 2028) over Node 22 (~April 2027) for the longer runway.
`@types/node` moves to `^24`.

## R3: Session-token storage — SHA-256 hash of the token in `sessions.id`

**Decision**: Keep `sessions.id` as the text primary key but store
`hashToken(token)` (existing `crypto.ts` SHA-256 hex helper used by
`password_reset_tokens`) instead of the raw token. Add a `tokenLast4 char(4)`
column so `GET /sessions` keeps returning `tokenLast4` (no API shape change).
Migration `009_session_token_hash` adds `tokenLast4` and sets `revokedAt` on
all existing rows — forcing one re-login.

**Rationale**: avoids needing `pgcrypto`'s `digest()` to backfill hashes and is
the least invasive change to `verifySession`/`logout`/`createSession` (lookup
key becomes `hashToken(cookie)`).

**Alternatives considered**: new `tokenHash` column + UUID `id` PK — rejected
as a larger schema reshuffle (PK type change) for no security gain over
hashing `id` directly.

## R4: `trustProxy` — `TRUSTED_PROXY_IP` env var (ADR-093)

**Decision**: `trustProxy` reads `TRUSTED_PROXY_IP`; unset → `false`. Accept a
single IP, comma-separated IPs, or an integer hop count (Fastify supports
`string | string[] | number | boolean`).

**Rationale**: ADR-093 already mandates exactly this; `false` is the safe
default for direct-exposure deployments (spoofed `X-Forwarded-*` ignored).

## R5: Importer SSRF guard — shared core validation

**Decision**: New `packages/core/src/validation/url-safety.ts` exporting
`assertUrlAllowedForImport(url: string)` (or boolean variant) that requires
`http:`/`https:` and rejects `localhost`/`*.localhost`/`*.local`/`*.internal`
names and IP literals in loopback/private/link-local/reserved/CGNAT ranges
(127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10,
0.0.0.0/8, 100.64/10). Applied via `.refine()`/`superRefine` inside
`webUrlConfigSchema` and `apiUrlConfigSchema` so the check runs at config-save
time (backend runs the schema) and again at run time (importer `parse()`).

**Rationale**: importers may only import `@componode/core` (ADR-065/098), so
the guard lives in core; embedding it in the config schema covers both
validation points with one rule.

**Residual**: hostnames that resolve to private IPs at fetch time (DNS
rebinding) are not caught — documented accepted limitation; a future allowlist
or egress proxy can address it.

## R6: `SecretResolver` file allowlist — `SECRETS_DIR`

**Decision**: `file` refs are resolved as `path.resolve(SECRETS_DIR, ref)`;
the result must stay inside `SECRETS_DIR` (default `/run/secrets`). Absolute
paths are rejected outright; `..` escapes are rejected.

**Rationale**: matches the report recommendation and the container convention
(`/run/secrets`, Kubernetes/Docker secrets mount).

## R7: Self-registration + admin default — merged-state validation

**Decision**: `updateSettings` fetches the effective settings (defaults + DB +
env overrides), merges the incoming patch, and rejects the result if
`allowSelfRegistration === true && defaultUserRole === "ADMIN"` →
`400 VALIDATION_FAILED`. `POST /auth/register` additionally clamps an
effective `ADMIN` default to `VIEWER` and logs a warning (env vars can bypass
the write path). Frontend disables the `ADMIN` option while self-registration
is on.

## R8: Password minimum — set-paths only

**Decision**: `PASSWORD_MIN_LENGTH = 12` exported from `packages/core`
constants; applied to `registerSchema`, `passwordChangeSchema` (both fields),
`passwordResetConfirmSchema`, `createUserSchema`. `loginSchema.password` keeps
`.min(8)` so accounts created under the old policy can still authenticate.

**Rationale**: the report says "all schemas" but enforcing 12 on login would
lock out existing 8–11-char passwords; the policy intent (NIST/ADR-099) is a
minimum for *new* passwords. Deviation is documented in the spec (FR-007) and
ADR-099 amendment.

## R9: Database platform gate — startup preflight

**Decision**: `server.ts` runs a preflight before migrations: query
`server_version_num` (require `>= 140000`; Postgres 13 is EOL) and
`SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'` — attempt
`CREATE EXTENSION IF NOT EXISTS pgcrypto` first (the `componode` role owns the
database and may create extensions); fail fast with a clear error otherwise.
`init-db.sql` gains `\connect componode` + `CREATE EXTENSION IF NOT EXISTS
pgcrypto;`. Postgres images pinned to `postgres:16.<minor>-alpine` in
`docker-compose.yml` and the testcontainer helper.

## R10: Kysely 0.28 upgrade

**Decision**: Upgrade `kysely` `^0.27.5` → `>=0.28.17`. Watch items:
`Kysely<any>` migrations and `check-constraint-helper.ts` `sql.raw` usage
(migrations-only `sql` remains permitted under ADR-084). Any type errors
surface at `pnpm typecheck`.

## R11: `DATABASE_SSL_MODE` default — production `require`

**Decision**: default `require` when `NODE_ENV === 'production'`, `disable`
otherwise (ADR-101). `docker-compose.yml` ships an explicit
`DATABASE_SSL_MODE=disable` for the bundled no-TLS Postgres so the documented
quickstart keeps working; `docs/deployment.md` explains when to use
`require`/`verify-full`.
