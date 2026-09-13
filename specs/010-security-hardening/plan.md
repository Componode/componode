# Implementation Plan: Security Hardening — Critical, High, and Medium Findings

**Branch**: `bugfix/010-security-hardening` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

## Summary

Remediate the 16 critical/high/medium findings of the 2026-09-10 security
assessment (`docs/security/2026-09-10-security-assessment.md` §8.1–8.3) in one
consolidated bugfix spec. Approach per finding is resolved in
[research.md](./research.md):

- **Critical 8.1.1**: verify the OIDC ID token with `openid-client` v6
  (`discovery` + `authorizationCodeGrant` + `tokens.claims()`), removing the
  hand-rolled endpoint paths and trusting `decodeJwtPayload`.
- **High 8.2.1–8.2.6**: `trustProxy` from `TRUSTED_PROXY_IP`; upgrade
  `fastify` ≥5.12.1, `@fastify/static` ≥10.1.2, `kysely` ≥0.28.17
  (clears `fast-uri` transitively); migrate the runtime to pinned Node 24 LTS;
  enforce session-revocation ownership.
- **Medium 8.3.1–8.3.9**: `DATABASE_SSL_MODE` prod default `require`; reject
  self-registration + `defaultUserRole: ADMIN`; mask `secretRefs` in API
  responses; `SECRETS_DIR` file allowlist; SSRF URL guard in `packages/core`
  wired into the two URL-importer config schemas; password min 12 on set
  paths; dummy-hash login; hashed session tokens via migration 009; Postgres
  version + `pgcrypto` startup preflight.

## Technical Context

**Language/Version**: TypeScript 5, Node.js 24 LTS (migrated from EOL 20)

**Primary Dependencies**: Fastify ≥5.12.1, `@fastify/static` ≥10.1.2, Kysely
≥0.28.17, `openid-client` 6.8.5 (already declared), `pg`, `@node-rs/argon2`,
Zod

**Storage**: PostgreSQL ≥14 (16 recommended); one migration
(`009_session_token_hash`); `pgcrypto` extension required

**Testing**: Vitest unit (`test/unit`) + integration (`test/integration`,
testcontainers `postgres:16.x-alpine`); contract test for openapi drift

**Target Platform**: Docker (Linux), Docker Compose; Windows dev via PowerShell

**Project Type**: Monorepo security remediation (backend + core + 2 importer
packages + frontend settings page + deployment artifacts)

**Constraints**:

- Test-first (Constitution VI): every finding gets a failing regression test
  before its fix.
- Importers may only import `@componode/core` (ADR-065/098) — the SSRF guard
  lives in `packages/core` and is applied via the importers' config schemas.
- Migrations-only `sql` usage remains permitted (ADR-084); no `sql.raw` in app
  code.
- `GET` side-effect rule (ADR-094): the OIDC callback remains a GET (OIDC
  convention; low finding 8.4.5 excluded from scope).
- Error codes are controlled enums in `packages/core` (ADR-071); any new code
  must be registered there.
- API changes update `docs/openapi.yaml` + regen `docs/api.md` (ADR-104).

## Constitution Check

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-organization | Pass | No tenant changes. |
| II. Importer-first | Pass | URL-safety helper added to `core`; importers stay pull-only, no DB access. |
| III. Two-level taxonomy | Pass | No taxonomy changes. |
| IV. Environment-as-instance | Pass | No data-model lifecycle changes. |
| V. Factual vs. meaning | Pass | No product-hierarchy changes. |
| VI. Test-first | Pass | Regression tests precede each fix; importer tests still exercise `validateDiscoveredAsset`. |
| VII. Observability | Pass | Startup preflight logs via Pino; self-reg clamp logs a warning; no secrets in logs (ADR-090). |

No violations.

## Project Structure

### Documentation (this bugfix)

```text
specs/010-security-hardening/
├── spec.md                 # Findings → user stories, FR-001..017, SC-001..008
├── plan.md                 # This file
├── research.md             # R1–R11 technical decisions
├── data-model.md           # sessions.tokenLast4 + id semantics change
├── contracts/api-changes.md# Endpoint behavior deltas (ADR-104)
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/backend/src/
├── services/oidc-service.ts        # openid-client rewrite (Critical 8.1.1)
├── services/session-service.ts     # revoke ownership; hashed id; tokenLast4
├── services/auth-service.ts        # dummy hash; logout by hash
├── services/settings-service.ts    # merged-state self-reg/ADMIN guard
├── services/importer-config-service.ts # mask secretRefs in responses
├── utils/secret-resolver.ts        # SECRETS_DIR allowlist
├── utils/argon2.ts                 # DUMMY_HASH constant
├── plugins/session.ts              # lookup by hashToken
├── routes/sessions.ts              # pass caller to revokeSession
├── routes/auth.ts                  # register clamp ADMIN→VIEWER
├── db/connection.ts                # DATABASE_SSL_MODE prod default
├── db/migrations/009_session_token_hash.ts  # new
├── db/types.ts                     # SessionRow + tokenLast4
├── server.ts                       # PG version + pgcrypto preflight
└── app.ts                          # trustProxy from TRUSTED_PROXY_IP
packages/core/src/
├── validation/url-safety.ts        # new: importer URL allowlist
├── schemas/auth.ts, user.ts        # PASSWORD_MIN_LENGTH = 12 (set paths)
└── constants/ + index.ts           # export PASSWORD_MIN_LENGTH
packages/importer-web-url/src/config.ts    # url .superRefine(urlSafety)
packages/importer-api-url/src/config.ts    # url .superRefine(urlSafety)
packages/frontend/src/pages/settings.tsx   # disable ADMIN when self-reg on
Dockerfile, docker-compose.yml, init-db.sql, .env.example, .nvmrc,
.github/workflows/ci.yml, docs/{openapi.yaml,api.md,deployment.md,
importer-development.md,data-model.md}, researches/adrs/*, README.md
```

## Complexity Tracking

No constitution violations — table omitted.
