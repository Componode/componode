# Implementation Plan: Platform Product Workflow

**Branch**: `feature/020-platform-product-workflow` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-platform-product-workflow/spec.md`

## Summary

Implement ratified ADR-017 — the full guided Platform Product workflow — with
zero schema changes. **Detection**: a read-only projection in a new
`platform-promotion-service` lists components with direct `DEPENDS_ON` edges
from ≥2 distinct non-`RETIRED` products (`PLATFORM` dependents count like any
product; group-expanded reach does not count), exposed as
`GET /components/platform-candidates` and rendered as a dashboard card.
**Promotion**: `POST /components/:id/promote-to-platform` runs one bounded
transaction — create the `PLATFORM` product (name/slug/metadata/owners from a
strict Zod input, slug auto-derived with deterministic `-2`/`-3` suffixing),
insert its `DEPENDS_ON` edge to the component, then rewrite each selected
consumer's `DEPENDS_ON` edge into `CONSUMES_FROM` → platform (consumer
checklist submitted as `consumerIds[]`; absent = all active direct consumers)
— with entity + per-edge audit rows in the same transaction. `GET
/components/:id/dependents` feeds the dialog's all-checked-by-default
checklist from both entry points (dashboard card, component detail page).

## Technical Context

**Language/Version**: TypeScript 6 (`typescript@^6.0.3`), Node 24

**Primary Dependencies**: Fastify, Kysely, Zod, `uuidv7` (backend); React 18,
Vite, TanStack Query, React Router, Tailwind/shadcn (frontend);
`packages/core` shared contracts/schemas/constants. No new dependencies.

**Storage**: PostgreSQL 14+ — **no migration**. Reuses `digital_products`,
`product_depends_on_component`, `product_consumes_from` (UUID v7 ids as SQL
parameters per ADR-045; unique `slug` per ADR-046). Candidates and dependents
are read-time projections — nothing persisted (ADR-048 junction tables
unchanged).

**Testing**: Vitest — `packages/backend/test/integration` (testcontainers
Postgres) for detection counting rules, the promotion transaction, audit
coverage, guards, RBAC; `packages/frontend/src/test/unit` for the candidates
card and promote dialog; `test/contract` keeps openapi↔route enforcement.

**Target Platform**: Docker Compose app (backend serves frontend static)

**Project Type**: web-service + SPA monorepo (pnpm workspaces + Turborepo)

**Performance Goals**: candidate detection is one grouped join over
`product_depends_on_component` (no N+1); promotion is one transaction with
N deletes + N inserts + audit rows — bounded per ADR-017

**Constraints**: strict Zod at the route boundary (ADR-095); `GET` endpoints
side-effect-free (ADR-094); Kysely parameterized only (ADR-084); openapi.yaml
updated in the same change (ADR-104); no `dangerouslySetInnerHTML`, URLs via
`safeUrl()` (ADR-085); authenticated routes, promotion at EDITOR+ (ADR-054/097);
error responses `{code, message, details?}` with controlled codes (ADR-071)

**Scale/Scope**: ~2 core files, ~4 backend files, ~5 frontend files, openapi +
docs sync; 1 backend integration test file, ~2 frontend unit test files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Single-Organization, Self-Hosted | PASS | No tenant concepts touched |
| II. Importer-First | PASS | Importer contract untouched — the workflow is entirely in the curated meaning layer (FR-014) |
| III. Two-Level Taxonomy | PASS | No taxonomy changes |
| IV. Environment-as-Instance | PASS | Detection/rewrite touch product→component edges only; `RETIRED` exclusions follow existing default-query conventions; lifecycle/status split preserved |
| V. Factual vs. Meaning Layer | PASS | Constitution V explicitly permits "the Platform Product workflow (ADR-017) as a human-guided action" — every edge change is human-confirmed, nothing auto-derived |
| VI. Test-First | PASS | tasks.md phases integration tests before implementation per story; testcontainers cover the transaction + audit path |
| VII. Observability | PASS | No new async/instrumented paths; audit rows via existing `writeEdgeChange`/`writeEntityChange`; routes ride existing request logging |
| Stack constraints | PASS | Kysely parameterized queries, strict Zod, no new deps, `docs/openapi.yaml` same-change (ADR-104), `{code,message,details?}` errors (ADR-071) |

**Gate result**: PASS — no violations, no justification needed.

## Project Structure

### Documentation (this feature)

```text
specs/020-platform-product-workflow/
├── plan.md              # This file
├── research.md          # Phase 0 output — decision log (ratified + mechanics)
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── api.md           # Endpoint deltas (source of truth: docs/openapi.yaml)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/
├── schemas/product.ts        # promoteToPlatformSchema (strict, createProduct fields
│                             # minus type + consumerIds[])
├── contracts/digital-product.ts  # PlatformCandidate / ComponentDependent /
│                                 # PromoteToPlatformResult types
└── index.ts                  # re-exports

packages/backend/src/
├── services/
│   └── platform-promotion-service.ts  # NEW: listPlatformCandidates,
│                                     # listComponentDependents,
│                                     # promoteComponentToPlatform (one txn)
└── routes/components.ts      # GET /components/platform-candidates,
                              # GET /components/:id/dependents,
                              # POST /components/:id/promote-to-platform

packages/frontend/src/
├── api/types.ts              # PlatformCandidate, ComponentDependent, promote types
├── api/hooks/components.ts   # usePlatformCandidates, useComponentDependents,
│                             # usePromoteComponent
├── components/products/
│   └── promote-to-platform-dialog.tsx  # NEW: name/slug/metadata + OwnerPickers
│                                       # + consumer checklist (all-checked)
├── pages/dashboard.tsx       # "Platform candidates" section (hidden when empty)
└── pages/component-detail.tsx          # "Promote to platform" action (EDITOR+,
                                        # ACTIVE components)

docs/
├── openapi.yaml              # 3 new paths, same change (ADR-104)
├── api.md                    # regenerated via docs:api
└── digital-products.md       # workflow description matches implementation
```

**Structure Decision**: Follows the established monorepo split — request
schema + response contracts in `packages/core` (leaf), the detection query and
promotion transaction in one new backend service (keeps `product-edge-service`
untouched; the rewrite is a workflow, not a new edge primitive), routes on the
existing `components` router (candidates and dependents are component views;
promotion is a component-addressed action), dialog + dashboard card in
`packages/frontend` reusing `OwnerPickers`, `Dialog`, and hook conventions.

## Post-Design Constitution Re-Check

| Principle | Status | Notes |
|---|---|---|
| I–VII + stack | PASS | Design artifacts introduce nothing outside ratified ADRs: no new tables, no new roles/permissions (promotion tagged `product:create`, EDITOR+ — subsumes the EDITOR-level edge permissions it composes), no importer changes, audit conventions reused |

## Phase 1 Artifacts

- [research.md](./research.md) — decision log (ratified + mechanics)
- [data-model.md](./data-model.md) — entities, projections, transaction invariants
- [contracts/api.md](./contracts/api.md) — endpoint deltas
- [quickstart.md](./quickstart.md) — end-to-end validation scenarios
