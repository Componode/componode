# Quickstart Validation: Security Hardening

Prerequisites: repo checkout, `pnpm install`, Docker (for testcontainers and
the Compose smoke test).

## Automated validation

```powershell
pnpm lint
pnpm typecheck
pnpm test                # unit + integration (testcontainers Postgres)
pnpm build
pnpm audit --prod        # expect: 0 high-severity advisories
pnpm --filter @componode/backend docs:api:check   # openapi.yaml in sync (ADR-104)
```

Focused regression suites:

```powershell
pnpm --filter @componode/backend test:integration -- oidc sessions auth settings importers migrations
pnpm --filter @componode/backend test:unit -- secret-resolver url-safety
```

## Manual smoke (Compose)

```powershell
copy .env.example .env   # keep DATABASE_SSL_MODE=disable for bundled Postgres
docker compose up -d --build
# 1. node --version inside the container is v24.x
docker compose exec app node --version
# 2. Login flow still works; GET /login serves the SPA.
# 3. A forged X-Forwarded-For header does not change logged req.ip when
#    TRUSTED_PROXY_IP is unset.
# 4. Startup fails fast with a clear message if pointed at Postgres < 14 or
#    a database where pgcrypto cannot be created.
```

## Expected outcomes

- Forged/unsigned/mis-issued OIDC ID tokens are rejected; the happy path still
  logs in via a mocked JWKS in `oidc.test.ts`.
- Viewer cannot revoke another user's session (403); admin can (204).
- Passwords under 12 chars are rejected on set flows; login still accepts
  legacy shorter passwords.
- `sessions.id` in the DB is a hex hash, not the cookie value; sessions list
  still shows `tokenLast4`.
- Importer configs reject `http://169.254.169.254/` and `http://localhost/…`
  scope URLs at save time.
