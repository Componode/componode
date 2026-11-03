# Implementation Plan: Product Map topology in Dependencies

**Branch**: `059-product-map-topology` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/059-product-map-topology/spec.md`

## Summary

Move the read-only Product Map topology into the top of Dependencies while
retaining existing edge-authoring/list controls below. Render one-hop Product
and ComponentGroup relations with correct source/target direction, include
`consumedBy`, and use a bounded Product detail read for related-node health
and Component counts. The existing Components tab remains the catalog surface
for individual Component dependencies.

## Technical Context

- **Language/Version**: TypeScript 6
- **Primary Dependencies**: React 18, Vite, TanStack Query, React Router, Tailwind, shadcn/ui, Fastify, Kysely
- **Storage**: PostgreSQL; no new persistent entity is required
- **Testing**: Vitest frontend unit tests, backend integration/contract tests, existing Playwright workload
- **Target Platform**: Self-hosted web dashboard; desktop-first, usable at 768px
- **Project Type**: Monorepo web application
- **Performance Goals**: Fetch related Product details in a bounded batch; no request-per-node fan-out
- **Constraints**: Read-only topology; preserve all returned relation kinds; use existing status metadata/tokens; maintain WCAG 2.1 AA and reduced-motion behavior
- **Scale/Scope**: One-hop Product and ComponentGroup relations; maximum four visible nodes per lane before local `+N` expansion

## Constitution Check

**Pre-design gate**: PASS

- **I — Single-Organization, Self-Hosted**: No tenancy or organization model changes.
- **II — Importer-First**: No importer behavior changes.
- **III — Two-Level Taxonomy**: No categories or providers change.
- **IV — Environment-as-Instance**: Product health continues to use ComponentInstance status under ADR-112; the importer/URL Check status model is defined by ADR-126.
- **V — Factual vs. Meaning Layer**: Product/Component relationships remain human-authored; the canvas only reads them.
- **VI — Test-First**: Relation-direction, API, frontend accessibility, and responsive tests precede implementation.
- **VII — Observability from Day One**: No new runtime write path is introduced; existing read/API observability remains.

**Post-design gate**: PASS. ADR-127 amends ADR-118 and ADR-103; it does not add graph authoring or a new relationship type.

**Ratified in**: ADR-112, ADR-118 Amendment 1, ADR-127, and ADR-103.

## Research Summary

See [`research.md`](research.md). The implementation must use the existing
product detail read rather than a new graph service, but extend that read with
related Product fields needed for the inspection panel. SQL direction is
confirmed by `getProductDetail`: `composedBy` selects parents by `childId`,
`composes` selects children by `parentId`, `consumesFrom` selects platform
targets of the focused consumer, and `consumedBy` selects consumers of the
focused Platform.

## Data Model and Contract

See [`data-model.md`](data-model.md) and
[`contracts/product-map-read.md`](contracts/product-map-read.md).
No schema migration is planned. The existing `GET /products/:slug` response
gains related Product `health`, `criticality`, and `componentCount` fields in
one bounded read. Relation directions and ComponentGroup targets remain
typed; no polymorphic edge model is introduced.

## Project Structure

### Documentation (this feature)

```text
specs/059-product-map-topology/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── product-map-read.md
├── quickstart.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source areas affected by the future implementation

```text
packages/backend/src/services/product-service.ts
packages/backend/test/integration/products.test.ts
packages/frontend/src/api/types.ts
packages/frontend/src/api/mappers/catalog.ts
packages/frontend/src/ux/app/products/$slug.tsx
packages/frontend/src/ux/components/products/product-detail.tsx
packages/frontend/src/ux/components/products/product-map.tsx
packages/frontend/src/test/unit/
playwright/tests/
docs/openapi.yaml
docs/ux.md
researches/adrs/ADR-118-product-map-canvas.md
researches/adrs/ADR-127-product-map-topology-in-dependencies.md
researches/architecture-decisions.md
```

**Structure Decision**: Keep the Product Map in the existing product-detail
surface. The read contract is extended on the current detail path, and the
frontend mapper remains the sole conversion seam from API to view types.
No graph library or new package is introduced.

## UX-Gap Governance

Related Product health/count fields are missing from Product refs, so the new
panel must not render fabricated values while the read contract is absent.
The implementation must add the matching UX gap/flag entry before exposing
the topology panel and flip the flag only when the bounded read contract is
available.

## Validation Strategy

[`quickstart.md`](quickstart.md) covers product relation direction, null
health, empty/partial states, keyboard navigation, `+N` expansion, responsive
layout at 768px, reduced motion, and the complete read-only Product journey.
Implementation tasks use failing API/frontend tests first, then add the
OpenAPI response contract and regenerate documentation.

## Complexity Tracking

No Constitution violations. The read response extension and topology
interactions are justified by the user-approved redesign and are recorded in
ADR-127; all writes remain in the existing edge-authoring controls.
