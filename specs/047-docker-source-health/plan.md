# Implementation Plan: Docker Source Health Observations and ImporterSource UI

**Branch**: `047-docker-source-health` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/047-docker-source-health/spec.md`

## Summary

Wave D of the Docker importer program. Three deliverables:

1. **Health-aware instance status + persisted observation**
   (`@componode/importer-docker`): extend `ContainerInspect` with
   `State.Health`/`OOMKilled`/`Restarting`/`FinishedAt` (never
   `Health.Log`), emit an allowlisted `rawConfig.dockerObservation`
   snapshot, and replace Wave C's engine-state-only mapping with the
   state×health→status table in `contracts/docker-observation.md`.
   `component_instances.rawConfig` and status passthrough already exist —
   no migration, no backend service change; the ADR-112 rollup consumes
   `ERROR` automatically (verified by a new backend integration test).
2. **Generic ImporterSource UI** (`@componode/frontend`): `/sources` +
   `/sources/$id` routes under the existing "Sources" nav section,
   mirroring the agents surface (list table + tabbed detail: overview,
   runs, memberships, activity; ADMIN-gated retire/reactivate).
   Exclusively the existing `/importer-sources*` API — no new endpoints.
3. **Observation render + tag suggestions** (`@componode/frontend`):
   `rawConfig` carried through types/mappers onto an expandable instance
   row in component detail; `component.details` carried through for
   user-confirmed `compose:<project>`/`service:<project>.<service>`
   suggestion chips in the edit dialog (core `tagSchema` filters;
   invalid omitted, never auto-written).

Ratified in the same change: **ADR-121 Amendment 1** (observation
allowlist + status table). Docs: `docs/importers/docker.md`,
`docs/openapi.yaml` (`instances`/`ComponentInstance` schema),
`docs/roadmap.md`.

## Technical Context

**Language/Version**: TypeScript 5.x, Node ≥ 20 (workspace standard)

**Primary Dependencies**: existing stack only — `dockerode` (importer),
Kysely/Fastify (backend — no changes expected), React 18 + TanStack
Query + shadcn/ui + React Router (frontend), `zod`/`@componode/core`
`tagSchema` (suggestion filtering)

**Storage**: PostgreSQL — `component_instances.rawConfig` jsonb (existing
column, no migration); `importer_sources`/`import_runs`/membership tables
(all shipped in spec 044/045)

**Testing**: vitest — importer unit tests (status table, observation
emit, `validateDiscoveredAsset`), backend integration
(`docker-import.test.ts` extension: unhealthy → ERROR → rollup degrade),
frontend unit tests (sources views, suggestions, observation render)

**Target Platform**: self-hosted web app (Fastify API + Vite SPA)

**Project Type**: pnpm monorepo — `packages/importer-docker`,
`packages/frontend`, `packages/backend` (tests only), `packages/core`
(read-only reuse of `tagSchema`, contracts)

**Performance Goals**: none beyond existing — inspect fan-out already
concurrency-bounded; observation adds O(1) fields per instance

**Constraints**: strict data-minimization allowlist (never `Health.Log`,
test commands, stats, events, inspect JSON, history); no new API
endpoints; GET side-effect-free; suggestion writes only on user save;
tag grammar enforced via core `tagSchema`

**Scale/Scope**: ~3 packages touched; no DB migration; ~2 contract
docs; 1 ADR amendment

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Evidence |
|---|---|---|
| I. Single-Organization, Self-Hosted | PASS | no tenancy surfaces touched |
| II. Importer-First | PASS | importer changes confined to `packages/importer-docker` (core-only deps); `validateDiscoveredAsset` exercised |
| III. Two-Level Taxonomy | PASS | observation lives on `ComponentInstance`; no new categories |
| IV. Environment-as-Instance | PASS | status/observation on the instance, env from existing mapping |
| V. Factual vs. Meaning | PASS | tag suggestions are human-confirmed in the edit flow — no importer-declared meaning edges; Source UI exposes provenance, not curation |
| VI. Test-First (NON-NEGOTIABLE) | REQUIRED | tasks order failing tests before implementation per phase |
| VII. Observability from Day One | PASS | no new operational surface needing metrics; Source UI surfaces existing audit/run history |

Post-design re-check: unchanged — no violations, Complexity Tracking not
required.

## Project Structure

### Documentation (this feature)

```text
specs/047-docker-source-health/
├── plan.md                    # This file
├── research.md                # R1–R8 decisions
├── data-model.md              # observation payload, source/membership shapes, tag derivation
├── quickstart.md              # validation scenarios
├── contracts/
│   ├── docker-observation.md  # allowlist + state×health→status table (ADR-121 A1 input)
│   └── frontend-surfaces.md   # routes/nav, sources UI, observation render, suggestions, openapi sync
├── checklists/requirements.md # spec quality (16/16)
└── tasks.md                   # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/
├── importer-docker/
│   ├── src/mapping.ts         # ContainerInspect Health/OOM fields, dockerObservation, status table
│   └── test/                  # mapping/status/observation unit tests (validateDiscoveredAsset)
├── frontend/
│   ├── src/api/{types.ts,hooks/importer-sources.ts,mappers/}
│   ├── src/ux/{lib/{view-types.ts,domain.ts,nav.ts},routes.tsx}
│   ├── src/ux/app/sources/{index.tsx,$id.tsx}
│   ├── src/ux/components/sources/{sources-view,sources-table,source-detail}.tsx
│   ├── src/ux/components/catalog/{component-detail.tsx,component-edit-dialog.tsx}
│   └── src/test/unit/         # sources views, observation render, suggestions
├── backend/
│   └── test/integration/docker-import.test.ts  # unhealthy→ERROR→rollup degrade
└── core/                      # read-only: tagSchema, contracts (no changes expected)

docs/importers/docker.md       # observation fields, status rules, exclusions
docs/openapi.yaml              # GET /components/{id} instances + ComponentInstance schema
researches/adrs/ADR-121-*.md   # Amendment 1 + architecture-decisions.md index
```

**Structure Decision**: pnpm workspace per ADR-065 — importer logic in
`packages/importer-docker` only; all UI in `packages/frontend` over the
existing HTTP API; `packages/core` reused read-only; `packages/backend`
touched only for the rollup-verification integration test.

## Complexity Tracking

No constitution violations — table intentionally empty.
