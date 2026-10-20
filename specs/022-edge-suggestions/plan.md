# Implementation Plan: Edge Suggestions

**Branch**: `feature/022-edge-suggestions` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/022-edge-suggestions/spec.md`

## Summary

Implement staged, server-generated `DEPENDS_ON` candidate edges (ADR-113).
A new `edge_suggestions` table persists one row per `(product, component)`
pair with `reason`, `score`, and a terminal-state `status`
(`PENDING`/`ACCEPTED`/`DISMISSED`/`SUPERSEDED`). A generation service
computes the three ratified signals (name containment, topic/tag overlap,
k8s namespace match) from stored catalog data and runs on triggers:
post-import-run, product create/rename, component rename/group moves, and a
manual rescan endpoint. Every successful `DEPENDS_ON` write — including via
the queue itself — upserts a `SUPERSEDED` tombstone, which is what makes
"deliberately unwired pairs never regenerate" implementable. A dedicated
`/suggestions` page lists pending candidates by score with reason chips;
accept calls the unchanged `addDependsOnEdge` path (real edge + audit) and
marks `ACCEPTED`; dismiss marks `DISMISSED` permanently. Reads are open to
all authenticated roles; writes require `product:edge:add` (EDITOR+).

## Technical Context

**Language/Version**: TypeScript 6 (constitution stack table)

**Primary Dependencies**: Fastify + Kysely (backend), Zod (contracts in
`packages/core`), React 18 + TanStack Query + shadcn/ui (frontend). No new
runtime dependencies.

**Storage**: PostgreSQL — new `edge_suggestions` table (migration `014`);
reads `digital_products`, `components`, `product_depends_on_component`,
`product_depends_on_component_group`

**Testing**: Vitest — unit tests (signal scoring, tokenization), frontend
component tests, and testcontainers Postgres integration tests
(`packages/backend/test/integration/`)

**Target Platform**: Node/Fastify API + React SPA served by the backend

**Project Type**: pnpm monorepo web application (`packages/core`,
`packages/backend`, `packages/frontend`)

**Performance Goals**: full-catalog rescan over ~10k components / ~50
products completes in <1 minute (SC-002); post-run scoped generation adds
<1s to a successful import run; queue list responds interactively (<300ms)

**Constraints**: no `sql.raw()` (ADR-084); Zod-strict validation (ADR-095);
audit via existing edge path (ADR-052); `x-permission`/OpenAPI contract
test (ADR-104); terminal statuses enforced at the service layer, not just
the UI

**Scale/Scope**: one migration, one new backend service, one new route
module (4 endpoints), trigger hooks in 3 existing services, one new
frontend page + nav entry, OpenAPI + docs updates

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-organization | ✅ | No tenant concepts touched |
| II. Importer-first | ✅ | Importers unchanged — generation reads stored `components`/`details` server-side; importer contract untouched (ADR-056/057) |
| III. Two-level taxonomy | ✅ | No category/provider changes |
| IV. Environment-as-instance | ✅ | RETIRED lifecycle only used as an exclusion filter, consistent with default-query conventions |
| V. Factual vs. meaning layer | ✅ | Candidates are *staged, human-confirmed* — every real edge still requires an explicit human accept; no auto-wiring (ADR-113 §8 amending ADR-019) |
| VI. Test-first | ✅ | Failing unit/integration/component tests precede implementation (see tasks) |
| VII. Observability | ✅ | Generation passes logged with staged/superseded counts + duration metric; accept produces normal edge audit entries via `writeEdgeChange`; decisions recorded on the row (`decidedAt`/`decidedBy`) |

**Result**: PASS — no violations; Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/022-edge-suggestions/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/api.md     # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/core/src/
├── constants/
│   ├── edge-suggestion.ts           # NEW — EDGE_SUGGESTION_REASON/_STATUS + META
│   └── index.ts                     # export
├── contracts/edge-suggestion.ts     # NEW — EdgeSuggestion, SuggestionQueueItem, RescanReport
├── schemas/suggestions.ts           # NEW — listSuggestionsQuerySchema (status filter)
├── constants/error-codes.ts         # (unchanged — reuse NOT_FOUND/CONFLICT)
└── index.ts                         # export new modules

packages/backend/src/
├── db/
│   ├── migrations/014_edge_suggestions.ts  # NEW — table + CHECKs from core constants
│   ├── check-constraint-helper.ts          # + suggestionReasonCheck/statusCheck
│   └── types.ts                            # + EdgeSuggestionRow, DB.edge_suggestions
├── services/
│   ├── edge-suggestion-service.ts   # NEW — tokenize/signals, generation+merge,
│   │                                #       queue reads, accept/dismiss, rescan
│   ├── import-run-service.ts        # + generateForComponents(yieldedIds) post-COMPLETED
│   ├── product-service.ts           # + generateForProduct on create / name-change update
│   ├── component-group-service.ts   # + generateForComponents on rename / group move
│   └── product-edge-service.ts      # + SUPERSEDED tombstone upsert on every
│                                    #   successful DEPENDS_ON write (incl. group member pairs)
├── routes/
│   ├── suggestions.ts               # NEW — GET list, POST accept/dismiss/rescan
│   └── app.ts                       # register suggestionRoutes
└── test/
    ├── integration/edge-suggestions.test.ts  # NEW — testcontainers
    └── unit/ suggestion-signals.test.ts      # NEW — tokenize/scoring

packages/frontend/src/
├── api/
│   ├── hooks/suggestions.ts         # NEW — useSuggestions, useDecideSuggestion, useRescan
│   └── types.ts                     # + suggestion types
├── pages/suggestions.tsx            # NEW — queue page (list template + state matrix)
├── components/suggestions/          # NEW — suggestion-row.tsx, reason-chip.tsx (if split)
├── components/layout/sidebar.tsx    # + "Suggestions" nav item (Catalog section)
└── test/unit/suggestions.test.tsx   # NEW — page/component tests

docs/
├── openapi.yaml                     # + /suggestions paths (ADR-104)
├── api.md                           # regenerated via docs:api
└── digital-products.md              # + suggestions lifecycle + review flow
```

**Structure Decision**: Existing pnpm workspace layout reused — constants,
contracts, and Zod schemas in `packages/core`; persistence, generation, and
routes in `packages/backend`; queue UI in `packages/frontend`. The new
service mirrors `platform-promotion-service.ts` conventions (service-owned
transactions, `Actor` audit plumbing). Trigger hooks are thin one-liner
calls into `edge-suggestion-service.ts` wrapped so failures log and never
break the host operation.
