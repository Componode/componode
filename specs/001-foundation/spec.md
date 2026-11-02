# Feature Specification: Foundation

**Feature Branch**: `001-foundation`

**Created**: 2026-08-16

**Status**: Shipped

**Input**: User description: "001-foundation — the irreducible core: shared contracts (DiscoveredAsset, Importer interface, entity types), database schema (24 tables per ADR-077, see data-model.md for count reconciliation), migrations, backend skeleton (Fastify, Kysely, auth middleware, error handling, session storage, RBAC enforcement, bootstrap admin, local auth, optional OIDC), and an empty dashboard frontend. Milestone: deploy Componode, log in, see an empty dashboard."

## Clarifications

### Session 2026-08-16

- Q: Is the self-registration flow (public `/register` page, account creation) part of 001-foundation, or only the admin toggle? → A: Full self-registration in scope — toggle in settings + public `/register` page + account creation flow (rate-limited, default Viewer role).
- Q: What are the API latency targets for authenticated routes? → A: Standard internal-tool targets — 95th percentile under 500ms for read endpoints, under 1s for write endpoints. No caching needed for v1 single-instance scale.
- Q: What accessibility conformance level is required for the frontend? → A: WCAG 2.1 Level AA — keyboard navigation, screen reader support, color contrast 4.5:1, focus management, ARIA labeling. Tested with at least one screen reader.
- Q: What is the concurrency / scale target for single-instance v1? → A: Up to 50 concurrent users. Connection pool of 10 is sufficient with TanStack Query polling intervals (2-5s).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deploy and Bootstrap (Priority: P1)

A platform engineer downloads Componode, runs the Docker Compose stack
against their own PostgreSQL, and the system bootstraps itself on first
boot: migrations run, the database schema is created, and a bootstrap
admin account is provisioned from environment variables. The engineer can
then log in as the admin and see an empty dashboard with navigation to
products, components, importers, and settings — all empty, all functional.

**Why this priority**: Without a deployable system, nothing else can be
built or demonstrated. This is the irreducible foundation — every
subsequent feature assumes a running, authenticated, empty Componode
instance.

**Independent Test**: Can be fully tested by running the Docker Compose
stack against a fresh PostgreSQL, verifying migrations create all tables,
verifying the bootstrap admin can log in, and verifying the empty
dashboard renders with navigation.

**Acceptance Scenarios**:

1. **Given** a fresh PostgreSQL instance and a configured `.env` file with
   `BOOTSTRAP_ADMIN_PASSWORD` set, **When** the engineer starts the
   Componode stack, **Then** all database migrations run automatically and
   the schema (24 tables) is created without errors.
2. **Given** the stack is running and the database is empty, **When** the
   engineer navigates to the Componode URL in a browser, **Then** a login
   page is displayed.
3. **Given** the login page, **When** the engineer enters the bootstrap
   admin username and password, **Then** they are authenticated and
   redirected to the dashboard.
4. **Given** the admin is logged in, **When** they view the dashboard,
   **Then** they see an empty state with navigation to Products,
   Components, Importers, and Settings.
5. **Given** the admin is logged in, **When** they navigate to any section
   (Products, Components, Importers), **Then** each section displays an
   appropriate empty-state message (no data yet).

---

### User Story 2 - Manage Users and Roles (Priority: P2)

An admin creates additional user accounts (local auth), assigns roles
(Admin, Editor, Viewer), and those users can log in and access only the
functionality permitted by their role. A Viewer can see everything but
change nothing. An Editor can curate products and edges but not manage
users or importer configs. An Admin can do everything.

**Why this priority**: RBAC enforcement is a foundation concern — every
subsequent API route and UI action depends on the role gate being in
place. Without it, the system is insecure for multi-user deployments.

**Independent Test**: Can be tested by creating users with each role,
logging in as each, and verifying that role-restricted actions are denied
with a clear error.

**Acceptance Scenarios**:

1. **Given** the admin is logged in, **When** they create a new user
   account with the Editor role, **Then** the user appears in the user
   list with role Editor and an active status.
2. **Given** the Editor user exists, **When** they log in with their
   credentials, **Then** they are authenticated and see the dashboard.
3. **Given** the Editor is logged in, **When** they attempt to access the
   user management page, **Then** access is denied with a clear
   "insufficient permissions" message.
4. **Given** the Editor is logged in, **When** they attempt to access
   importer configuration management, **Then** access is denied.
5. **Given** a Viewer is logged in, **When** they attempt any
   create/edit/delete action, **Then** the action is denied with a clear
   permission error.
6. **Given** the admin is logged in, **When** they change a user's role
   from Editor to Viewer, **Then** the user's next request reflects the
   new role restrictions.
7. **Given** the admin has enabled self-registration in settings, **When**
   a new user visits the `/register` page and creates an account, **Then**
   the account is created with the Viewer role and the user can log in.
8. **Given** self-registration is disabled (default), **When** a user
   visits `/register`, **Then** the page is not accessible (404 or
   redirect to login).

---

### User Story 3 - Configure OIDC Authentication (Priority: P3)

A deployer with an external identity provider (Okta, Keycloak, Entra ID,
Google) configures OIDC integration so that users can log in via the IdP
instead of (or alongside) local auth. First OIDC login auto-creates the
user account with the Viewer role (JIT provisioning). The admin can
promote OIDC users to Editor or Admin afterward.

**Why this priority**: OIDC is optional but the configuration surface
(provider URL, client ID, client secret reference, claim-to-role mapping)
is a foundation concern — the auth middleware, session table, and user
model must support both local and OIDC users from day one. Wiring the
actual OIDC flow is part of this foundation.

**Independent Test**: Can be tested by configuring a mock OIDC provider,
initiating a login, completing the callback, and verifying the user is
created with the Viewer role.

**Acceptance Scenarios**:

1. **Given** the admin has OIDC provider details (issuer URL, client ID,
   client secret), **When** they configure OIDC in the settings page,
   **Then** the configuration is saved and a "Login with OIDC" option
   appears on the login page.
2. **Given** OIDC is configured, **When** a user clicks "Login with OIDC"
   and completes authentication at the IdP, **Then** they are redirected
   back to Componode, authenticated, and see the dashboard.
3. **Given** an OIDC user's first login, **When** they are authenticated,
   **Then** a user account is automatically created with the Viewer role
   (JIT provisioning).
4. **Given** an OIDC user exists with the Viewer role, **When** the admin
   promotes them to Editor, **Then** their next login reflects the Editor
   role.
5. **Given** OIDC is configured with claim-to-role mapping, **When** a
   user with a matching IdP group claim logs in, **Then** their role is
   set according to the mapping, with local admin override taking
   precedence.

---

### User Story 4 - Session Management and Security (Priority: P4)

A user logs in, works for a while, and their session persists across
requests without re-authenticating. Sessions expire after 4 hours idle or
12 hours absolute. A user can log out. An admin can view all active
sessions and revoke any session. Login attempts are rate-limited to
prevent brute-force attacks. All security headers, CSRF protection, and
cookie security flags are in place.

**Why this priority**: Session management and security hardening are
foundation concerns — they must be in the request pipeline before any
business logic routes are added. Rate limiting and CSRF protection are
inherited by all subsequent routes.

**Independent Test**: Can be tested by logging in, verifying session
persistence, waiting for expiry, attempting brute-force login (rate
limited), and verifying an admin can revoke sessions.

**Acceptance Scenarios**:

1. **Given** a user is logged in, **When** they navigate between pages,
   **Then** they remain authenticated without re-entering credentials
   (session persists via HttpOnly cookie).
2. **Given** a user is logged in, **When** they click "Log out", **Then**
   their session is revoked and they are redirected to the login page.
3. **Given** a user is logged in and idle for 4 hours, **When** they
   attempt an action, **Then** their session has expired and they are
   redirected to the login page.
4. **Given** an attacker attempts 6 logins within 1 minute for the same
   username, **When** the 6th attempt is made, **Then** it is rejected
   with a rate-limit error and a Retry-After header.
5. **Given** the admin is logged in, **When** they view active sessions,
   **Then** they see a list of all active sessions (user, created time,
   last seen time).
6. **Given** the admin is logged in, **When** they revoke another user's
   session, **Then** that user's next request is rejected and they are
   redirected to login.
7. **Given** any page is loaded, **When** the response headers are
   inspected, **Then** security headers (X-Content-Type-Options,
   X-Frame-Options, Content-Security-Policy, Referrer-Policy,
   Permissions-Policy) are present.
8. **Given** a state-changing request (POST/PUT/PATCH/DELETE), **When**
   the request is submitted without a valid CSRF token, **Then** it is
   rejected with a 403 error.

---

### User Story 5 - Observability Foundation (Priority: P5)

Every request, auth event, and system operation is logged with
structured JSON logging. A metrics endpoint exposes system metrics
(request counts, auth events, database query durations) for scraping by
Prometheus. Importer runs (when they exist) will produce trace spans.
The foundation includes the logging pipeline, metrics endpoint, and
tracing infrastructure — even though the first importer run hasn't
happened yet.

**Why this priority**: Principle VII (Observability from Day One) is
non-negotiable. The logging, metrics, and tracing infrastructure must be
in the request pipeline before business logic is added. Retrofitting
observability is prohibited by the constitution.

**Independent Test**: Can be tested by making requests, verifying
structured log output, scraping the metrics endpoint, and verifying
metrics are present.

**Acceptance Scenarios**:

1. **Given** the system is running, **When** any HTTP request is made,
   **Then** a structured JSON log entry is written with request method,
   path, status code, duration, and request ID.
2. **Given** the system is running, **When** a login attempt occurs
   (success or failure), **Then** a structured log entry is written with
   the event type, username, and outcome (no password logged).
3. **Given** the system is running, **When** the metrics endpoint is
   scraped, **Then** it returns metrics in Prometheus format including
   HTTP request counts, auth event counts, and database connection pool
   metrics.
4. **Given** any log entry, **When** it is inspected, **Then** no
   secrets, passwords, session tokens, or sensitive fields are present
   (redaction filter is active).

---

### Edge Cases

- What happens when the database is unreachable on boot? The system
  retries with backoff, logs the error, and exits if the database remains
  unreachable after a configurable timeout.
- What happens when migrations fail mid-way? The migration system
  rolls back the failed migration and logs the error. The system does not
  start with a partially-migrated schema.
- What happens when `BOOTSTRAP_ADMIN_PASSWORD` is not set? The system
  refuses to boot with a clear error message (no default password).
- What happens when `BOOTSTRAP_ADMIN_PASSWORD` is set but the database
  is not empty (already bootstrapped)? The bootstrap is skipped — the
  env var is only read on first boot (empty database).
- What happens when an OIDC provider is unreachable during login? The
  user sees a clear error ("OIDC provider unavailable") and can fall
  back to local auth if configured.
- What happens when an OIDC callback receives an invalid state
  parameter? The callback is rejected with a 400 error and logged as a
  potential CSRF attack.
- What happens when a user's role is changed while they have an active
  session? The role change takes effect on their next request (the
  session loads the user's current role, not a cached snapshot).
- What happens when the session store (Postgres) is temporarily
  unavailable? The request is rejected with a 500 error and logged — no
  fallback to stateless sessions.
- What happens when two requests with the same CSRF token arrive
  simultaneously? Both are accepted (the double-submit pattern is
  stateless — the token is not consumed).
- What happens when self-registration is enabled and an attacker attempts
  to create 4 accounts within 1 minute from the same IP? The 4th attempt
  is rejected with a 429 rate-limit error (3 per IP per minute).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST run database migrations on boot, creating all
  24 tables (per ADR-077, see data-model.md for count reconciliation)
  including the `password_reset_tokens` table
  and append-only triggers on audit tables.
- **FR-002**: System MUST bootstrap an admin account on first boot (empty
  database) using `BOOTSTRAP_ADMIN_USERNAME` and
  `BOOTSTRAP_ADMIN_PASSWORD` environment variables, with the password
  hashed via Argon2id.
- **FR-003**: System MUST refuse to boot if `BOOTSTRAP_ADMIN_PASSWORD`
  is not set and the database is empty.
- **FR-004**: System MUST provide a login page where users authenticate
  with username/password (local auth) or via an OIDC provider (if
  configured).
- **FR-005**: System MUST create server-side sessions (stored in
  PostgreSQL) with a 32-byte cryptographically random session ID, set as
  an HttpOnly, SameSite=Lax cookie (Secure in production).
- **FR-006**: System MUST enforce session timeouts: 4-hour idle timeout
  and 12-hour absolute timeout, with the session checked on every
  authenticated request.
- **FR-007**: System MUST enforce RBAC with three roles (Admin, Editor,
  Viewer) per the permission matrix (ADR-054), with a default-deny
  preHandler on all routes.
- **FR-008**: System MUST provide an admin user management interface to
  create, list, and update user accounts and their roles.
- **FR-009**: System MUST support optional OIDC integration with JIT
  provisioning (first login creates account with Viewer role) and
  claim-based role mapping with local admin override.
- **FR-010**: System MUST rate-limit login attempts (5 per username per
  minute AND 5 per source IP per minute, whichever triggers first) and
  return a 429 with a Retry-After header on exceedance.
- **FR-011**: System MUST enforce CSRF protection on all state-changing
  routes (POST/PUT/PATCH/DELETE) via the double-submit cookie pattern.
- **FR-012**: System MUST set security headers on all HTTP responses:
  X-Content-Type-Options, X-Frame-Options, Content-Security-Policy,
  Referrer-Policy, Permissions-Policy, and Strict-Transport-Security
  (production only).
- **FR-013**: System MUST validate all API request inputs at the route
  boundary using schema validation, returning 400 with a structured
  error response on validation failure.
- **FR-014**: System MUST return errors in a structured format
  `{code, message, details?}` with controlled error codes, never
  leaking stack traces, file paths, or raw database errors.
- **FR-015**: System MUST log all requests, auth events, and system
  operations as structured JSON with a redaction filter that strips
  secrets, passwords, session tokens, and sensitive fields.
- **FR-016**: System MUST expose a metrics endpoint (unauthenticated,
  network-policy-restricted) returning Prometheus-format metrics
  including HTTP request counts, auth event counts, and database pool
  metrics.
- **FR-017**: System MUST provide an empty dashboard with navigation to
  Products, Components, Importers, and Settings sections, each
  displaying an appropriate empty-state message.
- **FR-018**: System MUST allow users to change their own password
  (providing current password) and allow admins to trigger a password
  reset for any user (generating a single-use reset token).
- **FR-019**: System MUST allow admins to view all active sessions and
  revoke any session; users can revoke their own sessions (log out).
- **FR-020**: System MUST provide a health check endpoint returning
  database connectivity status and overall system health.
- **FR-021**: System MUST support CORS configuration via an explicit
  allow-list of exact origins (opt-in, default disabled).
- **FR-022**: System MUST enforce a max request body size (1MB default,
  configurable) and return 413 on exceedance.
- **FR-023**: System MUST use parameterized queries for all database
  operations, with `sql.raw()` prohibited in application code.
- **FR-024**: System MUST connect to PostgreSQL with TLS (sslmode=require
  in production, disable in dev) and a least-privilege database user.
- **FR-025**: System MUST support optional self-registration via an
  `allowSelfRegistration` flag in app settings (default false). When
  enabled, a public `/register` page allows new users to create their own
  account (username, password) with the Viewer role. Registration is
  rate-limited (3 per source IP per minute). When disabled, only admins
  can create accounts.
- **FR-026**: System frontend MUST meet WCAG 2.1 Level AA conformance:
  all interactive elements are keyboard-navigable, form inputs have
  associated labels, color contrast meets 4.5:1 for normal text, focus
  indicators are visible, and ARIA attributes are used where semantic
  HTML is insufficient.

### Key Entities *(include if feature involves data)*

- **Person**: A unified user/account entity (per ADR-033). Has a username,
  password hash (local auth) or OIDC subject (OIDC auth), role (Admin/
  Editor/Viewer), team membership, and slug. Both local-auth and OIDC
  users are the same entity.
- **Session**: A server-side session record with a 32-byte
  cryptographically random ID, user reference, creation time, last-seen
  time, expiry time, and revocation time. Stored in PostgreSQL.
- **OIDC Configuration**: The OIDC provider configuration (issuer URL,
  client ID, client secret reference, claim-to-role mapping). Stored as
  a single row in `oidc_config`.
- **App Settings**: Key-value application settings (e.g., OIDC enabled,
  self-registration enabled, default role for new users). Stored in
  `app_settings`.
- **Password Reset Token**: A single-use reset token (SHA-256 hashed) with
  expiry, linked to a person. Stored in `password_reset_tokens`.
- **Database Schema**: 24 tables covering all v1 entities (persons,
  sessions, digital_products, components, component_instances,
  component_groups, line_of_businesses, teams, importer_configs,
  import_runs, import_run_errors, oidc_config, app_settings,
  password_reset_tokens, entity_changes, edge_changes, junction tables,
  Kysely migration tables) with CHECK constraints from core constants and
  append-only triggers on audit tables.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new deployer can go from clone to running Componode (with
  a logged-in admin viewing an empty dashboard) in under 15 minutes.
- **SC-002**: All 24 database tables are created by migrations on first
  boot, with zero manual SQL execution required.
- **SC-003**: A user can log in and navigate the empty dashboard without
  encountering any errors or broken links.
- **SC-004**: A Viewer user is blocked from every state-changing action
  with a clear, user-friendly permission error (100% of attempted
  actions).
- **SC-005**: Login rate limiting blocks the 6th login attempt within 1
  minute for the same username, with a Retry-After header.
- **SC-006**: Every HTTP response includes all required security headers
  (verifiable by inspecting response headers on any route).
- **SC-007**: No structured log entry contains secrets, passwords, or
  session tokens (verifiable by grep over log output after a login +
  navigation session).
- **SC-008**: The metrics endpoint returns at least 5 distinct metric
  families (HTTP requests, auth events, DB pool, DB query duration,
  rate-limit events) in Prometheus format.
- **SC-009**: An OIDC user can complete a full login flow (redirect to
  IdP, callback, dashboard) in under 10 seconds.
- **SC-010**: The system boots and is ready to serve requests within 30
  seconds of starting (including migration time on a fresh database).
- **SC-011**: 95% of read API requests complete in under 500ms, and 95%
  of write API requests complete in under 1 second, under single-instance
  v1 load of up to 50 concurrent users (measured at the 95th percentile).

> **Note**: SC-010 and SC-011 are post-launch validation criteria measured
> in a staging/Docker Compose environment, not automated test tasks in
> 001-foundation. They are validated during the deployment-and-docs
> feature when the full Docker Compose stack is tested end-to-end.

- **SC-012**: All frontend pages pass WCAG 2.1 Level AA verification —
  keyboard navigation works on every interactive element, color contrast
  meets 4.5:1 for normal text, and at least one screen reader (NVDA or
  VoiceOver) can navigate the login page, dashboard, and settings page
  without unannounced content changes.

## Assumptions

- The deployer has a PostgreSQL 14+ instance available (either via
  Docker Compose or an external instance).
- The deployment target is a single-instance v1 serving up to 50
  concurrent users. Multi-instance deployments with a shared Redis store
  for rate limiting are a post-v1 enhancement.
- The deployer has basic familiarity with environment variable
  configuration and `.env` files.
- OIDC configuration is optional — a deployer can use local auth only
  for v1. OIDC is configured post-deployment via the admin settings UI.
- The frontend and backend are served from the same origin (one
  container, backend serves frontend static files per ADR-065) — CORS is
  not needed for the primary deployment.
- The dashboard sections (Products, Components, Importers) are empty in
  this foundation spec — their content is populated by subsequent specs
  (002-importer-framework, 003-component-catalog, 005-product-hierarchy).
- The settings page in this foundation covers auth configuration (OIDC,
  self-registration toggle) and user management — other settings
  (importer-related, appearance) are added by subsequent specs.
- Password reset tokens are displayed to the admin in v1 (out-of-band
  delivery to the user is a post-v1 enhancement with email integration).
- The `init-db.sql` for least-privilege DB user is included in the
  example Docker Compose but the deployer is responsible for running it
  on external PostgreSQL instances.
- Dev runs over HTTP (localhost) — TLS is terminated by a reverse proxy
  in production (ADR-093), not by Componode itself.
- The 7 v1 importers are NOT part of this spec — they are built in
  002-importer-framework and 003-component-catalog. The importer
  infrastructure (registry, run service) is also deferred to 002.
