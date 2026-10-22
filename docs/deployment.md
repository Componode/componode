# Deploying Componode

Componode is self-hosted with Docker Compose. One deployment serves one organization.

## Prerequisites

- Docker Engine 24+
- Docker Compose v2
- A Linux or Windows host with an internet connection for the first build
- Host ports 80 and 443 free for the bundled Caddy HTTPS front end
  (override `HTTP_PORT`/`HTTPS_PORT` in `.env` if taken)

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
   git clone https://github.com/Componode/componode.git
   cd componode
   ```

2. Copy and edit the environment file:
   ```bash
   cp .env.example .env
   ```

3. Open `.env` and set a strong random value for `COOKIE_SECRET`.
   Change `BOOTSTRAP_ADMIN_PASSWORD` from the default to a secure value.

4. Start the stack:
   ```bash
   docker compose up -d
   ```

5. Wait for the `app` service to become healthy:
   ```bash
   docker compose ps
   ```

6. Open `https://localhost` — the bundled Caddy serves a self-signed
   certificate, so accept the browser warning (or trust the root CA; see
   *TLS and reverse proxy*). Plain `http://localhost:3000` also works from
   the same host. Log in with the bootstrap admin credentials configured
   in `.env`.

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
| `PORT` | no | `3000` | Host port mapped to the application container (bound to `127.0.0.1`). |
| `SITE_ADDRESS` | no | `localhost` | Public name the bundled Caddy issues its self-signed certificate for — set to this host's DNS name or IP. |
| `HTTP_PORT` / `HTTPS_PORT` | no | `80` / `443` | Host ports the bundled Caddy binds. |
| `DATABASE_URL` | no | `postgres://componode:componode_pw@postgres:5432/componode` | PostgreSQL connection string. |
| `DATABASE_SSL_MODE` | no | `require` in production | `disable`, `require`, or `verify-full`. The bundled Compose Postgres has no TLS, so the deployment sets `disable` explicitly. For a remote Postgres, keep `require` or use `verify-full` with `DATABASE_SSL_CA`. |
| `DATABASE_SSL_CA` | no | — | Path to a CA certificate file for `verify-full` mode. |
| `TRUSTED_PROXY_IP` | no | `1` in the Compose stack | Reverse-proxy trust — one hop for the bundled Caddy. Set to empty to ignore `X-Forwarded-*` when no proxy fronts the app; accepts one proxy IP, a comma-separated list, or an integer hop count. See ADR-093. |
| `SECRETS_DIR` | no | `/run/secrets` | Directory `file:` secret references are allowed to resolve in, and the fallback location of the credential master key (`master.key`). Absolute paths and traversal outside it are rejected. |
| `COMPONODE_SECRETS_KEY` | no | — | Credential-store master key (32 bytes, base64 or 64-char hex). Encrypts all stored integration credentials (AES-256-GCM). Preferred over `SECRETS_DIR/master.key`. |
| `COMPONODE_SECRETS_KEY_PREVIOUS` | no | — | Retiring master key during rotation. See *Credential store* below. |
| `MAX_DB_CONNECTIONS` | no | `10` | Connection pool size. |
| `BOOTSTRAP_ADMIN_USERNAME` | yes | — | First admin username. |
| `BOOTSTRAP_ADMIN_PASSWORD` | yes | — | First admin password. |
| `COOKIE_SECRET` | yes | — | Random secret for session cookies. |
| `PUBLIC_URL` | no | request origin | Canonical public base URL (e.g., `https://componode.example.com`). Used to build the OIDC callback URL — set it when the app sits behind a reverse proxy so the IdP redirect resolves to the external origin. |
| `CORS_ALLOWED_ORIGINS` | no | — (CORS disabled) | Comma-separated list of exact origins allowed to call the API with credentials. Unset means no cross-origin access (ADR-088). |
| `IMPORTER_MAX_CONCURRENCY` | no | `3` | Maximum importer runs executing in parallel. |
| `DEBUG_ERROR_DETAILS` | no | `false` | `true` includes internal error details in API error responses. Debug only — never enable in production (ADR-096). |
| `NODE_ENV` | no | `production` | Node environment; should stay `production` for deployments. |
| `LOG_LEVEL` | no | `info` | Log level (`debug`, `info`, `warn`, `error`). |
| `PROBLEM_TYPE_BASE` | no | `https://componode.io` | Canonical base URI for RFC 7807 problem `type` fields. |

## TLS and reverse proxy

Production deployments MUST serve Componode over HTTPS (ADR-093). The app
does not terminate TLS — the bundled `caddy` service does, with a
certificate issued by **Caddy's internal CA** (`tls internal` in the
shipped `Caddyfile`). The app's own `:3000` port is bound to `127.0.0.1`,
so remote access is HTTPS only.

The internal root CA is written on first start to the `caddy_data` volume
at `/data/caddy/pki/authorities/local/root.crt`. Browsers must trust that
root or accept the certificate warning. Export it for installation into a
client trust store with:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt root.crt
```

`SITE_ADDRESS` (`.env`, default `localhost`) is the name the certificate is
issued for — set it to this host's DNS name or IP, and set
`PUBLIC_URL=https://<SITE_ADDRESS>` to match. The stack sets
`TRUSTED_PROXY_IP=1` on `app` so `X-Forwarded-*` headers from the bundled
proxy are honored; if you remove Caddy and expose `app` directly, set it
empty in `.env`.

To use a publicly trusted certificate for a real domain instead, set
`SITE_ADDRESS` to the domain and remove `tls internal` from the
`Caddyfile` — Caddy obtains and renews Let's Encrypt certificates
automatically (ports 80/443 must be reachable from the internet).

### Alternative: your own reverse proxy (nginx)

To terminate TLS elsewhere, remove or comment out the `caddy` service,
publish `app` as needed, and set `TRUSTED_PROXY_IP` to that proxy's IP (or
a hop count) plus `PUBLIC_URL`. An nginx example:

```nginx
server {
    listen 443 ssl;
    server_name componode.example.com;

    ssl_certificate     /etc/letsencrypt/live/componode.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/componode.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Set `TRUSTED_PROXY_IP` to the proxy's IP (or `1` hop) and `PUBLIC_URL` to
the external HTTPS origin.

## OIDC single sign-on

OIDC is configured **in the app**, not via environment variables: log in as
an ADMIN and open **Settings → OIDC Configuration** to set the issuer URL,
client ID, and client secret (stored encrypted in the credential store —
ADR-107). Register `https://<your-host>/api/v1/auth/oidc/callback` as the
redirect URI at your IdP. When the app runs behind a reverse proxy, set
`PUBLIC_URL` so the generated callback URL uses the external origin.

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

Never commit `.env` or any file containing `COOKIE_SECRET`,
`DATABASE_URL` with real credentials, or `COMPONODE_SECRETS_KEY`. All
sensitive values are read from the environment at runtime.

## Credential store

Integration credentials (GitHub PATs, OIDC client secrets, API keys) created
in the app are stored **encrypted in PostgreSQL** with AES-256-GCM. The master
key lives outside the database, resolved in this order at boot:

1. `COMPONODE_SECRETS_KEY` (recommended — base64 or hex, 32 bytes;
   `openssl rand -base64 32` generates one).
2. `SECRETS_DIR/master.key` — read if present; otherwise auto-generated on
   first boot **only if `SECRETS_DIR` already exists** (a mounted
   directory/volume). The app never creates `SECRETS_DIR` itself: writing the
   key into the container's ephemeral layer would lose it on recreate.
3. No key source → the app starts **degraded** (`credentialsAvailable: false`
   on `GET /api/v1/health`) when the store is empty, or **refuses to start**
   when credentials already exist — silently generating a new key would make
   them unrecoverable.

**Backup unit**: the database **plus** the master key together. A DB backup
without the key restores ciphertext; a key without the DB restores nothing.
Back up `master.key` (or the `COMPONODE_SECRETS_KEY` value) with the same care
as `DATABASE_URL` credentials — store it in your secret manager, never in git.

**Rotation** (dual-key): set `COMPONODE_SECRETS_KEY` to the **new** key and
`COMPONODE_SECRETS_KEY_PREVIOUS` to the **old** key, then restart. Boot
re-encrypts every stored payload under the new key (`keyVersion` bumps) and
logs the count. Once all credentials report the current version, unset
`COMPONODE_SECRETS_KEY_PREVIOUS` and restart again. If `master.key` is the
key source, rotate by copying the old file aside and setting both env vars for
one boot.

**Degraded mode**: with no key and an empty store the app runs normally —
credential API calls return `503 CREDENTIAL_KEY_UNAVAILABLE` and importer
configs using stored credentials cannot run. Configure a key and restart to
enable the store; no data migration is needed.

## Import Agents (optional)

Import Agents run importers inside networks the hub cannot reach (private
VPCs, on-prem Kubernetes, egress-only environments). Agents normally run on
remote hosts — the Compose stack declares an `agent` service so the image
builds together (`docker compose build`), but it starts **0 replicas** and
does not run on `docker compose up`.

On a remote host, build the image and run it:

```bash
docker build -f Dockerfile.agent -t componode-agent:latest .

docker run -d --name componode-agent \
  -e HUB_URL=https://hub.example.com \
  -e AGENT_ENROLLMENT_TOKEN_FILE=/run/secrets/enroll_token \
  -v ./enroll_token:/run/secrets/enroll_token:ro \
  -v componode-agent-state:/state \
  -e AGENT_STATE_DIR=/state \
  componode-agent:latest
```

The agent makes a single **outbound** TLS WebSocket to the hub — no inbound
firewall rules are needed. Create the agent in the UI (**Administration →
Import Agents**) to get the one-time enrollment token.

The agent also serves a GET-only ops listener (`/healthz`, `/readyz`,
`/metrics`) on `AGENT_OPS_HOST:AGENT_OPS_PORT` (default `0.0.0.0:9464`),
wired to the image `HEALTHCHECK`. Publish it with `-p 9464:9464` if your
Prometheus can reach the agent host, or bind to loopback for sidecar
scraping; `AGENT_OPS_DISABLED=true` turns it off (override the healthcheck
if you do).

To run an agent co-located with the hub in the Compose stack (local
testing), create the agent in the UI, set `AGENT_ENROLLMENT_TOKEN` in
`.env`, and scale the service:

```bash
docker compose up -d --scale agent=1
```

The agent shares the `app` network namespace and reaches the hub through
Caddy at `https://hub` — `hub` is a Compose-network alias for the `caddy`
container, so the connection exercises the real TLS path. It verifies the
self-signed certificate against Caddy's internal root CA, mounted
read-only from the `caddy_data` volume as `CA_BUNDLE`, and depends on
Caddy being healthy so the CA exists before the agent starts. The durable
credential persists in the `agent_state` volume across restarts; the ops
listener is reachable to other containers as `app:9464` but cannot be
published to the host from the shared namespace.

Full configuration table, lifecycle operations, agent-managed credentials,
metrics catalog, and troubleshooting: `docs/agents.md`. Wire protocol:
`docs/agent-protocol.md`.

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
