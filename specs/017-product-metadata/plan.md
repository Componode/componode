# Implementation Plan: Practical Catalog Metadata

**Branch**: `feature/017-product-metadata` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/017-product-metadata/spec.md`

## Summary

Add the four optional metadata fields ratified in ADR-111 — `links` (JSONB
`{title,url}[]`), `tags` (`text[]` + GIN), `criticality`
(`CRITICAL|HIGH|MEDIUM|LOW`, products only), and `sunsetAt` (timestamptz) —
to `digital_products` and `components`. One additive migration, core
constants/schemas/contracts, backend service + list-filter wiring, frontend
forms/detail badges/links card, `?tag=`/`?criticality=` list filters, and
openapi/docs sync per ADR-104. All fields optional; no backfill; importer
reconciliation never writes curated fields (FR-015).

## Technical Context

**Language/Version**: TypeScript 6 (`typescript@^6.0.3`), Node 24

**Primary Dependencies**: Fastify, Kysely, Zod (backend); React 18, Vite,
TanStack Query, react-hook-form, Tailwind/shadcn (frontend); `packages/core`
shared contracts/schemas/constants

**Storage**: PostgreSQL 14+ — `jsonb` links, `text[]` tags + GIN index,
`timestamptz` sunset date; CHECK constraint for criticality (ADR-079: no
native ENUMs)

**Testing**: Vitest — backend unit + testcontainers integration
(`packages/backend/src/test`), frontend unit (`packages/frontend/src/test`)

**Target Platform**: Docker Compose app (backend serves frontend static)

**Project Type**: web-service + SPA monorepo (pnpm workspaces + Turborepo)

**Performance Goals**: list filters (`?tag=`, `?criticality=`) remain
index-backed; GIN index keeps tag containment queries sub-linear at catalog
scale

**Constraints**: strict Zod schemas — every new field must be registered or
it is rejected (ADR-095); `safeUrl()` re-validation at render (ADR-085);
importer upserts write explicit column lists only (FR-015); no schema
backfill — all columns nullable/defaulted

**Scale/Scope**: 2 tables, 1 migration (`012_practical_metadata.ts`), ~6
core files, ~6 backend files, ~6 frontend files, openapi + docs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Single-Organization, Self-Hosted | PASS | No tenant/organization concepts touched |
| II. Importer-First | PASS | FR-015 — curated fields are never importer-written; reconcile paths write explicit column lists (verified `import-run-service.ts`) |
| III. Two-Level Taxonomy | PASS | `category`/`provider`/`resourceType` unchanged; tags are additive free-form labels, not a taxonomy layer |
| IV. Environment-as-Instance | PASS | No instance/env changes; `sunsetAt` is a date on the logical entity, not lifecycle |
| V. Factual vs. Meaning Layer | PASS | Links/tags/criticality/sunset are human-curated meaning-layer data — exactly the intended split |
| VI. Test-First | PASS | tasks.md phases tests before implementation per story |
| VII. Observability | PASS | No new async paths; audit rows via existing `writeEntityChange` |
| Stack constraints | PASS | Kysely migration, Zod strict, CHECK-from-constant enums, `^x.y.z` deps — no new deps needed |

**Gate result**: PASS — no violations, no justification needed.

## Project Structure

### Documentation (this feature)

```text
specs/017-product-metadata/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api.md           # Endpoint deltas (source of truth: docs/openapi.yaml)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/
├── constants/criticality.ts         # NEW — CRITICALITIES constant (ADR-079)
├── contracts/digital-product.ts     # +links/tags/criticality/sunsetAt, Link type
├── contracts/component.ts           # +links/tags/sunsetAt
└── schemas/
    ├── product.ts                   # +fields on create/update; +tag/criticality on list query
    ├── components.ts                # +tag on list query; extended update schema
    └── metadata.ts                  # NEW — shared linkSchema/tagSchema validators

packages/backend/src/
├── db/migrations/012_practical_metadata.ts   # NEW — additive columns + GIN + CHECK
├── services/
│   ├── product-service.ts           # insert/update/list filters
│   ├── component-catalog-service.ts # list ?tag= filter
│   └── component-group-service.ts   # PATCH accepts curated fields (generalize assign→update)
└── routes/components.ts             # PATCH schema swap

packages/frontend/src/
├── api/types.ts + hooks/products.ts, hooks/components.ts
├── components/products/product-form.tsx    # +fields
├── components/metadata/                    # NEW — LinksEditor, TagsInput, badges
└── pages/product-detail.tsx, component-detail.tsx, products.tsx, components.tsx

docs/openapi.yaml + docs/api.md (regenerated, ADR-104)
```

## Phase 0 — Research

Output: [research.md](./research.md) — all decisions pre-ratified by ADR-111;
research verified the codebase touchpoints (component PATCH surface,
importer write-path confinement, enum constant pattern, safeUrl helper).

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — column shapes, constraints, contract
  field deltas, validation rules
- [contracts/api.md](./contracts/api.md) — endpoint/query/response deltas
- [quickstart.md](./quickstart.md) — runnable validation scenarios

## Post-Design Constitution Re-Check

| Principle | Status |
|---|---|
| I–VII | PASS — design adds no tenant layer, no importer writes to curated
fields, no taxonomy changes, no lifecycle changes; JSONB/`text[]` reuse
established PostgreSQL patterns already in the schema (`details` jsonb) |
