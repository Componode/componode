# Implementation Plan: Agent-Managed Credentials

**Branch**: `feature/026-agent-managed-credentials` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/026-agent-managed-credentials/spec.md`

## Summary

Implement ADR-117: a second credential flavor, `AGENT_MANAGED`, whose
records store **references** (`{env|file}` names) instead of encrypted
values. The hub gains the `kind` discriminator + `secretRefMap` column
(migration 017), kind-aware CRUD/test APIs, and save-time executor-kind
binding validation; `packages/agent` gains a `credential.test` frame
handler that resolves refs against its own env/`SECRETS_DIR` via a
resolver **moved into `packages/core`** (shared semantics per the ADR-055
amendment). Config↔agent binding and job dispatch remain spec 027 — the
remote test path ships wired-but-latent, exercised by tests that bind
`agentId` directly (spec-025 precedent, confirmed in Clarifications).

## Technical Context

**Language/Version**: TypeScript 6 (strict)

**Primary Dependencies**: Fastify + `@fastify/websocket` (hub),
`ws` + `https-proxy-agent` (agent), Kysely, Zod, React 18 + TanStack
Query + shadcn/ui (frontend), `uuidv7`

**Storage**: PostgreSQL — `credentials` table altered (jsonb `secretRefMap`,
`kind` CHECK); no new tables

**Testing**: Vitest — unit (schemas, resolver, dispatch map) +
integration (testcontainers Postgres, real loopback WS per spec-025
agent-channel tests)

**Target Platform**: Node 20+ Linux containers — `packages/backend` (hub)
and `packages/agent` (remote host)

**Project Type**: pnpm monorepo (core leaf → backend, agent, frontend,
8 importers)

**Performance Goals**: credential ops are admin-frequency (<1 req/s); the
test dispatch bound is the ~30 s wire timeout, not throughput

**Constraints**: zero secret values on the wire/hub-side (the feature's
raison d'être); `resolveImportSecrets` in-process path unchanged;
`GET` side-effect-free (ADR-094); no `sql.raw` (ADR-084); Zod boundary
validation with strict shapes (ADR-095)

**Scale/Scope**: ~8 credential kinds of work across 4 packages: 1
migration, core contract/constants/schemas, credential + config + OIDC
service validation, session-service dispatch + test path, agent frame
handler, credential form/list UX, docs (openapi, agent-protocol, agents,
ux, CONTEXT) + ADR-117 amendment

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Note |
|---|---|---|
| I. Single-org | PASS | no tenant concepts |
| II. Importer-first | PASS | importers untouched; `testSecrets` is the existing hook; the agent (executor host) resolves secrets and passes them in — the ratified remote analog of "the core resolving secrets" |
| III. Two-level taxonomy | N/A | no component classification changes |
| IV. Environment-as-instance | N/A | no env/instance modeling |
| V. Factual vs meaning layer | N/A | no importer-declared edges |
| VI. Test-first | PASS (required) | tasks order failing tests before each implementation step; remote path is covered by test-bound integration tests since binding is 027 |
| VII. Observability | PASS | resolution event logs (key+source only), `credential_test_dispatched` + `tested` audit, `agent_credential_tests_total` metric — no `console.log`, pino only |

No violations → no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/026-agent-managed-credentials/
├── plan.md              # this file
├── research.md          # R1–R10 decisions + ratification checklist
├── data-model.md        # migration 017 delta, contract types, rules
├── contracts/
│   ├── agent-protocol.md    # credential.test / .result frames
│   └── credential-api.md    # REST payload delta + new error codes
├── quickstart.md        # validation walkthrough
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/core/src/
├── constants/credential-kind.ts       # NEW — CREDENTIAL_KINDS
├── constants/error-types.ts           # + AGENT_OFFLINE, AGENT_TEST_TIMEOUT,
│                                      #   CREDENTIAL_NO_BOUND_AGENT,
│                                      #   CREDENTIAL_KIND_MISMATCH
├── constants/import-agent.ts          # + credential_test_dispatched audit
│                                      #   action, AGENT_CREDENTIAL_TEST_TIMEOUT_MS
├── contracts/agent-protocol.ts        # promote credential.test/.result
├── contracts/credential.ts            # + kind, secretRefMap
├── schemas/credential.ts              # discriminated create, ref-map update,
│                                      #   SecretRef schema
└── utils/secrets.ts                   # NEW — SecretRef, EnvSecretResolver,
                                       #   redactSecrets (moved from backend)

packages/backend/src/
├── db/migrations/017_agent_managed_credentials.ts   # NEW
├── db/types.ts                        # CredentialRow + kind/secretRefMap
├── utils/secret-resolver.ts           # re-export shared resolver; keep
│                                      #   resolveImportSecrets (+kind guard)
├── services/credential-service.ts     # kind-aware create/update/test;
│                                      #   dispatch path
├── services/agent-session-service.ts  # dispatchCredentialTest + pending map
├── services/importer-config-service.ts# kind-vs-agentId validation
├── services/oidc-service.ts           # STORED-only client secret
└── routes/credentials.ts              # schema-only changes

packages/agent/src/
├── secrets.ts                         # NEW — agent resolver wiring
│                                      #   (shared EnvSecretResolver + agent
│                                      #   SECRETS_DIR)
└── client.ts                          # credential.test handler → resolve →
                                       #   importer.testSecrets → result frame

packages/frontend/src/
├── pages/credentials.tsx              # kind badge, list rendering
└── components/
    ├── credential-lifecycle-dialogs.tsx  # mode selector + ref-map rows
    └── credential-test-dialog.tsx        # agent-target display

docs/  (openapi.yaml, agent-protocol.md, agents.md, ux.md) + CONTEXT.md
researches/adrs/ADR-117-*.md           # Amendment 1 (enumerated surfaces)
```

**Structure Decision**: existing monorepo layout; the only structural move
is `secret-resolver`'s shared half into `packages/core` (research R6).

## Post-design Constitution Check

Re-evaluated after Phase 1: no gate regressions — the core move keeps
`core` a leaf (node builtins only), the agent keeps importer packages as
its only `@componode/*` adjacency beside core (ADR-065 amendment), and all
new external surfaces are enumerated for ADR-117 Amendment 1 ratification
in the same change.
