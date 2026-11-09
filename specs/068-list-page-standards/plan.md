# Implementation Plan: Standardized list pages — server-side pagination, sorting, filters, hover summaries

**Branch**: `068-list-page-standards` | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/068-list-page-standards/spec.md`

## Summary

Every primary list page moves from fetch-all + client-side filtering to
server-side pagination (`page`/`pageSize` 25/50/100, default 25), column
sorting, URL-synced table state, server-side search/filters, and HoverCard
title summaries — unified on the spec-003 `{data, pagination}` envelope.
Backend: ~18 list endpoints gain the shared list contract via new core
schema helpers; suggestions/audit migrate envelopes; three folded
correctness fixes land; ADR-130 amends ADR-080/081. Frontend: new shared
patterns (`useListState`, `ListPagination`, sortable headers, toolbar fix,
summary hover) applied per page; no new dependencies.

## Technical Context

**Language/Version**: TypeScript 6 (backend + frontend), React 19 + Vite,
Node per workspace.

**Primary Dependencies**: Fastify + Kysely (backend), TanStack Query 5 +
React Router 7 + Tailwind 4 + shadcn/Radix primitives (frontend), Zod
validation in `packages/core`.

**Storage**: PostgreSQL — no schema changes; all work is query/service/
contract layer. No migrations.

**Testing**: Vitest unit tests (`packages/*/test` or `src/test`),
backend integration tests (testcontainers Postgres), Playwright suite in
`playwright/tests/`.

**Target Platform**: Self-hosted Docker Compose deployment; desktop-first
UX per docs/ux.md.

**Project Type**: web-service monorepo (pnpm workspaces + Turborepo).

**Performance Goals**: list pages issue exactly one collection request on
load; no sequential page loops; first paint bounded by one page of rows.

**Constraints**: ADR-084 (no `sql.raw`/`sql.fragment` — Kysely only),
ADR-095 (Zod `.strict()` at route boundary), ADR-104 (`docs/openapi.yaml`
in same change), docs/ux.md conventions (state matrix, mapper rule,
ListToolbar/PageHeader anatomy), spec-003 envelope, ADR-130 contract.

**Scale/Scope**: ~18 backend endpoints, ~12 frontend list surfaces, 3
backend bugfixes, 1 new ADR + 2 amendments, openapi + generated docs,
Playwright coverage.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Single-org**: N/A — no tenancy touched. PASS
- **II. Importer-first**: N/A — no importer contract changes. PASS
- **III. Two-level taxonomy**: N/A — category/provider remain enums used
  only as filter/sort params. PASS
- **IV. Environment-as-instance**: GONE/RETIRED visibility defaults
  preserved; the `worstStatus` fix *strengthens* the
  lifecycle/status separation (ADR-127 Amend. 2). PASS
- **V. Factual vs meaning**: N/A — read-path only. PASS
- **VI. Test-first**: regression tests precede fixes; every touched
  endpoint gets integration coverage; Playwright specs per AGENTS.md.
  PASS (planned)
- **VII. Observability**: no new runtime paths; list endpoints already
  instrumented. PASS

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/068-list-page-standards/
├── plan.md              # This file
├── research.md          # Phase 0 — 15 decisions D1–D15
├── data-model.md        # Phase 1 — contract entities (no DB changes)
├── contracts/
│   └── list-contract.md # Phase 1 — per-endpoint params/sort/search tables
├── quickstart.md        # Phase 1 — validation scenarios
├── checklists/
│   └── requirements.md  # spec-quality checklist (all pass)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/
├── schemas/             # + shared listParamsSchema base; per-endpoint
│                        #   sort enums/search/filter extensions
└── (types)              # + Paginated<T> envelope type

packages/backend/src/
├── routes/              # list routes: safeParse → 400 (fix component-groups,
│                        #   users); pass parsed query to services
└── services/            # per-domain list services: WHERE filters,
                         #   whitelisted sort map + id tiebreak,
                         #   count query, page slice, envelope
                         #   (+ catalog-coverage/product/org/audit fixes)

packages/frontend/src/
├── api/
│   ├── hooks/           # per-entity list hooks → list-state params;
│   │                    #   envelope-typed responses
│   ├── mappers/         # envelope unwrap where needed
│   └── types.ts         # Paginated<T> response types
└── ux/
    ├── lib/             # + list-state types/defaults
    ├── hooks/           # + useListState, useDebouncedValue
    └── components/
        ├── patterns/    # + ListPagination, SortableHeader,
        │                #   TitleWithSummary; ListToolbar fix
        └── catalog|products|admin|org|sources|agents|importers/
                         #   per-page table rewiring

researches/adrs/
├── ADR-130-standardized-list-contract.md   # new
├── ADR-080-pagination-strategy.md          # + Amendment 1
└── ADR-081-filtering-and-sorting.md        # + Amendment 1
researches/architecture-decisions.md        # index + back-pointers

docs/openapi.yaml          # every touched endpoint (ADR-104)
docs/api.md                # regenerated via docs:api
playwright/tests/          # pagination/sort/filter/hover coverage
```

**Structure Decision**: standard pnpm workspace layout — shared contract
in `core`, services/routes in `backend`, patterns + pages in
`frontend/src/ux`. No new packages, no new runtime dependencies.

## Phase breakdown (for tasks.md)

1. **Core contract**: shared list-params schema + `Paginated<T>` +
   per-endpoint schema extensions (components first as reference).
2. **Backend services/routes**: components (sort keys, search, bugfixes),
   then products, groups/org/users/sessions/agents/credentials/docker/
   importer-configs+runs+errors+changes/sources, suggestions, audit.
3. **ADR-130 + amendments + openapi.yaml + docs:api**.
4. **Frontend infrastructure**: `useListState`, `useDebouncedValue`,
   `ListPagination`, `SortableHeader`, `ListToolbar` fix, summary hover
   pattern, API hook/type updates.
5. **Page rollout**: components → products → groups/org → admin
   (users/sessions/credentials) → agents/sources/docker-targets →
   importers (configs/runs/errors/changes) → suggestions/activity.
6. **Tests**: backend integration per family, frontend unit, Playwright.

## Complexity Tracking

> No constitution violations — section intentionally empty.
