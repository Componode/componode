# Quickstart: Foundation

**Feature**: 001-foundation
**Date**: 2026-08-16

This guide documents runnable validation scenarios that prove the
foundation feature works end-to-end. It covers prerequisites, setup,
and the test scenarios that map to the spec's acceptance criteria.

---

## Prerequisites

- Node.js 20+ and pnpm 9+
- Docker and Docker Compose (for PostgreSQL)
- Git

## Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/Componode/componode.git
cd componode
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with the following required values:

```env
# Database
DATABASE_URL=postgres://componode:componode@localhost:5432/componode
DATABASE_SSL_MODE=disable  # use "require" in production
MAX_DB_CONNECTIONS=10

# Bootstrap admin (required on first boot with empty database)
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=ChangeMe123!  # must be 8+ chars

# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Security
COOKIE_SECRET=  # generate: openssl rand -base64 32
CSRF_SECRET=    # generate: openssl rand -base64 32

# CORS (optional, default disabled)
CORS_ALLOWED_ORIGINS=
```

### 3. Start PostgreSQL

```bash
docker compose up -d postgres
```

This starts a PostgreSQL 16 container with the `init-db.sql` script
that creates the `componode` database and least-privilege user.

### 4. Start the backend (dev mode)

```bash
pnpm --filter @componode/backend dev
```

This starts the Fastify server with:
- Automatic migrations on boot (creates all 28 tables)
- Bootstrap admin creation (if database is empty)
- Vite dev server proxy (frontend at http://localhost:5173)

### 5. Start the frontend (dev mode)

In a separate terminal:

```bash
pnpm --filter @componode/frontend dev
```

The frontend runs at `http://localhost:5173` and proxies API requests
to `http://localhost:3000`.

---

## Validation Scenarios

### Scenario 1: Deploy and Bootstrap (SC-001, SC-002, SC-010)

**Validates**: Migrations run, bootstrap admin created, system boots
under 30s.

1. Ensure PostgreSQL is running and the database is empty (fresh
   `docker compose up -d postgres` with no existing data).
2. Start the backend: `pnpm --filter @componode/backend dev`.
3. **Expected**: Server logs show migrations running (28 tables created)
   and bootstrap admin created.
4. **Expected**: Server is ready to serve requests within 30 seconds.
5. Verify the database has all tables:
   ```bash
   docker compose exec postgres psql -U componode -d componode -c "\dt"
   ```
   **Expected**: 24 tables listed (persons, sessions, components, etc.)
   plus `kysely_migration` and `kysely_migration_lock`.

### Scenario 2: Login and Empty Dashboard (SC-003)

**Validates**: Login works, dashboard renders with navigation.

1. Open `http://localhost:5173` in a browser.
2. **Expected**: Login page is displayed.
3. Enter bootstrap admin credentials (`admin` / `ChangeMe123!`).
4. **Expected**: Redirected to the dashboard.
5. **Expected**: Dashboard shows navigation to Products, Components,
   Importers, and Settings.
6. Click each navigation item.
7. **Expected**: Each section displays an empty-state message (no data
   yet).

### Scenario 3: RBAC Enforcement (SC-004)

**Validates**: Viewer role is blocked from state-changing actions.

1. Log in as admin.
2. Navigate to Settings → Users.
3. Create a new user with role `Viewer` (username: `viewer1`, password:
   `Viewer123!`).
4. Log out.
5. Log in as `viewer1`.
6. **Expected**: Dashboard renders (read access works).
7. Navigate to Settings → Users.
8. **Expected**: Access denied with "insufficient permissions" message.
9. Attempt to access `POST /api/v1/users` via API:
   ```bash
   curl -X POST http://localhost:3000/api/v1/users \
     -H "Content-Type: application/json" \
     -H "Cookie: componode_session=<viewer_session>" \
     -H "X-CSRF-Token: <csrf_token>" \
     -d '{"username":"test","password":"Test1234!","role":"VIEWER"}'
   ```
10. **Expected**: `403` response with `AUTH_FORBIDDEN` code.

### Scenario 4: Rate Limiting (SC-005)

**Validates**: Login rate limiting blocks the 6th attempt.

1. Attempt 6 logins with wrong password for `admin` within 1 minute:
   ```bash
   for i in 1..6; do
     curl -X POST http://localhost:3000/api/v1/auth/login \
       -H "Content-Type: application/json" \
       -d '{"username":"admin","password":"wrong"}'
   done
   ```
2. **Expected**: First 5 return `401 AUTH_INVALID_CREDENTIALS`.
3. **Expected**: 6th returns `429 AUTH_RATE_LIMITED` with
   `Retry-After` header.

### Scenario 5: Security Headers (SC-006)

**Validates**: All required security headers are present.

1. Make any request and inspect response headers:
   ```bash
   curl -I http://localhost:3000/api/v1/health
   ```
2. **Expected** headers present:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Content-Security-Policy: ...`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: ...`
   - `Strict-Transport-Security: ...` (production only, when behind TLS)

### Scenario 6: No Secrets in Logs (SC-007)

**Validates**: Redaction filter strips sensitive fields.

1. Start the backend with `LOG_LEVEL=debug`.
2. Log in with valid credentials.
3. Inspect the log output.
4. **Expected**: No log entry contains `password`, `passwordHash`,
   `sessionToken`, `clientSecret`, or `authorization` values. Sensitive
   fields show `[REDACTED]`.

### Scenario 7: Metrics Endpoint (SC-008)

**Validates**: Prometheus metrics are exposed with 5+ metric families.

1. Make a few API requests (login, dashboard load).
2. Scrape the metrics endpoint:
   ```bash
   curl http://localhost:3000/metrics
   ```
3. **Expected**: Response is Prometheus text format.
4. **Expected**: At least 5 metric families present:
   `http_requests_total`, `http_request_duration_seconds`,
   `auth_events_total`, `db_pool_size`, `rate_limit_events_total`.

### Scenario 8: Session Management (FR-006, FR-019)

**Validates**: Sessions persist, can be revoked, and expire.

1. Log in as admin.
2. Navigate between pages.
3. **Expected**: No re-authentication required (session persists).
4. As admin, go to Settings → Sessions.
5. **Expected**: Active sessions listed.
6. Revoke a session.
7. **Expected**: That user's next request redirects to login.

### Scenario 9: Self-Registration (FR-025)

**Validates**: Self-registration flow works when enabled.

1. As admin, go to Settings and enable `allowSelfRegistration`.
2. Log out.
3. **Expected**: Login page shows a "Register" link.
4. Click "Register", create an account (`newuser` / `NewUser123!`).
5. **Expected**: Account created with Viewer role, auto-logged-in,
   dashboard renders.
6. As admin, disable `allowSelfRegistration`.
7. Log out and navigate to `/register`.
8. **Expected**: Page not accessible (redirect to login or 404).

### Scenario 10: OIDC Flow (SC-009)

**Validates**: OIDC login flow completes in under 10 seconds.

1. As admin, configure OIDC (Settings → OIDC) with a test IdP
   (e.g. Keycloak or Dex running locally).
2. Log out.
3. **Expected**: Login page shows "Login with OIDC" button.
4. Click it, complete authentication at the IdP.
5. **Expected**: Redirected back to Componode dashboard within 10
   seconds.
6. **Expected**: User created with Viewer role (JIT provisioning).

---

## Running Automated Tests

### Unit tests

```bash
pnpm --filter @componode/backend test:unit
pnpm --filter @componode/frontend test:unit
```

Covers: Argon2id hashing, crypto token generation, password reset
logic, CHECK constraint helper, safe-url utility, external-link
component.

### Integration tests

```bash
pnpm --filter @componode/backend test:integration
```

Covers: auth flow (login, logout, session), RBAC enforcement, user
CRUD, OIDC flow (with mock IdP), settings, migrations (testcontainers
Postgres). These tests spin up a real PostgreSQL container via
testcontainers, run migrations, and test the full request pipeline.

### All tests

```bash
pnpm test
```

Runs all unit and integration tests across all packages via Turborepo.
