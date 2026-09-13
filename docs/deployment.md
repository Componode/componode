# Deploying Componode

Componode is self-hosted with Docker Compose. One deployment serves one organization.

## Prerequisites

- Docker Engine 24+
- Docker Compose v2
- A Linux or Windows host with an internet connection for the first build

## Database requirements

The bundled Compose stack provides PostgreSQL 16 with `pgcrypto` preinstalled.
For an **external database**, Componode requires:

- **PostgreSQL 14 or newer**, and
- the **`pgcrypto`** extension (a trusted extension; the database owner can
  create it without superuser, or run `init-db.sql` as a superuser).

The application verifies both at startup and exits with a clear error before
running migrations when the database does not meet the requirements.

## Quick start

1. Clone the repository:
   ```bash
   git clone https://github.com/estevanalex/componode.git
   cd componode
   ```

2. Copy and edit the environment file:
   ```bash
   cp .env.example .env
   ```

3. Open `.env` and set strong random values for `COOKIE_SECRET` and `CSRF_SECRET`.
   Change `BOOTSTRAP_ADMIN_PASSWORD` from the default to a secure value.

4. Start the stack:
   ```bash
   docker compose up -d
   ```

5. Wait for the `app` service to become healthy:
   ```bash
   docker compose ps
   ```

6. Open `http://localhost:3000` and log in with the bootstrap admin credentials
   configured in `.env`.

## Smoke test

A deployment smoke test is available in `scripts/smoke-test.sh`. It copies
`.env.example` to `.env` (if needed), starts the stack, and verifies:

- `GET /api/v1/health` returns `healthy` and `database: connected`.
- The built frontend is served at the root `/`.
- A bootstrap admin can log in and call a protected route.

Run it on macOS/Linux/WSL with:

```bash
./scripts/smoke-test.sh
```

On Windows without WSL, run the equivalent steps from the script manually in
PowerShell, or use Git Bash.

## Configuration reference

The deployment is controlled by `.env`. The table below maps each variable to
its purpose.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | Host port mapped to the application container. |
| `DATABASE_URL` | no | `postgres://componode:componode_pw@postgres:5432/componode` | PostgreSQL connection string. |
| `DATABASE_SSL_MODE` | no | `require` in production | `disable`, `require`, or `verify-full`. The bundled Compose Postgres has no TLS, so the deployment sets `disable` explicitly. For a remote Postgres, keep `require` or use `verify-full` with `DATABASE_SSL_CA`. |
| `DATABASE_SSL_CA` | no | — | Path to a CA certificate file for `verify-full` mode. |
| `TRUSTED_PROXY_IP` | no | — (unset: headers ignored) | Reverse-proxy trust. `X-Forwarded-*` headers are ignored unless set. Accepts one proxy IP, a comma-separated list, or an integer hop count. See ADR-093. |
| `SECRETS_DIR` | no | `/run/secrets` | Directory `file:` secret references are allowed to resolve in. Absolute paths and traversal outside it are rejected. |
| `MAX_DB_CONNECTIONS` | no | `10` | Connection pool size. |
| `BOOTSTRAP_ADMIN_USERNAME` | yes | — | First admin username. |
| `BOOTSTRAP_ADMIN_PASSWORD` | yes | — | First admin password. |
| `COOKIE_SECRET` | yes | — | Random secret for session cookies. |
| `CSRF_SECRET` | yes | — | Random secret for CSRF tokens. |
| `OIDC_ISSUER` | no | — | Optional OIDC issuer URL. |
| `OIDC_CLIENT_ID` | no | — | Optional OIDC client ID. |
| `OIDC_CLIENT_SECRET` | no | — | Optional OIDC client secret. |
| `NODE_ENV` | no | `production` | Node environment; should stay `production` for deployments. |
| `LOG_LEVEL` | no | `info` | Log level (`debug`, `info`, `warn`, `error`). |
| `PROBLEM_TYPE_BASE` | no | `https://componode.io` | Canonical base URI for RFC 7807 problem `type` fields. |

## Upgrading

To upgrade to a new release:

```bash
git pull
docker compose down
docker compose pull
docker compose up -d
```

The `app` container applies pending migrations on startup, and the database
volume preserves all data across upgrades.

## Secrets

Never commit `.env` or any file containing `COOKIE_SECRET`, `CSRF_SECRET`,
`DATABASE_URL` with real credentials, or `OIDC_CLIENT_SECRET`. All sensitive
values are read from the environment at runtime.

## Troubleshooting

- **Port conflict**: ensure `PORT` in `.env` is free, or change it.
- **Database not ready**: the `app` service waits for Postgres to be healthy.
  If it fails, check `docker compose logs postgres`.
- **Missing secret**: the application logs a clear error and exits before
  accepting traffic.
- **No Docker Compose installed**: install Docker Compose v2; the deployment
  requires a single-host Docker environment.
- **Failed migration during upgrade**: the `app` container exits on a migration
  error and logs the failing migration. Fix the issue, then run
  `docker compose up -d` again; the database volume preserves data.
- **No Docker/WSL on Windows**: the smoke test is a Bash script; run it in
  Git Bash, WSL, or an equivalent Unix-like environment, or invoke the
  equivalent PowerShell steps from `scripts/smoke-test.sh` manually.
