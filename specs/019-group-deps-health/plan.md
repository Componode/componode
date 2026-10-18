# Implementation Plan: Group Dependencies & Product Health

**Branch**: `feature/019-group-deps-health` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/019-group-deps-health/spec.md`

## Summary

Implement the two ratified-but-unbuilt Phase-0 decisions packaged by this
spec. **ADR-110**: `DEPENDS_ON` gains a `ComponentGroup` target — one
junction migration (`product_depends_on_component_group`), a strict
exactly-one-of union schema on `POST /products/:id/depends-on`
(`componentId` | `componentGroupId` | `componentIds[]`, incl. the 2026-10-18
bulk amendment), read-time expansion with per-source attribution and dedup,
a `?kind=` discriminator on the DELETE route, `component_group` audit
targets, and delete guards in both directions (product guard counts group
edges; group guard blocks hard-delete while depended-on — clarified
2026-10-18). **ADR-112**: derived product health — a pure aggregation in
`packages/core` (worst-of non-`GONE` instances over declared dep sources,
`PRODUCTION` headline, `RETIRED`-component exclusion, null-when-empty) wired
into product detail (`health`), product list (`status`), and the dashboard
attention section (`PRODUCT_ERROR` items).

## Technical Context

**Language/Version**: TypeScript 6 (`typescript@^6.0.3`), Node 24

**Primary Dependencies**: Fastify, Kysely, Zod (backend); React 18, Vite,
TanStack Query, Tailwind/shadcn (frontend); `packages/core` shared
contracts/schemas/constants. No new dependencies.

**Storage**: PostgreSQL 14+ — one new junction table
`product_depends_on_component_group(productId FK→cascade, componentGroupId
FK→cascade, PK(productId, componentGroupId), createdAt)`, mirroring
`product_depends_on_component` (ADR-048). Health is derived per read — no
storage (ADR-112).

**Testing**: Vitest — `packages/core` unit tests for the pure aggregation;
`packages/backend/test/integration` (testcontainers Postgres) for routes,
expansion, guards, audit; `packages/frontend/src/test/unit` for picker /
detail / dashboard rendering; `test/contract` keeps openapi↔route
enforcement.

**Target Platform**: Docker Compose app (backend serves frontend static)

**Project Type**: web-service + SPA monorepo (pnpm workspaces + Turborepo)

**Performance Goals**: list-row health and dashboard attention computed in a
constant number of queries regardless of product count (batch-fetch edges +
group members + instances once, aggregate in memory — no N+1); expansion is
single-hop (groups cannot nest)

**Constraints**: strict Zod union — exactly one of the three input forms
(ADR-095); `GET` side-effect-free (ADR-094); Kysely parameterized only
(ADR-084); openapi.yaml updated in the same change (ADR-104); no
`dangerouslySetInnerHTML` (ADR-085)

**Scale/Scope**: 1 migration (`013_product_depends_on_group.ts`), ~4 core
files, ~6 backend files, ~6 frontend files, openapi + docs sync

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Single-Organization, Self-Hosted | PASS | No tenant concepts touched |
| II. Importer-First | PASS | FR-020 — importer contract untouched; group membership stays human-declared (`components.componentGroupId` curated) |
| III. Two-Level Taxonomy | PASS | No taxonomy changes |
| IV. Environment-as-Instance | PASS | Rollup reads `ComponentInstance.status` + `Component.lifecycle` — the split is preserved, never conflated; `GONE` excluded |
| V. Factual vs. Meaning Layer | PASS | All edges human-authored; expansion is a read projection of curated edges, not auto-derivation |
| VI. Test-First | PASS | tasks.md phases tests before implementation per story; core aggregation unit tests + backend integration + frontend unit |
| VII. Observability | PASS | No new async/instrumented paths; audit rows via existing `writeEdgeChange`; routes ride existing request logging |
| Stack constraints | PASS | Kysely migration, CHECK-from-constant conventions n/a (no new enums stored), strict Zod, no new deps, `docs/openapi.yaml` same-change (ADR-104) |

**Gate result**: PASS — no violations, no justification needed.

## Project Structure

### Documentation (this feature)

```text
specs/019-group-deps-health/
├── plan.md              # This file
├── research.md          # Phase 0 output — ratified decisions + mechanics
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api.md           # Endpoint deltas (source of truth: docs/openapi.yaml)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/
├── schemas/product.ts            # addDependsOnEdgeSchema → union (exactly-one-of)
├── contracts/digital-product.ts  # ProductHealth / ProductHealthStatus / DepSource types
├── contracts/component-group.ts  # ComponentGroupListItem + memberCount
├── product-health.ts             # NEW: pure aggregation (unit-testable)
└── index.ts                      # re-exports

packages/backend/src/
├── db/migrations/013_product_depends_on_group.ts  # NEW junction
├── db/types.ts                   # table type
├── services/
│   ├── product-edge-service.ts   # union add, kind-aware remove, bulk txn+audit
│   ├── product-service.ts        # expansion + dedup + sources[]; health wiring;
│   │                             # dependsOnGroups in detail; delete guard +group edges
│   ├── product-health-service.ts # NEW: batch load + per-product compute
│   ├── component-group-service.ts# memberCount in list; delete guard (FR-009)
│   └── dashboard-service.ts      # PRODUCT_ERROR attention items
└── routes/products.ts            # DELETE ?kind= passthrough (route unchanged, query added)

packages/frontend/src/
├── api/types.ts                  # DepSource, ProductHealth, status, memberCount,
│                                 # AttentionItem +PRODUCT_ERROR
├── api/hooks/products.ts         # useRemoveEdge kind param
├── components/products/edge-picker.tsx   # group options "(group · N)"
├── components/products/product-tree.tsx  # health badge on list rows
├── pages/product-detail.tsx      # health badge + per-env popover; group
│                                 # deps block + remove; Via column → sources
└── pages/dashboard.tsx           # PRODUCT_ERROR attention rendering

docs/
├── openapi.yaml                  # same-change updates (ADR-104)
├── api.md                        # regenerated via docs:api
└── digital-products.md           # group targets + health semantics
```

**Structure Decision**: Follows the established monorepo split — shared
contracts/schemas/pure logic in `packages/core` (leaf), persistence +
services in `packages/backend`, UI in `packages/frontend`. The pure health
aggregation lives in `packages/core` so it is unit-testable with zero DB
fixtures; batching/query work stays in `packages/backend`.

## Post-Design Constitution Re-Check

| Principle | Status | Notes |
|---|---|---|
| I–VII + stack | PASS | Design artifacts below introduce nothing outside ratified ADRs; expansion is read-only Kysely joins, guards are service-level with cascade FKs as safety net (existing convention) |

## Phase 1 Artifacts

- [research.md](./research.md) — decision log (ratified + mechanics)
- [data-model.md](./data-model.md) — junction table, response projections
- [contracts/api.md](./contracts/api.md) — endpoint deltas
- [quickstart.md](./quickstart.md) — end-to-end validation scenarios
