# Implementation Plan: Product Package Roll-up

**Branch**: `080-product-package-rollup` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/080-product-package-rollup/spec.md`

## Summary

Aggregate `bom_entries` across a product's reachable component set (direct
`DEPENDS_ON`, group-expanded `DEPENDS_ON`, and `COMPOSES`-inherited edges) into
a per-product package inventory — a new **Packages** tab on product detail,
backed by two authenticated, side-effect-free GETs
(`GET /products/:slug/packages`, `GET /products/:slug/packages/consumers`).
The backend reuses the spec-074 `purlIdentity` grouping, scoped to the
product's reachable components, plus a declared-dependency signal (package
row's matched Library component ∈ reachable set, with DepSource attribution),
a coverage summary (N of M components reporting), and per-row freshness
(`lastReportedAt` + `staleThresholdDays`). The frontend mirrors the
`/packages` explorer patterns (toolbar, filters, sort, expand-to-consumers)
inside a flag-gated product tab (`productPackageRollup`, gap G41).

## Technical Context

**Language/Version**: TypeScript (Node 20+), pnpm workspaces + Turborepo

**Primary Dependencies**: Fastify + Kysely (backend), React/Vite + TanStack
Query + React Router + Tailwind/shadcn (frontend), Zod (route schemas)

**Storage**: PostgreSQL — read-only over `bom_entries`, `components`,
`component_instances`, `product_depends_on_component`,
`product_depends_on_component_group`, `component_group_members`,
`product_composes`, `component_depends_on_component`, `app_settings`.
**No migration** — derived projection, nothing stored.

**Testing**: Vitest unit + integration (backend/frontend), Playwright e2e
(workload spec under `playwright/tests/`).

**Target Platform**: Docker Compose self-hosted web app.

**Performance Goals**: Bounded reads — server pagination (ADR-130); the
reachable-set computation is a 3-query CTE walk identical in cost to the
existing product detail read; grouping queries add `componentId IN (…)`
scoping on indexed `bom_entries.componentId`/`purlIdentity`.

**Constraints**: ADR-094/097 (authenticated, side-effect-free GETs),
ADR-095 (strict Zod), ADR-104 (openapi.yaml in the same change), D8 (no
security-posture tones), flag governance (hidden, never disabled).

**Scale/Scope**: Products up to ~200 reachable components / ~50k entries per
spec SC-003 — same bounded-read budget as `/packages`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
|---|---|---|
| I. Single-Organization | PASS | Workspace-scoped read, no tenant layer. |
| II. Importer-First | PASS | Read-only aggregation of importer-reported data. |
| III. Two-Level Taxonomy | PASS | Reuses `DepSource` DIRECT/GROUP/INHERITED semantics; no new relationship type. |
| IV. Environment-as-Instance | PASS | Merged-view parity: instance-level entries merge to component identity; no lifecycle/status conflation (ACTIVE components only in the contributing set, D5). |
| V. Factual vs. Meaning Layer | PASS | BOM entries remain factual inventory; the declared marker reads existing curated edges — it never writes or auto-wires. |
| VI. Test-First | PASS | tasks.md orders failing tests before implementation; Playwright coverage required per repo policy. |
| VII. Observability | PASS | Standard list reads; no new background work. |
| Stack / workflow / security ADRs | PASS | Kysely parameterized only (ADR-084); Zod at boundary (ADR-095); `{code,message,details?}` errors (ADR-071); no secrets in logs; GET side-effect-free (ADR-094). |

No violations → no Complexity Tracking entries.

## Design Decisions

1. **Reachable set extraction**: pull the descendant/dep-scope queries out of
   `getProductDetail` into a shared `productComponentScope(productId)` helper
   (returns `Map<componentId, DepSource[]>` plus component fields), used by
   both the detail read and the new service — one truth for reachability,
   no semantic drift.
2. **Contributing set = ACTIVE reachable components** (D5 parity): RETIRED
   reachable components are excluded from aggregation and from the coverage
   denominator; the product itself may be RETIRED and still readable.
3. **Route shape**: `/products/:slug/packages[/consumers]` — slug-addressed
   like `GET /products/:slug`; `purl` stays a query param (never a path
   segment — purls contain `:` `/` `@`, research read contract).
4. **Declared signal**: per package row, resolve the matched catalog
   component with the same two-step rule as `listPackages`
   (`resolvedComponentId` → verbatim `externalId` = purl identity), then
   look it up in the scope map: membership → `declared` with DepSource
   attribution; non-membership/absence → undeclared. No new match rule.
5. **Coverage + freshness**: response carries `coverage {reporting,total}`
   (reachable ACTIVE components with ≥1 entry vs total) and
   `staleThresholdDays` from `app_settings` (settings-service getter);
   frontend reuses `isStale`.
6. **Flag**: `productPackageRollup` (`flagOverride(…) ?? true`), registered
   as gap **G41** in `researches/ux-rewrite-gaps.md` and the `docs/ux.md`
   flag table; gates the tab (hidden, never disabled). Backend routes stay
   ungated like the rest of the BOM read contract.
7. **Consumers panel**: parameterize the shared consumers-table internals
   (`package-consumers.tsx`) rather than fork — product variant adds the
   DepSource attribution column.
8. **No ADR**: the feature adds derived reads over existing tables; no
   entity, lifecycle, or contract surface changes. Precedent: spec 074.
   `docs/roadmap.md` gains the shipped entry at ship time.

## Project Structure

### Documentation (this feature)

```text
specs/080-product-package-rollup/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── product-packages.md   # Read contracts for the two endpoints
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/core/src/
├── contracts/product-packages.ts      # NEW: response/row types (DepSource reuse)
├── schemas/packages.ts                # EXTEND: product query schemas
└── index.ts                           # EXTEND: exports

packages/backend/src/
├── services/product-service.ts        # REFACTOR: extract productComponentScope
├── services/product-dep-scope.ts      # NEW: shared reachable-set helper
├── services/product-packages-service.ts # NEW: list + consumers reads
└── routes/products.ts                 # EXTEND: two GETs

packages/frontend/src/
├── api/hooks/product-packages.ts      # NEW: query hooks + list params
├── api/mappers/packages.ts            # EXTEND: product view mapper
├── ux/lib/flags.ts                    # EXTEND: productPackageRollup (G41)
└── ux/components/products/
    ├── product-detail.tsx             # EXTEND: Packages tab
    └── product-packages.tsx           # NEW: tab panel (mirrors packages page)
    └── catalog/package-consumers.tsx  # REFACTOR: shared consumers internals

docs/
├── openapi.yaml                       # EXTEND (ADR-104)
├── api.md                             # REGENERATED via docs:api
├── ux.md                              # EXTEND: flag table row
└── roadmap.md                         # EXTEND at ship

researches/ux-rewrite-gaps.md          # EXTEND: G41 entry
specs/… (tests): packages/backend/test/integration/product-packages*.test.ts
playwright/tests/…                     # NEW e2e spec for the tab
```

**Structure Decision**: mirrors spec 074's package-explorer seams — core
contracts/schemas, a dedicated backend service, route registration on the
existing products router, and a frontend tab reusing the explorer's
list/expand patterns.

## Complexity Tracking

> No Constitution Check violations — section intentionally empty.
