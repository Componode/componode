# Bugfix Specification: Security Hardening — Critical, High, and Medium Findings

**Feature Branch**: `bugfix/010-security-hardening`

**Created**: 2026-09-13

**Status**: Implemented

**Input**: Remediate all critical, high, and medium findings of the 2026-09-10
security assessment (`docs/security/2026-09-10-security-assessment.md`,
§8.1–8.3). Low findings (§8.4) are explicitly out of scope and tracked as
follow-up candidates.

## Problem and Root Causes

The 2026-09-10 security assessment found 16 exploitable or policy-violating
issues across authentication, authorization, dependency hygiene, runtime
currency, secret handling, and deployment defaults:

- **Critical**: the OIDC callback trusts the ID token payload after base64
  decoding without signature, issuer, audience, or expiry verification
  (complete auth bypass when OIDC is enabled).
- **High**: `trustProxy: true` lets clients spoof `X-Forwarded-*` and bypass
  IP-keyed rate limits; `@fastify/static@8.3.0`, `kysely@0.27.6`, and
  transitive `fast-uri` carry known high-severity advisories; the runtime is
  Node.js 20 which is end-of-life; any authenticated user can revoke any
  session by `publicId`.
- **Medium**: `DATABASE_SSL_MODE` defaults to `disable` in production;
  `allowSelfRegistration` can be combined with `defaultUserRole: ADMIN`;
  importer-config list/get responses expose `secretRefs` env names and file
  paths; `SecretResolver` accepts arbitrary file paths; `web-url`/`api-url`
  importers can fetch internal endpoints (SSRF); password minimum is 8 not 12;
  login timing reveals valid usernames; session tokens are stored plaintext at
  rest; the Postgres platform version and `pgcrypto` extension are not
  validated at startup.

## User Scenarios & Testing

### User Story 1 — OIDC Login Cannot Be Forged (Priority: P1)

As a deployer using OIDC, I need the callback to accept only ID tokens that are
cryptographically signed by my configured identity provider, so that an attacker
cannot fabricate a token and gain a session or an arbitrary role.

**Why this priority**: The one Critical finding — complete
authentication/authorization bypass whenever OIDC is enabled.

**Independent Test**: Send a hand-crafted unsigned/self-signed JWT through the
OIDC callback (with a valid state) and confirm it is rejected; confirm a token
with wrong issuer, wrong audience, expired `exp`, or bad signature is rejected;
confirm a correctly signed token from the configured IdP still logs the user
in.

**Acceptance Scenarios**:

1. **Given** OIDC is enabled, **When** the token endpoint returns an unsigned
   or self-signed `id_token`, **Then** the callback rejects it with
   `OIDC_TOKEN_VERIFICATION_FAILED` and no session or user is created.
2. **Given** OIDC is enabled, **When** the `id_token` has an `iss` different
   from the configured issuer, an `aud` not containing the configured client
   ID, or an `exp` in the past, **Then** the callback rejects it with
   `OIDC_TOKEN_VERIFICATION_FAILED`.
3. **Given** OIDC is enabled, **When** the full authorization-code flow returns
   a properly signed token with matching `iss`/`aud`/`nonce`, **Then** the
   existing JIT-provisioning and session-creation behavior is unchanged.
4. **Given** the IdP publishes non-standard endpoint paths in its discovery
   document, **When** login is initiated, **Then** the authorize and token
   endpoints advertised by discovery are used.

---

### User Story 2 — Current Runtime and Dependencies (Priority: P1)

As a deployer, I need the application to run on a supported runtime with no
known high-severity dependency vulnerabilities, so that production deployments
are not exposed to published exploits.

**Why this priority**: Five High findings collapse into dependency/runtime
hygiene — Node.js 20 is EOL, and Fastify, `@fastify/static`, `kysely`, and
`fast-uri` carry published advisories.

**Independent Test**: The production image and CI run on a supported Node.js
LTS line, and `pnpm audit --prod` reports zero high-severity advisories.

**Acceptance Scenarios**:

1. **Given** the repository, **When** `pnpm audit --prod` runs, **Then** it
   reports no high-severity advisories for production dependencies.
2. **Given** the Dockerfile, **When** the image is built, **Then** the base
   image is a pinned Node.js 24 LTS patch release, and `package.json`
   `engines`, `.nvmrc`, and CI all agree on the Node major.
3. **Given** the upgraded static-assets plugin, **When** a browser requests an
   SPA route or a path-traversal URL (e.g. `..`, encoded separators),
   **Then** SPA routes still return `index.html` and traversal attempts cannot
   escape the frontend dist directory.

---

### User Story 3 — Session Revocation Is Authorized (Priority: P1)

As a user, I need to be able to revoke only my own sessions, while admins can
revoke any user's sessions, so that a low-privilege account cannot log other
users out.

**Why this priority**: A High finding — any authenticated user can currently
deny service to any other user.

**Independent Test**: A Viewer revoking another user's session `publicId`
receives 403; revoking their own succeeds; an Admin revoking anyone's succeeds.

**Acceptance Scenarios**:

1. **Given** two authenticated users, **When** a non-admin revokes a session
   `publicId` belonging to the other user, **Then** the response is
   `403 AUTH_FORBIDDEN` and the target session remains active.
2. **Given** an authenticated user, **When** they revoke one of their own
   sessions, **Then** the response is 204 and that session is revoked.
3. **Given** an admin, **When** they revoke any user's session, **Then** the
   response is 204 and the session is revoked.
4. **Given** a `publicId` that does not exist, **When** revocation is
   attempted, **Then** the response is `404 NOT_FOUND`.

---

### User Story 4 — Proxy Trust and Rate-Limit Integrity (Priority: P2)

As a deployer, I need the backend to trust forwarded headers only from my
declared reverse proxy, so that clients cannot spoof their IP to evade rate
limits or poison logs.

**Why this priority**: High finding; required so login/registration rate
limits actually bind to real client IPs behind a proxy.

**Independent Test**: With no trusted proxy configured, an attacker-set
`X-Forwarded-For` does not change the rate-limit key or the logged client IP;
with `TRUSTED_PROXY_IP` set to the proxy address, forwarded headers are honored.

**Acceptance Scenarios**:

1. **Given** `TRUSTED_PROXY_IP` is unset, **When** a request arrives with a
   forged `X-Forwarded-For`, **Then** the effective client IP is the direct
   connection IP and per-IP rate limits cannot be bypassed by header spoofing.
2. **Given** `TRUSTED_PROXY_IP` is configured to the proxy's address,
   **When** the proxy forwards `X-Forwarded-For`, **Then** the application sees
   the real client IP.

---

### User Story 5 — Credential Policy and Session Storage (Priority: P2)

As a deployer, I need passwords to meet the documented 12-character minimum,
login to not reveal whether a username exists, and session tokens to be stored
hashed, so that credential compromise and enumeration risks match the security
policy.

**Why this priority**: Three Medium findings under the credential-handling ADR.

**Independent Test**: Registration/change/reset reject passwords under 12
characters; a login for a non-existent user takes the same code path through
password verification as an existing user; the sessions table contains no
usable bearer token.

**Acceptance Scenarios**:

1. **Given** any password-setting flow (self-registration, password change,
   password reset confirm, admin user creation), **When** a password under 12
   characters is submitted, **Then** it is rejected with `VALIDATION_FAILED`.
2. **Given** an existing account created with a shorter password before the
   policy change, **When** the user logs in with the correct password,
   **Then** login still succeeds (minimum length is enforced on set, not on
   verify).
3. **Given** a login attempt for a username that does not exist, **When** the
   response is returned, **Then** the same `AUTH_INVALID_CREDENTIALS` error is
   returned after a password-verification pass (no observable timing shortcut).
4. **Given** the sessions table, **When** a row is inspected, **Then** the
   stored value is a one-way hash — the bearer token presented by the client
   cannot be read from the database, while `tokenLast4` still lets users
   identify their sessions.
5. **Given** sessions existed before this change, **When** the migration runs,
   **Then** pre-existing sessions are revoked (users log in once more) rather
   than left as plaintext credentials.

---

### User Story 6 — Configuration and Secret Exposure (Priority: P2)

As an admin, I need production defaults to be safe — encrypted DB connections,
no path to self-register as admin, no exposure of where secrets live, and
file-based secrets confined to a designated directory — so that a
misconfiguration or a low-privilege viewer cannot escalate or map the
infrastructure.

**Why this priority**: Four Medium findings that share the
"unsafe-by-default / information disclosure" theme.

**Independent Test**: Production mode without `DATABASE_SSL_MODE` requires TLS
to the database; the settings API rejects the self-registration + admin-default
combination; importer-config responses contain only secret-ref keys; a
`file` secret ref outside the allowed directory is rejected.

**Acceptance Scenarios**:

1. **Given** `NODE_ENV=production` and `DATABASE_SSL_MODE` unset, **When** the
   app connects to Postgres, **Then** TLS is required; in non-production the
   default remains `disable`.
2. **Given** `allowSelfRegistration` is enabled (stored or via env), **When**
   an admin PATCHes `defaultUserRole: "ADMIN"`, **Then** the request is
   rejected with `VALIDATION_FAILED`; the same rejection applies when enabling
   self-registration while the effective default role is already `ADMIN`.
3. **Given** the self-registration + admin-default combination is somehow
   effective (e.g. via environment variables), **When** a user self-registers,
   **Then** the created account receives `VIEWER`, not `ADMIN`, and a warning
   is logged.
4. **Given** an importer config with `secretRefs`, **When** a non-admin calls
   the list or get endpoint, **Then** each ref exposes only its `key` — never
   the env variable name or file path.
5. **Given** a `file` secret ref, **When** the resolved path escapes the
   designated secrets directory (absolute path outside it or `..` traversal),
   **Then** resolution fails with an error.

---

### User Story 7 — Importer Fetch Safety and Database Platform (Priority: P3)

As a deployer, I need URL-based importers to refuse internal/metadata targets
and the app to refuse to boot against an unsupported or `pgcrypto`-less
Postgres, so that a compromised admin session cannot pivot into the internal
network and migrations cannot fail halfway on an unsupported database.

**Why this priority**: Medium findings; important but lower exploitability
than the auth surface (importer configs are admin-only).

**Independent Test**: An importer config whose URL targets a private IP,
localhost, or the cloud metadata address fails validation; the app refuses to
start against Postgres below the supported minimum or without `pgcrypto`.

**Acceptance Scenarios**:

1. **Given** a `web-url` or `api-url` importer config, **When** its URL uses a
   non-http(s) scheme, `localhost`, a private/loopback/link-local/reserved IP
   literal (including `169.254.169.254`), **Then** config validation fails at
   save time and the importer refuses to run it.
2. **Given** the app starts against Postgres older than the documented
   supported minimum, **When** the startup check runs, **Then** startup fails
   fast with a clear error before any migration executes.
3. **Given** a clean Postgres without `pgcrypto`, **When** `init-db.sql` is
   applied or the app starts, **Then** the extension is created or startup
   reports a clear actionable error.
4. **Given** `docker-compose.yml` and the test setup, **When** images are
   pulled, **Then** the Postgres image is pinned to a specific minor tag.

### Edge Cases

- An IdP whose discovery document lacks a JWKS URI → OIDC enablement/config
  validation fails, and callbacks fail closed.
- `TRUSTED_PROXY_IP` unset on a direct-exposure deployment → forwarded headers
  ignored (safe default).
- Bundled Compose Postgres has no TLS → shipped configuration must remain
  working via an explicit `DATABASE_SSL_MODE=disable` with prominent docs.
- Sessions created before the token-hashing migration → revoked by the
  migration; users re-authenticate.
- Importer URL whose hostname is a DNS name resolving to a private address
  (DNS rebinding) → documented as an accepted residual limitation for v1;
  literal IPs and well-known names are blocked.
- `DEFAULT_USER_ROLE=ADMIN` env override combined with
  `ALLOW_SELF_REGISTRATION=true` → self-registration still produces `VIEWER`.

## Requirements

### Functional Requirements

- **FR-001**: OIDC ID tokens MUST be cryptographically verified against the
  configured issuer's published keys, and `iss`, `aud`, `exp`, `iat`, and
  `nonce` MUST be validated; failure MUST return `OIDC_TOKEN_VERIFICATION_FAILED`
  and MUST NOT create a session or provision a user.
- **FR-002**: OIDC authorize/token endpoints MUST come from the issuer's
  discovery document rather than assumed path conventions.
- **FR-003**: The backend MUST honor `X-Forwarded-*` headers only when the
  immediate peer is configured via `TRUSTED_PROXY_IP` (address, list, or hop
  count); when unset, forwarded headers MUST be ignored.
- **FR-004**: Production dependencies MUST resolve to versions with no known
  high-severity advisories (`pnpm audit --prod` clean at high severity).
- **FR-005**: The application runtime, `engines`, `.nvmrc`, CI, and Docker
  base image MUST agree on a supported Node.js LTS major (24), with the Docker
  image pinned to a patch release.
- **FR-006**: `POST /sessions/:id/revoke` MUST allow non-admin callers to
  revoke only sessions they own (`403 AUTH_FORBIDDEN` otherwise), MUST return
  `404 NOT_FOUND` for unknown ids, and MUST allow admins to revoke any session.
- **FR-007**: All password-setting inputs MUST require a minimum of 12
  characters via a shared minimum-length constant; the login schema MAY keep
  a lower bound so pre-existing shorter-password accounts can still sign in.
- **FR-008**: Login MUST run a password-verification pass against a fixed
  dummy hash for non-existent, inactive, or password-less accounts before
  returning `AUTH_INVALID_CREDENTIALS`.
- **FR-009**: Session bearer tokens MUST NOT be stored in recoverable form;
  the database stores a one-way hash plus a short display suffix, and the
  migration MUST revoke all pre-existing sessions.
- **FR-010**: `DATABASE_SSL_MODE` MUST default to `require` when
  `NODE_ENV=production` and `disable` otherwise.
- **FR-011**: The settings update path MUST reject any combination that makes
  `allowSelfRegistration` effective together with `defaultUserRole: ADMIN`,
  evaluating stored settings, env overrides, and the incoming patch; the
  self-registration handler MUST clamp an effective `ADMIN` default to
  `VIEWER` and log a warning.
- **FR-012**: Importer-config list/get responses MUST mask `secretRefs` to
  key-only entries.
- **FR-013**: File-based secret refs MUST resolve inside a designated secrets
  directory (`SECRETS_DIR`, default `/run/secrets`); absolute paths outside it
  and `..` traversal MUST be rejected.
- **FR-014**: `web-url` and `api-url` importer URLs MUST be restricted to
  `http(s)` and MUST reject localhost and private/loopback/link-local/
  reserved IP literals at both config-save and run time.
- **FR-015**: Startup MUST verify the connected Postgres meets the documented
  minimum version and that `pgcrypto` is available (creating it if missing and
  permitted) before running migrations.
- **FR-016**: `init-db.sql` MUST create the `pgcrypto` extension; Postgres
  image references MUST be pinned to a minor tag.
- **FR-017**: API documentation (`docs/openapi.yaml`, generated `docs/api.md`)
  MUST be updated for every changed endpoint behavior in the same change
  (ADR-104).

### Key Entities

- **Session**: bearer credential now stored as a one-way hash; retains
  non-secret `publicId` and adds a short display suffix for the UI.
- **OIDC config**: unchanged shape; now consumed through the issuer's
  discovery document (JWKS URI, endpoints).
- **App settings**: `allowSelfRegistration` and `defaultUserRole` gain a
  cross-field invariant evaluated on the effective merged value set.
- **Importer config**: `secretRefs` response shape narrows to key-only;
  `scope.url` gains an allowed-target constraint.

## Success Criteria

- **SC-001**: A forged, unsigned, mis-issued, mis-audienced, or expired OIDC
  ID token is rejected 100% of the time; a correctly issued token still logs
  in.
- **SC-002**: `pnpm audit --prod` reports zero high-severity advisories, and
  the production runtime is a supported LTS line.
- **SC-003**: A non-admin cannot revoke another user's session; authorized
  revocations still succeed.
- **SC-004**: Spoofed `X-Forwarded-For` cannot shift the rate-limit bucket or
  the recorded client IP when no trusted proxy is configured.
- **SC-005**: No password under 12 characters can be set through any flow;
  logins for existing accounts are unaffected and do not leak username
  validity via early return.
- **SC-006**: Importer-config responses disclose no secret locations; file
  secret refs cannot escape the designated directory; URL importers cannot
  target internal addresses.
- **SC-007**: The application fails fast with a clear error on an unsupported
  Postgres version or missing `pgcrypto`.
- **SC-008**: Every fixed finding is covered by a regression test that fails
  on the pre-fix code, and the full lint/typecheck/test/build suite passes.

## Assumptions

- `openid-client` (already a dependency) is the intended OIDC stack per the
  foundation research; its discovery/JWKS validation is reused rather than a
  second JWT library.
- Node.js 24 LTS is the chosen target runtime (approved during planning).
- The bundled Compose Postgres is trusted by network isolation; explicit
  `DATABASE_SSL_MODE=disable` is acceptable there while production defaults
  require TLS.
- Revoking all existing sessions at migration time is an acceptable one-time
  re-login cost.
- DNS names resolving to private addresses (rebinding) are an accepted
  residual risk for v1; only literal IPs and well-known local names are
  blocked.
- Low findings in report §8.4 are out of scope for this spec.
