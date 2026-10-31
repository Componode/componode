# Implementation Plan: ImporterSource Core

**Branch**: `044-importer-source-core` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/044-importer-source-core/spec.md`

## Summary

Implement the contracts ratified in spec 043 (ADR-119 + amendments): a
durable `ImporterSource` entity bound one-to-one to the reporting config;
`reportSourceIdentity` + `resolveTarget` on the importer context;
`targetRefKey`/`reportsSourceIdentity` on the manifest; durable
Source→Component/Instance memberships that become the reconciliation unit
for adopting importers while non-adopting importers keep the existing
config-scoped path untouched; `import_runs.sourceId` durable with
`configId` nullable `ON DELETE SET NULL`; a source lifecycle API
(list/detail/runs/retire/reactivate); and an agent-local versioned
target-registry with fail-before-network preflight plus a new
`source.identity` protocol frame (v3).

## Technical Context

**Language/Version**: TypeScript 6 (pnpm workspaces + Turborepo).

**Primary Dependencies**: Fastify, Kysely, Zod, Vitest, testcontainers,
Pino, `uuidv7` — all existing. No new runtime dependencies.

**Storage**: PostgreSQL — migration `022` adds `importer_sources`,
`source_component_memberships`, `source_instance_memberships`,
`import_runs.sourceId` (+ indexes) and rebuilds `import_runs.configId` as
nullable `ON DELETE SET NULL`.

**Testing**: Vitest; backend integration via testcontainers Postgres
(`postgres:16.11-alpine`, migrations auto-run); agent unit tests with
injected `ImporterRegistry`/`send` doubles; `api-docs-contract.test.ts`
enforces openapi↔route sync (ADR-104).

**Target Platform**: hub (backend container) + remote Import Agent process.

**Project Type**: web-service / library contracts across `packages/core`,
`packages/backend`, `packages/agent`, `packages/frontend` (type-only).

**Performance Goals**: unchanged — membership upserts add O(#assets)
idempotent writes per run inside the existing per-asset transaction.

**Constraints**: zero behavior drift for non-adopting importers (FR-013);
no secrets in source identity; registry reads stay under `SECRETS_DIR`;
protocol bump is lockstep (hub and agent rebuild together); every new
enumerated surface (endpoints, permissions, error codes, frames, NACK
prefixes) ratified in the same change (FR-014).

**Scale/Scope**: 1 migration; ~3 new core files; ~5 backend
service/route changes + 1 new route file; agent executor + registry
loader; protocol contract additions; 4 ADR amendments; docs sync.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Verdict | Note |
|---|---|---|
| I. Single-Organization | PASS | Sources are org-global provenance; no tenant columns. |
| II. Importer-First | PASS | Importers report identity via context — never touch DB; new manifest/context members keep pull-only `AsyncGenerator` contract; importer packages still core-only. |
| III. Two-Level Taxonomy | PASS | No category/provider changes. |
| IV. Environment-as-Instance | PASS | Source lifecycle is a third axis on a new entity — `lifecycle`/`status` semantics untouched. |
| V. Factual vs. Meaning | PASS | Provenance is factual layer; no product-edge changes. |
| VI. Test-First | PASS | Every phase lands failing tests first (integration for DB paths, unit for executor/registry); `validateDiscoveredAsset` path unchanged. |
| VII. Observability | PASS | Run logger context preserved; NACK/frame handling logs through existing pino paths; source transitions audited. |

No violations; Complexity Tracking not required.

### Post-design re-check

Design adds no new dependency and no principle conflict: memberships are
typed junction tables (ADR-048), `RETIRED`/`UNMONITORED` are Source-axis
states — not conflated with `Component.lifecycle`/`Instance.status` — and
`GET /importer-sources*` reads are side-effect-free (ADR-094). PASS.

## Project Structure

### Documentation (this feature)

```text
specs/044-importer-source-core/
├── plan.md                          # this file
├── research.md                      # 11 decisions + ratification map
├── data-model.md                    # entities, migration 022, state machine
├── contracts/
│   ├── importer-contract.md         # ImporterContext/Manifest/ImportRun deltas
│   ├── source-api.md                # REST endpoints, codes, permissions
│   └── agent-protocol-changes.md    # source.identity frame, NACK, registry
├── quickstart.md                    # validation map
└── tasks.md                         # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/core/src/
├── constants/importer-source.ts          # NEW — statuses, audit actions
├── constants/import-agent.ts             # + TARGET_RESOLUTION_FAILED prefix, v3
├── contracts/importer-source.ts          # NEW — ImporterSource, SourceIdentity
├── contracts/importer.ts                 # + reportSourceIdentity, resolveTarget
├── contracts/import-run.ts               # configId nullable, + sourceId
├── contracts/agent-protocol.ts           # + source.identity frame
├── schemas/importer-source.ts            # NEW — strict API schemas
├── importer-registry.ts                  # + targetRefKey, reportsSourceIdentity
└── utils/target-registry.ts              # NEW — envelope schema (node export)

packages/backend/src/
├── db/migrations/022_importer_sources.ts # NEW
├── db/types.ts                           # +3 rows, ImportRunRow changes
├── routes/importer-sources.ts            # NEW — list/detail/runs/retire/reactivate
├── services/importer-source-service.ts   # NEW — register-or-match, lifecycle
├── services/import-run-service.ts        # context members, membership upserts,
│                                         # source-scoped reconcile branch
├── services/importer-config-service.ts   # delete → UNMONITORED transition
├── services/remote-run-service.ts        # onSourceIdentity, NACK branch, gate
├── services/agent-session-service.ts     # frame routing
├── services/{agent,dashboard}-service.ts # inner→left join fixes
└── plugins/rbac.ts                       # + importer:source:* permissions

packages/agent/src/
├── executor.ts                           # preflight, resolveTarget, identity frame
└── target-registry.ts                    # NEW — per-job registry loader

packages/frontend/src/api/types.ts        # ImportRun.configId nullable

docs/{openapi.yaml, agent-protocol.md, agents.md, deployment.md,
      importer-development.md, roadmap.md}
researches/adrs/{ADR-119 A1, ADR-116 A6, ADR-056 A2, ADR-054 A2 + index}
```

**Structure Decision**: follow existing per-domain layout — new route and
service files for the Source surface; reconciliation stays in
`import-run-service.ts` with a source-scoped branch (not a rewrite) to
keep the legacy path byte-identical; agent target logic in a new
`target-registry.ts` module injected into `JobExecutor` deps for testability.

## Complexity Tracking

> No constitution violations — nothing to justify.
