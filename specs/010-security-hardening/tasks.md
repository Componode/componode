# Tasks: Security Hardening — Critical, High, and Medium Findings

**Input**: Design documents from `/specs/010-security-hardening/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-changes.md

**Tests**: REQUIRED — Constitution VI is non-negotiable and the bugfix workflow
requires a failing regression test before each fix.

**Organization**: Tasks grouped by user story. US2 (runtime/dependency
upgrades) is listed first among the P1 stories because every later change is
built and tested on the upgraded toolchain.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Establish a green baseline on `bugfix/010-security-hardening`: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test` (record any pre-existing failures)

---

## Phase 2: Foundational

No blocking prerequisites — all story work is on existing infrastructure.

---

## Phase 3: User Story 2 — Current Runtime and Dependencies (Priority: P1)

**Goal**: Zero high-severity `pnpm audit --prod` advisories; Node 24 LTS
everywhere (Dockerfile, engines, `.nvmrc`, CI).

**Independent Test**: `pnpm audit --prod` shows no high findings; Docker image
and CI run Node 24; SPA fallback tests still pass on `@fastify/static` v10.

- [x] T002 [US2] Bump `fastify` to `^5.12.1`, `@fastify/static` to `^10.1.2`, `kysely` to `^0.28.17` in `packages/backend/package.json`; bump `@types/node` to `^24` in root `package.json` and `packages/backend/package.json`; add `jose` to `packages/backend` devDependencies (needed by US1 tests)
- [x] T003 [US2] Run `pnpm install` to regenerate `pnpm-lock.yaml`; fix any typecheck/test fallout from `kysely` 0.28 and `@fastify/static` 10 breaking changes in `packages/backend/src/`
- [x] T004 [US2] Update `Dockerfile` base image to a pinned `node:24.x.y-alpine` patch tag (latest 24 patch at implementation time)
- [x] T005 [P] [US2] Create `.nvmrc` containing `24` and set `engines.node` to `>=24.0.0` in root `package.json`
- [x] T006 [P] [US2] Update `.github/workflows/ci.yml` `actions/setup-node` step to `node-version-file: .nvmrc` (replaces `node-version: 20`); add a `pnpm audit --prod` step after install (ADR-092)
- [x] T007 [US2] Run `pnpm audit --prod` and confirm zero high-severity advisories; bump `node-cron` if a release fixing `uuid@8.3.2` (GHSA-w5hq-g745-h8pq) exists
- [x] T008 [US2] Confirm SPA fallback and traversal safety on `@fastify/static` 10: `packages/backend/test/unit/not-found-handler.test.ts` and `test/integration/csrf.test.ts` pass; add a traversal regression case (encoded `..`, `%2e%2e`) to `not-found-handler.test.ts` if missing

---

## Phase 4: User Story 1 — OIDC Login Cannot Be Forged (Priority: P1)

**Goal**: ID tokens verified against the IdP JWKS with `iss`/`aud`/`exp`/
`iat`/`nonce` validation; endpoints from discovery document.

**Independent Test**: `oidc.test.ts` — forged/unsigned/mis-issued/expired
tokens rejected with `OIDC_TOKEN_VERIFICATION_FAILED`; properly signed token
logs in.

- [x] T009 [US1] Rewrite `packages/backend/test/integration/oidc.test.ts` to generate a real RSA keypair (`jose`: `generateKeyPair('RS256')`, `exportJWK`, `SignJWT`), serve discovery + JWKS + token endpoints from the mocked `globalThis.fetch`, and add failing regression cases: `alg:none` token, wrong `iss`, wrong `aud`, expired `exp`, bad signature, mismatched `nonce`
- [x] T010 [US1] Rewrite `packages/backend/src/services/oidc-service.ts` to use `openid-client`: `discovery(new URL(issuer), clientId, undefined, clientAuth)` (cached `Configuration`; `ClientSecretPost` when `clientSecretRef` is set, `None()` otherwise); `buildAuthorizationUrl` with `state`, `nonce`, PKCE `code_challenge`; store `nonce` in `stateStore`; in `handleCallback` call `authorizationCodeGrant(config, callbackUrl, { expectedState, expectedNonce, pkceCodeVerifier, idTokenExpected: true })` and read claims via `tokens.claims()`; map failures to `OIDC_TOKEN_VERIFICATION_FAILED` / `OIDC_INVALID_CODE` / `OIDC_INVALID_STATE`; remove `decodeJwtPayload`
- [x] T011 [US1] Update `packages/backend/src/routes/auth.ts` callback to pass the full request URL to `handleCallback` (openid-client extracts `code`/`state` from the URL or `Request`)
- [x] T012 [US1] Verify `oidc.test.ts` regression cases now pass and happy-path JIT provisioning/session creation are unchanged

---

## Phase 5: User Story 3 — Session Revocation Is Authorized (Priority: P1)

**Goal**: Non-admins revoke only their own sessions; admins revoke any;
unknown `publicId` → 404.

**Independent Test**: `sessions.test.ts` — viewer→other's session = 403, own =
204, admin→any = 204, unknown id = 404.

- [x] T013 [US3] Add failing cases to `packages/backend/test/integration/sessions.test.ts`: non-admin revoking another user's session `publicId` → `403 AUTH_FORBIDDEN`; unknown `publicId` → `404 NOT_FOUND`; admin → 204; own → 204
- [x] T014 [US3] Update `revokeSession` in `packages/backend/src/services/session-service.ts` to accept the caller `{id, role}`: look up the session by `publicId` (404 if absent), require `role === 'ADMIN'` or `session.userId === caller.id` (else 403)
- [x] T015 [US3] Pass `req.user` into `revokeSession` in `packages/backend/src/routes/sessions.ts` and map the 403/404 service errors to responses
- [x] T016 [US3] Update `docs/openapi.yaml` `/sessions/{id}/revoke` with 403/404 responses and regen `docs/api.md` via `pnpm --filter @componode/backend docs:api` (ADR-104)

---

## Phase 6: User Story 4 — Proxy Trust and Rate-Limit Integrity (Priority: P2)

**Goal**: `X-Forwarded-*` honored only from `TRUSTED_PROXY_IP`.

**Independent Test**: `rate-limit.test.ts` — spoofed `X-Forwarded-For` cannot
shift the rate-limit bucket when no trusted proxy is configured.

- [x] T017 [US4] Add a failing case to `packages/backend/test/integration/rate-limit.test.ts` (or a new `trust-proxy.test.ts`): with `TRUSTED_PROXY_IP` unset, a forged `X-Forwarded-For` does not change `req.ip` / the rate-limit key; with it set to the peer address, forwarded IPs are honored
- [x] T018 [US4] Update `packages/backend/src/app.ts`: `trustProxy` = parsed `TRUSTED_PROXY_IP` (single IP, comma-separated list → `string[]`, or integer hop count), default `false` when unset
- [x] T019 [P] [US4] Document `TRUSTED_PROXY_IP` in `.env.example` and `docs/deployment.md` (ADR-093 alignment)

---

## Phase 7: User Story 5 — Credential Policy and Session Storage (Priority: P2)

**Goal**: 12-char minimum on password set paths, dummy-hash login, hashed
session tokens at rest.

**Independent Test**: set flows reject <12 chars; login of a legacy short
password still works; non-existent-user login still invokes password verify;
`sessions.id` contains a hash, not the cookie token; sessions list still shows
`tokenLast4`.

- [x] T020 [US5] Add failing cases to `packages/backend/test/integration/auth.test.ts` and `test/integration/users.test.ts`: register/change/reset-confirm/admin-create reject passwords under 12 chars (`VALIDATION_FAILED`); login with a stored legacy 8–11-char password still succeeds; non-existent username returns `AUTH_INVALID_CREDENTIALS` after a verify pass (spy on `verifyPassword`)
- [x] T021 [US5] Add `PASSWORD_MIN_LENGTH = 12` to `packages/core/src/constants/` (new `passwords.ts` or existing constants file), export from `packages/core/src/index.ts`, and apply `.min(PASSWORD_MIN_LENGTH)` to `registerSchema`, `passwordChangeSchema` (both fields), `passwordResetConfirmSchema` in `packages/core/src/schemas/auth.ts` and `createUserSchema` in `packages/core/src/schemas/user.ts` (keep `loginSchema.password` at `.min(8)`)
- [x] T022 [US5] Add a lazily-initialized Argon2id `DUMMY_PASSWORD_HASH` to `packages/backend/src/utils/argon2.ts` and call `verifyPassword(password, DUMMY_PASSWORD_HASH)` in `packages/backend/src/services/auth-service.ts` for missing/inactive/password-less users before throwing `AUTH_INVALID_CREDENTIALS`
- [x] T023 [US5] Add failing cases to `packages/backend/test/integration/sessions.test.ts` / `migrations.test.ts`: after migration 009 `sessions.id` is a 64-char hex hash (not the cookie token), `tokenLast4` matches the token suffix, `GET /sessions` still returns `tokenLast4`, and pre-existing sessions are revoked
- [x] T024 [US5] Create `packages/backend/src/db/migrations/009_session_token_hash.ts`: add `tokenLast4 char(4)` column, backfill `right(id, 4)`, set `revokedAt = now()` on all active rows, `SET NOT NULL`; update `SessionRow` in `packages/backend/src/db/types.ts`
- [x] T025 [US5] Update `createSession` in `packages/backend/src/services/session-service.ts` to store `hashToken(token)` in `id` and `token.slice(-4)` in `tokenLast4`; update `verifySession` in `packages/backend/src/plugins/session.ts` and `logout` in `packages/backend/src/services/auth-service.ts` to look up by `hashToken(cookieToken)`; update `listUserSessions` to select `tokenLast4` instead of slicing `id`
- [x] T026 [P] [US5] Amend `researches/adrs/ADR-099-secure-password-and-credential-handling.md` (Amendment section): session tokens stored SHA-256 hashed; 12-char minimum enforced on set paths only; update `packages/frontend` password-hint copy if any mentions 8 characters

---

## Phase 8: User Story 6 — Configuration and Secret Exposure (Priority: P2)

**Goal**: prod defaults safe; no self-register-as-admin; no secret-location
disclosure; file secrets confined to `SECRETS_DIR`.

**Independent Test**: prod mode without `DATABASE_SSL_MODE` requires TLS;
settings PATCH rejects the self-reg + ADMIN combo; importer-config responses
show key-only `secretRefs`; `file` refs outside `SECRETS_DIR` fail.

- [x] T027 [US6] Add failing cases to `packages/backend/test/integration/settings.test.ts` / `settings-enforcement.test.ts`: PATCH `defaultUserRole: "ADMIN"` while `allowSelfRegistration` effective-true → `400 VALIDATION_FAILED` (and the reverse order); env-var-forced combo still yields `VIEWER` on `POST /auth/register`
- [x] T028 [US6] Update `updateSettings` in `packages/backend/src/services/settings-service.ts` to evaluate the effective merged state (defaults + stored + env overrides + patch) and reject `allowSelfRegistration && defaultUserRole === 'ADMIN'`; clamp `ADMIN`→`VIEWER` with a warning log in `POST /auth/register` in `packages/backend/src/routes/auth.ts`; disable the `ADMIN` option in `packages/frontend/src/pages/settings.tsx` when `allowSelfRegistration` is on
- [x] T029 [US6] Add a failing case to `packages/backend/test/integration/importers.test.ts`: list/get importer-config responses contain `secretRefs` items with only `key` (no `env`/`file`)
- [x] T030 [US6] Apply `maskSecretRefs` to `listImporterConfigs` and `getImporterConfig` results in `packages/backend/src/services/importer-config-service.ts` (response projection only — stored value unchanged)
- [x] T031 [US6] Add failing cases to `packages/backend/test/unit/secret-resolver.test.ts`: absolute path outside `SECRETS_DIR`, `..` escape, and a valid in-directory ref
- [x] T032 [US6] Update `packages/backend/src/utils/secret-resolver.ts`: resolve `file` refs via `path.resolve(SECRETS_DIR, ref)` (env `SECRETS_DIR`, default `/run/secrets`); reject absolute paths and resolved paths outside the directory
- [x] T033 [US6] Add a unit test for the `DATABASE_SSL_MODE` default (e.g. `packages/backend/test/unit/` or integration env-driven): `NODE_ENV=production` + unset var → `require`; non-production → `disable`
- [x] T034 [US6] Update `packages/backend/src/db/connection.ts` default to `require` when `NODE_ENV === 'production'`; set explicit `DATABASE_SSL_MODE=disable` for the bundled Postgres in `docker-compose.yml` and `.env.example` with comments; document `verify-full`/`DATABASE_SSL_CA` for remote Postgres in `docs/deployment.md`
- [x] T035 [US6] Update `docs/openapi.yaml` importer-config `secretRefs` response schemas (key-only) + `PATCH /settings` 400 case + `POST /auth/register` clamp note; regen `docs/api.md`

---

## Phase 9: User Story 7 — Importer Fetch Safety and Database Platform (Priority: P3)

**Goal**: URL importers refuse internal targets; app fails fast on unsupported
Postgres or missing `pgcrypto`.

**Independent Test**: importer config save and run reject
`http://169.254.169.254/`, `http://localhost/…`, private IP literals; startup
errors clearly on Postgres < 14 or missing `pgcrypto`.

- [x] T036 [US7] Add failing unit tests in `packages/core/test/validation/url-safety.test.ts` (new): allowed public https URL passes; `localhost`, `*.localhost`, `127.0.0.1`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x` (incl. `169.254.169.254`), `::1`, `fc00::/7`, `fe80::/10`, `0.0.0.0`, `100.64/10`, and non-http(s) schemes are rejected
- [x] T037 [US7] Create `packages/core/src/validation/url-safety.ts` exporting `isUrlAllowedForImport(url)` / `assertUrlAllowedForImport(url)` implementing those checks; export from `packages/core/src/index.ts`
- [x] T038 [US7] Apply `.superRefine` with the url-safety check to `url` in `packages/importer-web-url/src/config.ts` and `packages/importer-api-url/src/config.ts`; add regression cases to `packages/backend/test/integration/importers-other.test.ts` (config save rejected) and each importer's unit test (run refused, `validateDiscoveredAsset` still exercised)
- [x] T039 [US7] Add a failing startup-preflight test (e.g. `packages/backend/test/integration/migrations.test.ts` or a new `startup.test.ts` using testcontainers): Postgres below the minimum → clear startup error; missing `pgcrypto` → created or clear error; supported DB → proceeds
- [x] T040 [US7] Add `assertDatabasePlatform()` to `packages/backend/src/db/connection.ts` (or `server.ts`): `SHOW server_version_num` `>= 140000`, attempt `CREATE EXTENSION IF NOT EXISTS pgcrypto`, verify `pgcrypto` present — fail fast before `runMigrations()` in `packages/backend/src/server.ts`
- [x] T041 [P] [US7] Add `\connect componode` + `CREATE EXTENSION IF NOT EXISTS pgcrypto;` to `init-db.sql`; pin `postgres:16-alpine` → `postgres:16.<minor>-alpine` in `docker-compose.yml` and `packages/backend/test/helpers/testcontainers.ts`
- [x] T042 [P] [US7] Document the supported Postgres range (≥14, 16 recommended) and the `pgcrypto` requirement in `docs/deployment.md` and `docs/data-model.md`; document the URL-safety contract for URL-fetching importers in `docs/importer-development.md`

---

## Phase 10: Polish & Cross-Cutting

- [x] T043 Update `docs/deployment.md` for `TRUSTED_PROXY_IP`, `SECRETS_DIR`, `DATABASE_SSL_MODE` semantics, and the Node 24 runtime; update `.env.example` with the new variables
- [x] T044 Amend `researches/adrs/ADR-093-tls-https-for-production.md` (implementation now matches — note `TRUSTED_PROXY_IP` list/hop-count forms) and `researches/adrs/ADR-101-database-connection-security.md` (prod `require` default implemented; pgcrypto preflight); add new `ADR-106-security-hardening-2026-09-assessment.md` covering session-revocation ownership, session-token at-rest hashing, secretRefs response masking, `SECRETS_DIR` allowlist, importer URL allowlist (incl. DNS-rebinding residual), self-reg/ADMIN invariant — or split into focused ADRs if cleaner; update `researches/architecture-decisions.md` index
- [x] T045 Add a changeset (`.changeset/`) covering `@componode/backend`, `@componode/core`, `@componode/importer-web-url`, `@componode/importer-api-url` (minor — security fixes + behavior changes)
- [x] T046 Update `README.md` Roadmap — mark `010-security-hardening`; update `AGENTS.md` "Last updated" line if conventions changed
- [x] T047 Final gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm docs:build`, `pnpm audit --prod` (0 high), `pnpm --filter @componode/backend docs:api:check`; Compose smoke per `quickstart.md`

---

## Dependencies

- Phase 3 (US2 upgrades) → lands first; all later work builds/tests on Node 24 + new deps.
- Phase 4 (US1 OIDC) → independent; needs `jose` dev dep added in T002.
- Phase 5 (US3) → independent of 6–9.
- Phase 6 (US4) → independent.
- Phase 7 (US5) → T023–T025 chain; T021–T022 independent of T024.
- Phase 8 (US6) → tasks largely independent; T029/T030 pair.
- Phase 9 (US7) → T036→T037→T038 chain; T039→T040; T041/T042 parallel.
- Phase 10 → after all stories.

## Parallel Execution Examples

- US1 (T009–T012) can run entirely in parallel with US2 (T002–T008) — different files.
- Within US6: T031/T032 (secret-resolver) ∥ T029/T030 (masking) ∥ T033/T034 (SSL default).
- Within US7: T036–T038 (SSRF) ∥ T039–T041 (DB platform) ∥ T042 (docs).

## Implementation Strategy

MVP = US2 + US1 + US3 (all P1 findings: critical OIDC bypass, vulnerable
deps/EOL runtime, revocation authz). P2 stories harden credentials/config;
P3 closes importer/DB-platform gaps. Each story is independently mergeable if
the branch needs to ship incrementally.
