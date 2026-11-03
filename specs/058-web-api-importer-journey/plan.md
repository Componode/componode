# Implementation Plan: Web/API importer profiles and managed URL Checks

**Branch**: `058-web-api-importer-journey` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/058-web-api-importer-journey/spec.md`

## Summary

Replace the one-URL Web/API importer scope with a collection of named
Component profiles, environment-specific ComponentInstances, and one managed
URL Check definition per instance. Importer packages continue to emit
`DiscoveredAsset` only. The core synchronizes inventory and managed check
definitions from the validated ImporterConfig scope. URL Check scheduling and
observation history remain separate from importer runs. After the first URL
Check observation, its executed outcome is authoritative for the monitored
ComponentInstance status and therefore feeds the existing Product health
rollup.

## Technical Context

- **Language/Version**: TypeScript 6
- **Primary Dependencies**: Fastify, Kysely, Zod, React, Vite, TanStack Query, React Router, Tailwind, shadcn/ui
- **Storage**: PostgreSQL with Kysely migrations and CHECK constraints
- **Testing**: Vitest unit/integration tests, importer validation harness, Playwright for critical user journeys
- **Target Platform**: Self-hosted Docker Compose deployment; Hub and Import Agent execution remain supported
- **Project Type**: pnpm monorepo web application with importer workspaces
- **Performance Goals**: Preserve per-asset incremental import commits and bounded URL Check list reads; do not add one observations request per rendered check row
- **Constraints**: Importers remain database-free; core owns config-to-catalog/check synchronization; one durable ImporterSource per collection; URL Check manual writes are retired; secret values remain in the Credential store
- **Scale/Scope**: Two importer packages, one nested profile/instance builder, core run/config synchronization, Source/check memberships, URL Check status propagation, migration of existing Web/API configs, user/API documentation

## Constitution Check

**Pre-design gate**: PASS

- **I — Single-Organization, Self-Hosted**: No tenant or organization partition is introduced.
- **II — Importer-First**: Importer packages remain pull-only and database-free. Core performs Component, ComponentInstance, Source membership, and URL Check persistence.
- **III — Two-Level Taxonomy**: Web/API category and provider assignments remain unchanged.
- **IV — Environment-as-Instance**: One Component profile maps to one logical Component with multiple ComponentInstances. `GONE` remains source-reconciliation state; lifecycle and operational status stay distinct.
- **V — Factual vs. Meaning Layer**: Importers continue to report factual inventory only; no DigitalProduct edges are added.
- **VI — Test-First**: Each implementation story begins with failing tests. Importer tests continue to exercise `validateDiscoveredAsset`.
- **VII — Observability from Day One**: Existing importer-run and URL Check metrics/logging remain; status transitions use the audit model without secrets or unbounded metric labels.

**Post-design gate**: PASS. The changed URL Check status source and importer-managed ownership are ratified by ADR-126 and its amendments; no Constitution principle changes.

**Ratified in**: ADR-126; amendments to ADR-014, ADR-037, ADR-047, ADR-054, ADR-071, ADR-077, ADR-103, ADR-112, ADR-119, ADR-123, ADR-124, and ADR-125.

## Architecture and Data Flow

1. The ImporterConfig scope is canonical for Component profiles, instances,
   and managed check definitions.
2. Each importer reports its stable collection Source identity before the
   first yield, then yields one `DiscoveredAsset` per Component profile with
   all configured instances.
3. Importer packages remain pull-only. The core validates each asset, upserts
   Components and instances, records Source memberships, and synchronizes
   managed URL Check definitions in the same per-asset unit of work.
4. The URL Check scheduler independently dispatches scheduled probes and
   records observations. URL Check records hold operational scheduling state;
   ImporterConfig holds the canonical managed definition.
5. The importer keeps its one-shot discovery request. It seeds initial
   ComponentInstance status and discovery details. Once a managed check has
   an observation, the importer status value is ignored and check outcomes
   become authoritative for that instance.
6. A complete configured inventory reaches `COMPLETED` even when individual
   endpoints produce `ERROR` instances. Only completed runs reconcile Source
   memberships. An instance becoming `GONE` with no effective Source
   membership loses its managed URL Check and observations.

## Project Structure

### Documentation (this feature)

```text
specs/058-web-api-importer-journey/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── importer-config-scope.md
│   ├── managed-url-check-sync.md
│   └── api-deltas.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source areas affected by the future implementation

```text
packages/importer-web-url/
packages/importer-api-url/
packages/core/src/contracts/
packages/core/src/schemas/
packages/core/src/validation/
packages/core/src/constants/
packages/backend/src/db/migrations/
packages/backend/src/db/types.ts
packages/backend/src/services/importer-config-service.ts
packages/backend/src/services/import-run-service.ts
packages/backend/src/services/importer-source-service.ts
packages/backend/src/services/url-check-service.ts
packages/backend/src/services/url-check-scheduler.ts
packages/backend/src/routes/importers.ts
packages/backend/src/routes/components.ts
packages/backend/src/routes/url-checks.ts
packages/agent/src/
packages/agent/test/
packages/frontend/src/ux/components/importers/
packages/frontend/src/ux/components/catalog/
packages/frontend/src/ux/app/importers/
packages/frontend/src/api/hooks/
packages/frontend/src/api/mappers/
packages/frontend/src/ux/lib/flags.ts
packages/frontend/src/test/unit/
packages/backend/test/integration/
docs/openapi.yaml
docs/importers/web-url.md
docs/importers/api-url.md
docs/url-checks.md
docs/using-the-catalog.md
docs/ux.md
CONTEXT.md
researches/ux-rewrite-gaps.md
researches/adrs/
researches/architecture-decisions.md
```

**Structure Decision**: Keep importer-specific parsing and validation in the
two existing importer packages. Keep database synchronization, Source/check
membership reconciliation, status propagation, and migrations in the
core-owned run path. Frontend forms and views remain under existing UX/API
mapper seams. No new package or runtime dependency is needed.

## Phase 0 — Research Decisions

Research and binding decisions are recorded in [`research.md`](research.md).
Key findings:

- `ImporterConfig.scope` has no built-in versioned migration. A config
  migration is required; changing `manifest.version` alone does not transform
  stored scope.
- `ImporterSource` is one per config. A generated, durable collection key
  survives URL edits and permits reattachment after config deletion.
- `componentKey`, `instanceKey`, and managed check keys remain stable across
  editable names, URLs, and environment edits. Reusing them across Sources
  intentionally shares catalog/check records.
- Managed URL Check definitions are synchronized by core; URL Check rows
  retain scheduler state and observations. A typed Source-to-URL-Check
  membership supports sharing and source-scoped cleanup.
- The importer remains responsible for a one-shot discovery request; the
  URL Check scheduler remains responsible for repeated observations.
- A URL Check result updates ComponentInstance status only after the first
  observation. `MISSED`, no-data, and disabled states preserve the last
  status; `GONE` remains a reconciliation outcome.
- Direct URL Check writes and manual Component-create check payloads return
  the deprecated-write error. Component monitoring-setup defaults remain.
- No `PARTIAL` run status is added. Endpoint failures are represented on
  evaluated instances, and only a complete inventory reconciles.

## Phase 1 — Data Model and Contracts

See [`data-model.md`](data-model.md) for profile, instance, Source, managed
check, observation, and status-transition invariants. The contracts are:

- [`contracts/importer-config-scope.md`](contracts/importer-config-scope.md):
  strict profile/instance/check scope, stable keys, safe URLs, method/auth
  rules, and one-to-one migration shape.
- [`contracts/managed-url-check-sync.md`](contracts/managed-url-check-sync.md):
  core-owned synchronization, shared Source ownership, enable/auto-disable
  precedence, status propagation, and GONE cleanup.
- [`contracts/api-deltas.md`](contracts/api-deltas.md): deprecated direct
  writes, manual Component-create monitoring rejection, read behavior, and
  OpenAPI synchronization.

`docs/openapi.yaml` remains canonical under ADR-104. Deprecated write methods
stay documented with their controlled `410 URL_CHECK_WRITE_DEPRECATED`
response; `docs/api.md` is regenerated from the OpenAPI source.

## Phase 2 — Validation

[`quickstart.md`](quickstart.md) defines runnable validation scenarios for
profile creation, Source reattachment, complete-run reconciliation, shared
check ownership, status propagation, migration, and check lifecycle.
Implementation tasks must be test-first and cover importer contracts,
backend integration, frontend unit behavior, docs checks, and the critical
Playwright journey.

## Complexity Tracking

No Constitution violations. The new typed Source-to-URL-Check membership,
managed key, ComponentInstance status propagation, and deprecated manual
write surfaces are deliberate changes ratified by ADR-126; a polymorphic
edge table or importer package database access is not introduced.
