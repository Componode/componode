# Implementation Plan: Docker Hub execution and managed targets

**Branch**: `049-docker-hub-execution` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/049-docker-hub-execution/spec.md`

## Summary

Enable the existing Docker importer to run either in the Hub worker or on an Import Agent. The Hub gains a Docker-specific managed target entity, ADMIN-only CRUD/lifecycle/test APIs, and a target picker; Agents keep their existing local target registry and wire protocol. Hub target resolution happens before network access, uses the manifest-provided Docker profile schema, and composes with `STORED` credentials. Target disablement blocks new use, requests cancellation with `cancelReason: TARGET_DISABLED`, and records audit/activity events. Docker’s Agent-only restriction is removed while preserving inventory and source-reconciliation semantics.

## Technical Context

**Language/Version**: TypeScript 6 / Node 22+

**Primary Dependencies**: Fastify 5, Kysely, PostgreSQL, Zod 4, React 18, TanStack Query, dockerode, existing importer framework

**Storage**: PostgreSQL JSONB for non-secret Docker target profiles; existing `importer_configs`, `credentials`, `import_runs`, `entity_changes`

**Testing**: Vitest unit/integration suites, testcontainers-backed backend integration tests, frontend unit tests, API/OpenAPI contract tests

**Target Platform**: Self-hosted Linux Docker Compose; backend may optionally receive explicit Docker socket/context access

**Project Type**: pnpm monorepo web service + importer packages

**Performance Goals**: Target CRUD/list operations are low-volume admin actions; Hub imports reuse existing worker concurrency and Docker inspect limits

**Constraints**: No default Docker socket mount; strict non-secret profiles; no protocol change; no plaintext TCP, TLS skip-verify, password-only SSH, or insecure Docker Context variants; UUIDv7 IDs; Zod route validation; OpenAPI/ADR sync

**Scale/Scope**: New `docker_targets` table and target-management route family; `cancelReason` on runs; backend target service; admin target UI; importer form and run-detail updates; Docker importer execution-path changes; documentation and ADR updates

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Single-organization**: Pass — target records are deployment-global; no tenant layer.
- **II. Importer-first**: Pass — importer remains pull-only, core-only, and DB-free; Hub resolution supplies the same non-secret profile the Agent already supplies.
- **III. Two-level taxonomy**: Pass — no taxonomy changes.
- **IV. Environment-as-Instance**: Pass — Docker environment/instance semantics unchanged.
- **V. Factual vs. meaning layer**: Pass — target management is operational configuration, not product meaning.
- **VI. Test-first**: Pass — tasks add failing tests before service, route, resolver, cancellation, and UI behavior.
- **VII. Observability**: Pass — run phase/status, audit events, and existing metrics/logging are extended without secret material.

## Project Structure

### Documentation (this feature)

```text
specs/049-docker-hub-execution/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── docker-targets-api.md
└── tasks.md             # produced by /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
├── contracts/import-run.ts
├── contracts/importer.ts
├── constants/error-codes.ts
├── constants/error-types.ts
├── constants/import-run-cancel-reason.ts
├── schemas/docker-target.ts
└── importer-registry.ts
packages/backend/src/
├── db/migrations/024_docker_hub_targets.ts
├── db/types.ts
├── routes/docker-targets.ts
├── routes/importers.ts
├── services/docker-target-service.ts
├── services/import-run-service.ts
├── services/importer-config-service.ts
├── services/credential-service.ts
├── services/audit-query-service.ts
└── plugins/rbac.ts
packages/importer-docker/src/
├── manifest.ts
├── config.ts
├── target-profile.ts
└── index.ts
packages/frontend/src/
├── api/types.ts
├── api/hooks/docker-targets.ts
├── api/mappers/operations.ts
├── routes.tsx
├── ux/lib/nav.ts
├── ux/app/docker-targets/
├── ux/components/admin/docker-target-form.tsx
├── ux/components/admin/docker-targets-table.tsx
└── ux/components/importers/{importer-form,run-detail}.tsx
docs/
├── openapi.yaml
├── api.md
├── deployment.md
└── importers/docker.md
researches/
├── architecture-decisions.md
└── adrs/ADR-122-docker-hub-execution.md (+ back-pointers on amended ADRs)
```

**Structure Decision**: Use the existing backend service/route/migration/RBAC/audit pattern and the existing frontend API hook + page/component pattern. Docker target storage stays backend-owned; profile semantics stay importer-owned.

## Phase 0 Decisions

See [research.md](./research.md). Resolved plan-level choices:

- API paths are UUID-keyed under `/api/v1/docker-targets`.
- HTTP conflicts are `TARGET_DISABLED` (409) and `TARGET_IN_USE` (409); missing rows use `TARGET_NOT_FOUND` (404); duplicate selectors use `CONFLICT` (409).
- `import_runs.cancelReason` is nullable and limited to `USER_REQUESTED` or `TARGET_DISABLED`.
- Importer manifests may declare `targetProfileSchema` so executors can preflight a profile without importing provider internals.
- Docker Context remains an explicit local-store transport; Hub operators must provision the context store separately.

## Phase 1 Design

See [data-model.md](./data-model.md), [contracts/docker-targets-api.md](./contracts/docker-targets-api.md), and [quickstart.md](./quickstart.md).

### Runtime flow

1. Admin creates a target with `{targetId,label,description?,profile}`. The backend validates `targetId`, display fields, and the profile through the importer manifest’s `targetProfileSchema`; unknown fields fail closed.
2. A Hub Docker config stores only `scope.targetId`. Save/update resolves that selector against `docker_targets`, requires an enabled row, and verifies every `*Key` name in the profile is covered by linked `STORED` credentials.
3. A Hub run re-resolves the row before invoking the importer. `context.resolveTarget(targetId)` returns the already-preflighted profile and rejects mismatched selectors. Disabled/missing/malformed targets fail before Docker access.
4. A Hub credential test resolves the same profile and passes it as `testSecrets(..., resolvedTarget)`. A target test chooses a Hub-bound config for credential context and calls the existing Docker `/version` probe only.
5. Disabling a target updates its state and audit row, then requests cancellation for active Hub runs/tests using it. It does not wait for Docker calls to drain.

### ADR fidelity

Create `ADR-122-docker-hub-execution` for the durable dual-executor and managed-target contract. It amends the closed surfaces in ADR-121, ADR-056, ADR-116, ADR-119, ADR-058, ADR-052, ADR-054, ADR-071, and ADR-077. Add `---` + `**Amended by ADR-122**` back-pointers and update `researches/architecture-decisions.md` in the same change.

## Complexity Tracking

No constitution violations. The feature is broader than a single service because target management, Hub execution, lifecycle cancellation, audit, UX, and public contracts are coupled; splitting them would ship an unusable target manager or an unmanageable execution path.
