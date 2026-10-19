# Implementation Plan: Catalog Bootstrap

**Branch**: `feature/021-catalog-bootstrap` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/021-catalog-bootstrap/spec.md`

## Summary

Implement the ratified cold-start package (ADR-114, ADR-110 amendment,
research plan items 1.1/1.3/2.1):

1. **`POST /api/v1/products/bootstrap`** — accepts a YAML/JSON document
   (`{version: 1, products: [...]}`), validates the whole document strictly
   (per-item errors, zero writes on failure), then applies best-effort:
   products upserted by derived slug with merge semantics, `DEPENDS_ON` edges
   wired from resolved component refs, per-item atomicity, and a
   `{created, updated, edgesAdded, skipped}` report. `?dryRun=true` previews.
2. **Create-product-from-components** — `POST /api/v1/products` accepts an
   optional `componentIds[]` that is wired atomically with creation; the
   components list gains multi-select + a "Create product" action.
3. **Bulk picker** — the `DEPENDS_ON` edge picker becomes multi-select for
   components, submitting the already-shipped `componentIds[]` union input.

No new architecture decisions; the endpoint shape, file schema, report shape,
and upsert semantics are ratified in ADR-114 and clarified in spec.md. No DB
migration is required — every write lands on existing tables.

## Technical Context

**Language/Version**: TypeScript 6 (constitution stack table)

**Primary Dependencies**: Fastify + Kysely (backend), `yaml@^2.9.1` (already a
backend dependency — used to parse the upload), Zod (contracts in
`packages/core`), React 18 + TanStack Query + shadcn/ui (frontend)

**Storage**: PostgreSQL — existing `digital_products`,
`product_depends_on_component`, `line_of_businesses`, `teams`, `components`
tables; no migration

**Testing**: Vitest — unit tests (`packages/core` schema, frontend components)
and testcontainers Postgres integration tests
(`packages/backend/test/integration/product-bootstrap.test.ts`)

**Target Platform**: Node/Fastify API + React SPA served by the backend

**Project Type**: pnpm monorepo web application (`packages/core`,
`packages/backend`, `packages/frontend`)

**Performance Goals**: a 200-product document applies in <1 minute (SC-001);
ref resolution is batched — O(1) queries for all refs, not per-item

**Constraints**: 1 MB request-body limit (`app.ts`) bounds document size;
no `sql.raw()` (ADR-084); Zod-strict validation at the boundary (ADR-095);
audit per product/edge change (ADR-052)

**Scale/Scope**: one new endpoint, one extended endpoint, one extended schema,
one new backend service, three touched frontend surfaces, OpenAPI + docs
updates (ADR-104)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-organization | ✅ | No tenant concepts touched |
| II. Importer-first | ✅ | Bootstrap is a curated one-shot write through entity/edge services — no `DiscoveredAsset`, no importer package, no scheduling (ADR-114 §4) |
| III. Two-level taxonomy | ✅ | No category/provider changes |
| IV. Environment-as-instance | ✅ | No instance semantics touched |
| V. Factual vs. meaning layer | ✅ | The document is human-authored curation — exactly the meaning-layer input constitution V protects; not auto-derivation |
| VI. Test-first | ✅ | Failing schema/integration/component tests precede implementation (see tasks) |
| VII. Observability | ✅ | Route inherits request logging; every write audited via `writeEntityChange`/`writeEdgeChange` |

**Result**: PASS — no violations; Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/021-catalog-bootstrap/
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
├── schemas/product.ts               # + bootstrapDocumentSchema, + componentIds on createProductSchema
├── contracts/ (or schemas export)     # + BootstrapReport / BootstrapSkippedItem types
└── index.ts                         # export new schema + types

packages/backend/src/
├── routes/products.ts               # + POST /products/bootstrap (yaml parser + dryRun query)
├── services/
│   ├── catalog-bootstrap-service.ts # NEW — parse/validate/resolve/apply + report
│   └── product-service.ts           # createProduct: wire optional componentIds in same tx
└── test/integration/
    └── product-bootstrap.test.ts    # NEW — testcontainers coverage

packages/frontend/src/
├── api/hooks/products.ts            # + useBootstrapProducts(dryRun), componentIds in ProductFormInput
├── api/types.ts                     # + BootstrapReport types
├── pages/products.tsx               # + "Import products" button + dialog
├── pages/components.tsx             # + row selection + "Create product" action
├── components/products/
│   ├── import-products-dialog.tsx   # NEW — file → dry-run preview → apply → report
│   ├── product-form.tsx             # + componentIds prop ("wires N components")
│   └── edge-picker.tsx              # + component multi-select → componentIds[]

docs/
├── openapi.yaml                     # + /products/bootstrap, + componentIds on POST /products (ADR-104)
├── api.md                           # regenerated via docs:api
└── digital-products.md              # workflow documentation update
```

**Structure Decision**: Existing pnpm workspace layout is reused — contracts in
`packages/core`, API in `packages/backend`, UI in `packages/frontend`. The
bootstrap service is a new file beside `platform-promotion-service.ts`, which
it mirrors (transaction-per-write + audit-row conventions).
