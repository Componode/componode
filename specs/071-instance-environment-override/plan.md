# Implementation Plan: Manual environment override for ComponentInstances

**Branch**: `071-instance-environment-override` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/071-instance-environment-override/spec.md` (approach ratified in design discussion: override flag, environment-only scope, existing enum values)

## Summary

Give catalog users a human override layer over `component_instances.environment`. Today the column is purely importer-reported: there is no instance-update API, and every import run rewrites it from the discovered asset — so a missing or wrong environment (e.g. Docker's `OTHER` fallback when no label is present) is unfixable by humans.

The design adds three nullable columns — `environmentOverride`, `environmentOverriddenBy`, `environmentOverriddenAt` — beside the existing `environment` column, which keeps its exact current semantics (the importer-reported/baseline value, still rewritten on every run). The **effective** environment is `COALESCE(environmentOverride, environment)`, computed at API serialization. A new `PATCH /component-instances/{id}` endpoint sets or clears (`environment: null`) the override under the existing `component:update` permission, audit-logged via `writeEntityChange`. The component detail page's instances table gains an environment editor for EDITOR+ users plus override provenance (badge + reported value + reset).

Key design win: **the import/reconciliation path needs zero changes** — importers keep writing the factual `environment` column untouched; the override is a separate meaning-layer annotation (constitution V). Identity is untouched: slug, externalId, memberships, and URL-check bindings never change (FR-008).

## Technical Context

**Language/Version**: TypeScript 6 (backend/core/frontend), Zod 4 schemas

**Primary Dependencies**: Fastify + Kysely (existing), `writeEntityChange` audit, `requireRole("component:update")`, React/TanStack Query, Radix Select/Dialog (existing UX primitives)

**Storage**: PostgreSQL — migration `031_instance_environment_override`: 3 nullable columns on `component_instances` + CHECK constraint on `environmentOverride` built from core `ENVIRONMENTS` (same pattern as `component_instances_environment_check` in migration 001)

**Testing**: Vitest unit + integration (testcontainers Postgres) under `packages/backend/test/`; frontend unit tests under `packages/frontend/src/test/unit/`; Playwright under `playwright/tests/journeys/`

**Target Platform**: Componode hub backend + React frontend; `packages/agent` and all `packages/importer-*` untouched

**Project Type**: web-service (pnpm monorepo)

**Performance Goals**: N/A — single-row PATCH + serialization mapping; no new queries on hot paths

**Constraints**: import path unchanged (factual layer pristine); override is per-instance; environment is the only overridable field; no new error codes or roles; `environment` in API payloads becomes the *effective* value (backward-compatible semantics — it is what consumers already treat as "the environment")

**Scale/Scope**: 1 migration, 1 new route + service function, 1 core schema, serialization mapping at instance payload sites, openapi.yaml + regenerated api.md, ~4 frontend files, docs + ADR-034 amendment, backend/frontend/Playwright tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-org | PASS | No tenancy surface. |
| II. Importer-first | PASS | Importers stay pull-only and untouched — `DiscoveredAsset` contract unchanged; the override lives entirely in the hub's storage/serialization layer. |
| III. Two-level taxonomy | PASS | No category/provider/resourceType changes; reuses existing `ENVIRONMENTS` enum incl. `OTHER`. |
| IV. Environment-as-instance | PASS | Environment remains a `ComponentInstance` attribute — no `environment` on `Component`, no lifecycle/status conflation. |
| V. Factual vs. meaning | PASS | This is the principled core of the design: `environment` column stays the importer-reported *fact* (still rewritten every run); the override columns are the human *meaning-layer* annotation. Reported value is never erased — provenance preserved (FR-003). Precedent: spec 058's check-owned `status` and spec 054's manual instances. ADR-034 amendment documents the field-ownership split. |
| VI. Test-first | PASS | tasks.md sequences failing tests first: backend integration (set/clear/persist-across-run/guards/audit), frontend unit (dialog/badge/reset), Playwright journey (UI edit + post-import persistence). |
| VII. Observability | PASS | PATCH route inherits Fastify request logging; override set/clear audit-logged via `writeEntityChange`; no new uninstrumented paths. |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/071-instance-environment-override/
├── plan.md              # This file
├── research.md          # Phase 0 output — decision record
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/
├── core/src/
│   ├── schemas/components.ts           # updateComponentInstanceSchema {environment: enum|null}
│   └── contracts/component-instance.ts # ComponentInstance + override/provenance fields
├── backend/src/
│   ├── db/migrations/031_instance_environment_override.ts  # NEW
│   ├── db/types.ts                     # ComponentInstanceRow +3 columns
│   ├── services/component-instance-service.ts  # updateComponentInstanceEnvironment + serializer
│   ├── services/component-catalog-service.ts   # getComponentById instance mapping
│   ├── services/component-group-service.ts     # composite-create instance response mapping
│   ├── services/component-relationship-service.ts # instance payloads (if emitted)
│   └── routes/components.ts           # PATCH /component-instances/:id (or components route file)
├── frontend/src/
│   ├── api/types.ts                    # ComponentInstance + fields
│   ├── api/hooks/                      # useUpdateComponentInstance mutation
│   └── ux/components/catalog/          # component-detail.tsx env editor + badge;
│                                       #   docker-details.tsx reported-value display
├── importer-*/                          # UNTOUCHED
└── agent/                               # UNTOUCHED

playwright/tests/journeys/               # instance-environment spec (new or extended)
docs/openapi.yaml                        # PATCH path + ComponentInstance schema fields
researches/adrs/ADR-034-*.md             # amendment: environment field-ownership split
```

**Structure Decision**: standard monorepo layout — core contract/schema, backend service+route+migration, frontend types/hooks/UX, Playwright journey, generated docs. No new packages or top-level dirs.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None — all gates pass.
