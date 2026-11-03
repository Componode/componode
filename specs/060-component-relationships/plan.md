# Implementation Plan: Read-only Component Relationships

**Branch**: `060-component-relationships` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/060-component-relationships/spec.md`

## Summary

Add a read-only Relationships tab to Component detail. The view reads the
existing typed Component-to-Component junctions, reverses Product-owned
`DEPENDS_ON` relationships for presentation, annotates group-mediated Product
paths, and nests ComponentInstances as operational children. It reuses the
Product Map's interaction/accessibility patterns but not its graph module or
Product-specific semantics.

## Technical Context

- **Language/Version**: TypeScript 6
- **Primary Dependencies**: Fastify, Kysely, Zod, React, Vite, TanStack Query, React Router, Tailwind, shadcn/ui
- **Storage**: PostgreSQL; existing typed relationship tables and ComponentInstance FK
- **Testing**: Vitest frontend unit/integration tests, backend integration/contract tests, Playwright workload
- **Target Platform**: Self-hosted web dashboard; desktop-first, usable at 768px
- **Project Type**: Monorepo web application
- **Performance Goals**: Bounded relationship read independent of displayed node count; no per-node request fan-out
- **Constraints**: Read-only; one-hop +N; no polymorphic edge table; no automatic relation inference; default visibility follows current Component/detail rules
- **Scale/Scope**: One focused Component, typed direct relations, direct/group-mediated Product dependents, and nested ComponentInstances

## Constitution Check

**Pre-design gate**: PASS

- **I — Single-Organization, Self-Hosted**: No tenant model changes.
- **II — Importer-First**: Importers do not gain relationship writes; persisted relationships are read only.
- **III — Two-Level Taxonomy**: Component taxonomy is unchanged.
- **IV — Environment-as-Instance**: ComponentInstances remain owned operational occurrences nested under a Component; URL Check status mapping follows ADR-126.
- **V — Factual vs. Meaning Layer**: Product dependencies remain human-authored; the view only presents direct/group paths.
- **VI — Test-First**: Backend relation fixtures and frontend direction/accessibility tests precede implementation.
- **VII — Observability from Day One**: The feature is read-only; existing request logging/metrics cover the read path.

**Post-design gate**: PASS. ADR-128 ratifies a typed read-only view and does not authorize relationship writes.

**Ratified in**: ADR-016, ADR-048, ADR-103, ADR-126, and ADR-128.

## Research Summary

See [`research.md`](research.md). The relationship junction tables exist in the
database but have no application read/write surface. Product dependents are
available through an existing read path, but it omits group-mediated
attribution. The Component detail read returns non-GONE instances. The new
view must not imply that Component-to-Component relationships are being
created or inferred.

## Data Model and Contract

See [`data-model.md`](data-model.md) and
[`contracts/component-relationships-read.md`](contracts/component-relationships-read.md).
No polymorphic persistence model or new relation type is added. The API gains
one authenticated, side-effect-free relationship read that returns typed
groups and explicit Product group provenance.

## Project Structure

### Documentation (this feature)

```text
specs/060-component-relationships/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── component-relationships-read.md
├── quickstart.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source areas affected by the future implementation

```text
packages/backend/src/routes/components.ts
packages/backend/src/services/component-catalog-service.ts
packages/backend/src/services/platform-promotion-service.ts
packages/backend/test/integration/component-detail.test.ts
packages/backend/test/integration/components.test.ts
packages/frontend/src/api/types.ts
packages/frontend/src/api/hooks/components.ts
packages/frontend/src/api/mappers/catalog.ts
packages/frontend/src/ux/app/components/$slug.tsx
packages/frontend/src/ux/components/catalog/component-detail.tsx
packages/frontend/src/ux/components/catalog/component-relationships.tsx
packages/frontend/src/ux/lib/flags.ts
packages/frontend/src/test/unit/
playwright/tests/
docs/openapi.yaml
docs/ux.md
docs/using-the-catalog.md
researches/ux-rewrite-gaps.md
researches/adrs/
researches/architecture-decisions.md
```

**Structure Decision**: Add a typed read service and response mapper for
Component relationships. Keep the UI module domain-specific, with separate
typed lanes. Do not generalize the Product Map into a graph framework and do
not add write services.

## UX-Gap Governance

The read endpoint and Component-to-Component application surface are missing
today. The implementation must add a detailed UX-gap entry and matching
feature flag before rendering the new tab. Until the read capability exists,
the fallback is a defined notice/hidden tab, never invented relations.

## Validation Strategy

[`quickstart.md`](quickstart.md) covers direction, group provenance, instance
nested status, empty states, accessibility, responsive behavior, and the
no-write contract. Implementation tasks use failing backend route/fixture
tests first, then frontend keyboard and Playwright coverage.

## Complexity Tracking

No Constitution violations. The separate read contract is justified by the
missing Component relationship read surface. Existing typed junction tables
and ComponentInstance foreign keys remain the persistence model.
