---
"@componode/backend": minor
"@componode/core": minor
"@componode/importer-web-url": minor
"@componode/importer-api-url": minor
---

Security hardening from the 2026-09-10 assessment (spec `010-security-hardening`, ADR-106):

- OIDC ID tokens are now verified via `openid-client` discovery with JWKS signature, issuer, audience, expiry, nonce, and PKCE checks — forged tokens are rejected.
- Session tokens are stored SHA-256 hashed at rest (forced re-login on upgrade); session revocation requires ownership or ADMIN and returns 403/404 appropriately.
- `TRUSTED_PROXY_IP` controls `X-Forwarded-*` trust; unset means headers are ignored (rate limiting can no longer be spoofed).
- Password minimum is 12 characters on all password-setting paths; login verifies a dummy hash for unknown users to prevent enumeration.
- Importer `secretRefs` are masked in API responses; `file:` secret references are restricted to `SECRETS_DIR`.
- `web-url` and `api-url` importers reject loopback/private/link-local/metadata URLs (SSRF guard; DNS-rebinding residual documented in ADR-106).
- `DATABASE_SSL_MODE` defaults to `require` in production (bundled Compose Postgres sets `disable` explicitly).
- Startup preflight requires PostgreSQL 14+ and the `pgcrypto` extension before migrations.
- Runtime floor is Node 24 LTS; `fastify`, `@fastify/static`, and `kysely` upgraded to supported versions.
