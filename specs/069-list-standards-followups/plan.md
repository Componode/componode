# Implementation Plan: Spec-068 follow-ups — e2e spec debt and list-standards cleanup

**Branch**: `069-list-standards-followups` | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/069-list-standards-followups/spec.md`

## Summary

Two workstreams from `researches/list-standards-followups.md`, shipped as one
spec per the clarify session (full scope — e2e debt + all of B.1–B.8):

1. **E2E spec debt (Part A)**: update
   `playwright/tests/journeys/product-map.spec.ts` and
   `playwright/tests/journeys/component-relationships.spec.ts` to the UI
   that actually shipped — topology on the dedicated Map tab (`?tab=map`),
   relationship lanes hidden when empty (commit `7e33ef2`). Ten consistent
   failures become green; no app code changes.
2. **Standards cleanup (Part B)**: unify the four spellings of the 400
   validation envelope onto the existing `validationFailed` helper
   (B.2); extract the duplicated `"all"`-sentinel facet adapter and
   consolidate the two debounced-filter hooks (B.4); replace ~15
   sort-dispatch ternary chains across 14 backend services with
   per-service sort maps (B.3); resolve the dual-signature pagination
   compat hooks by migrating 3 call sites and dropping the shims (B.5);
   populate-or-delete speculative `SummaryRowMap` members and move
   `ImportRun.completedAt` into the view type (B.6); consolidate the
   hardcoded `ENTITY_TYPE_LABELS` into one registry and fix the
   `importer_config` label (B.7); amend `docs/ux.md` §5 with the
   type-only-import carve-out for leaf patterns (B.1); confirm `?status=`
   on suggestions (B.8 — no code).

## Technical Context

**Language/Version**: TypeScript 6 (backend + frontend), React 19 + Vite,
Node per workspace.

**Primary Dependencies**: Fastify + Kysely (backend), TanStack Query 5 +
React Router 7 + Tailwind 4 + shadcn/Radix primitives (frontend), Zod
validation in `packages/core`, Playwright for e2e.

**Storage**: PostgreSQL — no schema changes; all work is route/service/
contract cleanup plus test updates. No migrations.

**Testing**: Vitest unit tests (`packages/*/src/test` or `test/`), backend
integration tests (testcontainers Postgres), Playwright suite in
`playwright/tests/`.

**Target Platform**: Self-hosted Docker Compose deployment; desktop-first
UX per docs/ux.md.

**Project Type**: web-service monorepo (pnpm workspaces + Turborepo).

**Performance Goals**: N/A — refactor/test-debt spec; no new runtime paths.
Preserve existing query shapes (same WHERE/ORDER BY semantics).

**Constraints**: ADR-084 (no `sql.raw()`/`sql.fragment()` — the `sql`
  template tag for sort expressions like `ACTOR_SORT` is the established
  pattern and stays), ADR-095 (Zod `.strict()` at route boundary — unknown
  sort keys must still 400), ADR-104 (`docs/openapi.yaml` unchanged — no
  endpoint changes), docs/ux.md conventions, AGENTS.md test-first rule.

**Scale/Scope**: 2 Playwright spec files; ~15 sort chains in 14 backend
service files; ~20 route files with hand-rolled 400s; 3 frontend hook
adapters + 2 debounced-filter hooks; 1 patterns type file; 1 docs page;
unit/integration/e2e test updates.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Single-org**: N/A — no tenancy touched. PASS
- **II. Importer-first**: N/A — no importer contract changes; sort-map
  refactor touches services only, importers untouched. PASS
- **III. Two-level taxonomy**: N/A — category/provider remain filter/sort
  params only. PASS
- **IV. Environment-as-instance**: N/A — GONE/RETIRED visibility defaults
  preserved (sort maps keep identical ordering semantics). PASS
- **V. Factual vs meaning**: N/A — no edge/model changes. PASS
- **VI. Test-first**: e2e spec updates ARE the failing-test-first artifact
  for Part A; backend/frontend refactors keep existing unit +
  integration coverage green and add coverage where a helper is new;
  Playwright coverage ships in the same change per AGENTS.md. PASS
  (planned)
- **VII. Observability**: no new runtime paths; no logging changes. PASS

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/069-list-standards-followups/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions D1–D10
├── data-model.md        # Phase 1 — helper signatures + sort-map contract
├── contracts/
│   └── cleanup-contracts.md  # Phase 1 — shared helper/hook signatures
├── quickstart.md        # Phase 1 — validation scenarios
├── checklists/
│   └── requirements.md  # spec-quality checklist (all pass)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
playwright/tests/journeys/
├── product-map.spec.ts               # → ?tab=map assertions (FR-001..003)
└── component-relationships.spec.ts   # → populated-lanes-only (FR-004)

packages/backend/src/
├── routes/
│   ├── route-helpers.ts              # canonical validationFailed (exists)
│   └── *.ts                          # ~20 files: hand-rolled 400s → helper
└── services/
    ├── utils or per-service SORT_*   # sort maps replace ternary chains
    └── *.ts (14 files, ~15 chains)   # agent, audit×2, catalog,
                                      #   group, credential, docker-target,
                                      #   edge-suggestion, import-run×2,
                                      #   importer-config, importer-source,
                                      #   org×2, product, session, user

packages/frontend/src/
├── api/hooks/
│   ├── list-facet.ts (new)           # shared facetParam("all"-sentinel) helper
│   ├── components.ts / products.ts / audit.ts   # adopt shared helper
│   ├── suggestions.ts                # drop offset/limit dual signature
│   └── audit.ts                      # drop normalizeFeedQuery legacy path
├── ux/
│   ├── hooks/use-debounced-param.ts (new or extend use-list-search)
│   ├── app/activity.tsx              # useDebouncedFilter → shared hook
│   ├── app/products/$slug.tsx        # useSuggestions → page/pageSize
│   ├── components/app/app-sidebar.tsx# useSuggestions → page/pageSize
│   ├── lib/view-types.ts             # ImportRun.completedAt; org/suggestion
│   │                                 #   real fields promoted from intersections
│   ├── components/patterns/title-with-summary.tsx  # SummaryRowMap cleanup
│   └── app/activity.tsx              # ENTITY_TYPE_LABELS → shared registry
└── ux/lib/entity-type-labels.ts (new)# single label registry (B.7)

docs/ux.md                            # §5 mapper-rule carve-out (B.1)
```

**Structure Decision**: standard pnpm workspace layout — route helpers stay
in `backend/src/routes/route-helpers.ts`, sort maps live beside each
service (or a shared `utils/sort.ts` if a common shape emerges), frontend
shared helpers under `api/hooks/` and `ux/lib/`. No new packages, no new
runtime dependencies, no API or schema changes.

## Phase breakdown (for tasks.md)

1. **E2E spec debt**: rewrite `product-map.spec.ts` for the Map tab
   (FR-001..003) and `component-relationships.spec.ts` for hidden empty
   lanes (FR-004); run both spec files green on all projects (FR-005).
2. **B.2 validation unification**: migrate every hand-rolled 400 site
   (agents, importers, audit, auth, component-groups, components,
   credentials, docker-targets `invalid()`, agent-channel, sessions,
   users, org, products, suggestions, url-checks — full inventory at
   implementation) to `validationFailed`; canonical message "Invalid
   input".
3. **B.3 sort maps**: per-service `Record<SortKey, orderable>` replacing
   ternary chains; shared application helper where the shape repeats;
   audit's `sql`-expression sorts (`ACTOR_SORT`, `ENTITY_TYPE_SORT`)
   become map values; edge-suggestion's conditional effective-sort
   becomes an explicit map + view-dependent default.
4. **B.4 frontend adapters**: shared `facetParam` helper; adopt in
   components/products/audit param builders; consolidate
   `useDebouncedFilter` + `useListSearch` into one hook.
5. **B.5 compat hooks**: migrate `products/$slug.tsx` and
   `app-sidebar.tsx` to `page`/`pageSize`; drop `useSuggestions`
   positional signature and `normalizeFeedQuery` legacy translation;
   update unit tests.
6. **B.6 type hygiene**: promote real fields into view types
   (`ImportRun.completedAt`, org `productCount`/`teamCount`, suggestion
   `score`/`status`/`createdAt` where the API already returns them),
   delete `SummaryRowMap` intersections and speculative members.
7. **B.7 label registry**: single `ENTITY_TYPE_LABELS` registry under
   `ux/lib/`; fix `importer_config` → "Importer config"; activity page
   consumes it.
8. **B.1 docs carve-out**: amend `docs/ux.md` §5 — type-only entity
   imports permitted in leaf display patterns; value imports still
   forbidden; verify no runtime `@/api/types` imports in patterns.
9. **B.8**: recorded in spec clarifications — no code.
10. **Verification**: package lint/typecheck/test/build for backend +
    frontend; targeted `pnpm e2e` for the two spec files; docs checks
    (`docs:sidebar:check`, `docs:oracle:check` if docs touched).

## Complexity Tracking

> No constitution violations — section intentionally empty.
