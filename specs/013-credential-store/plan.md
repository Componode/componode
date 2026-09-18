# Implementation Plan: Credential Store

**Branch**: `feature/013-credential-store` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-credential-store/spec.md`

## Summary

Replace env/file secret references for **in-app integration secrets** with a
first-class `credentials` store: secret values are AES-256-GCM-encrypted at rest
under an external master key, write-only through the API, bundled as named
key/value maps (one credential = one logical login), referenced by importer
configs and OIDC, with dedicated RBAC, audit, lifecycle (rotate/revoke/expiry),
a test action, a deprecation window for legacy `env`/`file` refs, and a
dual-env master-key rotation procedure. This supersedes ADR-023's "no secrets
at rest" clause — a new **ADR-107** records the reversal. Infrastructure
secrets (DB password, registry, monitoring, the master key itself) stay
external.

## Technical Context

**Language/Version**: TypeScript 5 / Node 24 (`node:crypto` provides AES-256-GCM; no new crypto dependency)

**Primary Dependencies**: Fastify (routes), Kysely (queries + migration), Zod (boundary schemas in `packages/core`), Octokit/openid-client (credential test actions reuse existing importer/OIDC paths). **No new runtime dependencies.**

**Storage**: PostgreSQL — new `credentials` table + `importer_config_credentials` junction; `importer_configs.secretRefs` retained for deprecation window; `oidc_config.clientSecretCredentialId` added; `import_runs.credentialIds` added. Master key material lives outside the DB (`COMPONODE_SECRETS_KEY` env or `SECRETS_DIR/master.key`).

**Testing**: Vitest unit tests (crypto round-trip, resolver, schema validation, collision detection) + testcontainers Postgres integration tests (credential CRUD, run resolution, migration conversion, boot key checks). Test-first per Constitution VI.

**Target Platform**: Docker Compose self-hosted (single container; `SECRETS_DIR=/run/secrets` mounted)

**Project Type**: pnpm monorepo web service — `packages/core` (contracts), `packages/backend` (service+routes), `packages/frontend` (React UI), 7 importer packages (manifest `secrets` declaration)

**Performance Goals**: Negligible — credential resolution is one decrypt per credential per run start; no hot path.

**Constraints**: Plaintext values never leave the backend (write-only API, masked in logs/audit per ADR-090); master key never crosses the API; boot fails when credentials exist and no key is available — when no credentials exist yet, credential features degrade with a boot-log warning + `credentialsAvailable: false` on `/api/v1/health`.

**Scale/Scope**: Single-org; dozens of credentials, ≤ 7 importer types, one OIDC config.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-Organization | PASS | Credentials are org-global; no tenant columns |
| II. Importer-First | PASS | Importer contract `run(config, secrets, context)` unchanged; core resolves secrets; importers only add a `secrets` manifest declaration |
| III. Two-Level Taxonomy | N/A | No taxonomy change |
| IV. Environment-as-Instance | N/A | No component/instance change |
| V. Factual vs. Meaning Layer | N/A | No hierarchy edges |
| VI. Test-First | GATE | Plan mandates failing tests before implementation for crypto, resolver, service, routes, migration |
| VII. Observability | PASS | Credential ops produce audit records; `encryptedPayload`/secret fields added to Pino redaction; no secrets in logs (ADR-090) |

**ADR deviation (not a constitution violation)**: ADR-023's "no secrets at rest
in the app DB" is intentionally reversed by this feature and recorded in
ADR-107; the trade-off was grilled and accepted by the product owner.

## Project Structure

### Documentation (this feature)

```text
specs/013-credential-store/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions from grilling session
├── data-model.md        # Phase 1 output — credentials schema + changes
├── quickstart.md        # Phase 1 output — validation scenarios
├── contracts/           # Phase 1 output — REST + importer-manifest contracts
│   └── credentials-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/
├── core/src/
│   ├── schemas/credential.ts          # NEW — Zod create/update/test schemas
│   ├── schemas/importer-config.ts     # EDIT — credentialRefs, deprecate env/file
│   ├── contracts/credential.ts        # NEW — Credential API types
│   ├── contracts/importer.ts          # EDIT — manifest.secrets declaration
│   └── constants/errors.ts            # EDIT — CREDENTIAL_* error codes
├── backend/src/
│   ├── db/migrations/011_credential_store.ts  # NEW
│   ├── db/types.ts                    # EDIT — CredentialRow, junction, new cols
│   ├── utils/credential-crypto.ts     # NEW — AES-256-GCM + key bootstrap/rotation
│   ├── utils/secret-resolver.ts       # EDIT — credential resolution + deprecation
│   ├── services/credential-service.ts # NEW — CRUD, dependents, convert, test
│   ├── services/import-run-service.ts # EDIT — resolve via store, record usage
│   ├── services/settings-service.ts   # EDIT — OIDC clientSecretCredentialId
│   ├── services/oidc-service.ts       # EDIT — resolve via credential store
│   ├── routes/credentials.ts          # NEW — /api/v1/credentials
│   ├── routes/importers.ts            # EDIT — credentialRefs, convert action
│   ├── plugins/rbac.ts                # EDIT — credential:* permissions
│   └── server.ts                      # EDIT — boot key check + key rotation
├── frontend/src/
│   ├── pages/credentials.tsx          # NEW — list/detail/lifecycle UI
│   ├── components/credential-form.tsx # NEW — create/rotate, key/value editor
│   └── components/importer-config-form.tsx # EDIT — credential picker + badges
└── importer-*/src/manifest.ts         # EDIT ×7 — secrets declaration
```

**Structure Decision**: Standard monorepo split — contracts/schemas in `core`,
all secret handling in `backend` (crypto + resolution + routes), UI in
`frontend`, manifest additions in each importer package. No new package.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations. The ADR-023 reversal is a deliberate, documented
decision (ADR-107) — not a complexity violation.
