# Implementation Plan: Catalog Coverage & Hygiene

**Branch**: `feature/023-coverage-and-hygiene` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/023-coverage-and-hygiene/spec.md`

## Summary

Read-only catalog-completeness derivations — zero new persisted state. A
new `catalog-coverage-service.ts` owns three shared derivations so the
metrics, filters, and chips can never disagree:

1. **Wired component set** — `ACTIVE` components reached by a `DEPENDS_ON`
   edge (direct `product_depends_on_component` or group-expanded via
   `product_depends_on_component_group` + `components.componentGroupId`)
   from a non-retired product; built as a shared SQL subquery used by both
   the coverage count and the `wired` list filter.
2. **Dependency surface** — the set of non-retired products whose surface
   is non-empty: own `DEPENDS_ON` (direct or group target), own
   `CONSUMES_FROM`, or a `DEPENDS_ON` declared by a non-retired `COMPOSES`
   descendant (recursive CTE, same direction as the detail page's
   Inherited view). Shared by the missing-deps metric, the `missing`
   filter, and the chip.
3. **Product completeness** — `{owner, description, dependencies}`
   booleans per product row, attached server-side exactly where `status`
   (health) is already attached.

`GET /dashboard/summary` gains a `coverage` section and the attention feed
gains `SUNSET_OVERDUE_PRODUCT`/`SUNSET_OVERDUE_COMPONENT` kinds ranked
below every operational kind. `GET /components` gains a `wired` facet
param; `GET /products` gains a `missing` facet param (`owner`,
`dependencies`, `description` — OR within the facet, consistent with
existing faceted filters) plus `completeness` and `consumedByCount` on each
row. `GET /products/{slug}` gains `completeness`; the platform consumer
count derives from the existing `consumedBy` array. Frontend adds the
dashboard coverage tiles (each linking to its filtered worklist), a
"Wiring" facet on components, a "Completeness" facet on products, a
completeness chip on product rows and the detail header, "consumed by N
products" on PLATFORM rows, and attention labels/badges for the sunset
kinds.

## Technical Context

**Language/Version**: TypeScript 6 (constitution stack table)

**Primary Dependencies**: Fastify + Kysely (backend), Zod (contracts in
`packages/core`), React 18 + TanStack Query + shadcn/ui (frontend). No new
runtime dependencies.

**Storage**: PostgreSQL — reads only across `digital_products`,
`components`, `product_depends_on_component`,
`product_depends_on_component_group`, `product_composes`,
`product_consumes_from`. **No migration** — every value is derived per
read.

**Testing**: Vitest — backend integration tests with testcontainers
Postgres (`packages/backend/test/integration/`) for coverage/filter/
attention semantics, unit tests for the surface computation, frontend
component tests (`packages/frontend/src/test/unit/`)

**Target Platform**: Node/Fastify API + React SPA served by the backend

**Project Type**: pnpm monorepo web application (`packages/core`,
`packages/backend`, `packages/frontend`)

**Performance Goals**: dashboard summary remains interactive (<300ms) —
coverage adds ~4 aggregate queries; product list already computes
per-product health — the surface map is the same order of work; component
`wired` filter is a pair of `EXISTS`/`NOT EXISTS` subqueries on indexed
junction tables

**Constraints**: no `sql.raw()`/`sql.fragment()` (ADR-084) — Kysely
parameterized only; Zod-strict query params (ADR-095); `GET`s
side-effect-free (ADR-094); readable by any authenticated role (ADR-097);
`docs/openapi.yaml` updated in the same change with route/param coverage
enforced by the backend contract test (ADR-104); no scorecard aggregation
(research §5 non-goal)

**Scale/Scope**: one new backend service; edits to dashboard,
component-catalog, and product services + 2 route modules; core query
schema + contract additions; frontend: dashboard section, 2 facets, a
chip component, row/detail surfacing, attention labels; OpenAPI + docs
updates. No migration, no new route modules, no new endpoints.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-organization | ✅ | No tenant concepts touched |
| II. Importer-first | ✅ | Importers and the importer contract untouched — derivations read stored data only |
| III. Two-level taxonomy | ✅ | No category/provider changes |
| IV. Environment-as-instance | ✅ | `RETIRED` lifecycle used only as an exclusion filter, matching default-query conventions; no lifecycle/status conflation |
| V. Factual vs. meaning layer | ✅ | Metrics describe curation completeness; nothing auto-wires or mutates the meaning layer |
| VI. Test-first | ✅ | Failing integration/unit/component tests precede implementation (see tasks) |
| VII. Observability | ✅ | Read-only aggregations on already-instrumented routes; no new runtime paths needing spans |

**Result**: PASS — no violations; Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/023-coverage-and-hygiene/
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
├── contracts/catalog-coverage.ts      # NEW — CatalogCoverage, ProductCompleteness
├── schemas/components.ts              # + `wired` param on listComponentsQuerySchema
├── schemas/product.ts                 # + `missing` param on listProductsQuerySchema
└── index.ts                           # export additions

packages/backend/src/
├── services/
│   ├── catalog-coverage-service.ts    # NEW — wired-component subquery,
│   │                                  #       dependency-surface map,
│   │                                  #       getCatalogCoverage()
│   ├── dashboard-service.ts           # + coverage section, + SUNSET_OVERDUE_*
│   │                                  #   attention items (ranked last, shared cap)
│   ├── component-catalog-service.ts   # + `wired` filter (shared subquery)
│   └── product-service.ts             # + `missing` filter, + completeness +
│                                      #   consumedByCount on rows & detail
├── routes/
│   ├── components.ts                  # pass `wired` through (schema-validated)
│   └── products.ts                    # pass `missing` through (schema-validated)
└── test/
    ├── integration/catalog-coverage.test.ts  # NEW — testcontainers: metrics,
    │                                         #   filters, sunset attention
    └── unit/dependency-surface.test.ts       # NEW — surface semantics edge cases

packages/frontend/src/
├── api/
│   ├── types.ts                       # + CatalogCoverage, ProductCompleteness,
│   │                                  #   attention kinds, row fields
│   ├── hooks/components.ts            # + `wired` on ComponentListFilters
│   └── hooks/products.ts              # + `missing` on ProductListParams
├── pages/
│   ├── dashboard.tsx                  # + Catalog coverage tiles → filtered
│   │                                  #   lists; + sunset attention labels
│   ├── products.tsx                   # + "Completeness" facet (missing=…)
│   └── product-detail.tsx             # + chip in header; platform consumer count
├── components/
│   ├── component-filters.tsx          # + "Wiring" facet (wired/unwired)
│   ├── products/product-tree.tsx      # + chip + "consumed by N" on PLATFORM rows
│   └── products/completeness-chip.tsx # NEW — owner/description/deps indicators
└── test/unit/
    ├── catalog-coverage.test.tsx      # NEW — dashboard tiles + attention kinds
    └── completeness-chip.test.tsx     # NEW — facet semantics

docs/
├── openapi.yaml                       # + coverage schema, wired/missing params,
│                                      #   completeness/consumedByCount, kinds (ADR-104)
├── api.md                             # regenerated via docs:api
└── ux.md                              # §10 dashboard intent — coverage section
```

**Structure Decision**: Existing pnpm workspace layout reused — filter
param schemas and shared contract types in `packages/core`; one new
derivation service + surgical additions to the three existing services in
`packages/backend`; list/dashboard surfaces in `packages/frontend`. The
coverage service mirrors `product-health-service.ts` conventions (a
read-only projection service consumed by sibling services), keeping the
"wired" and "dependency surface" definitions in exactly one place so
metric, filter, and chip semantics stay identical by construction.
