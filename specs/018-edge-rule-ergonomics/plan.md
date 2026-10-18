# Implementation Plan: Edge-Rule Ergonomics

**Branch**: `feature/018-edge-rule-ergonomics` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/018-edge-rule-ergonomics/spec.md`

## Summary

Implement ratified ADR-109: remove the `COMPOSES` parent-type restriction so
any `DigitalProduct` type may compose children. Three code touch-points —
`addComposesEdge` drops the `COMPOSES_PARENT_TYPE` check, `updateProduct`'s
type-change guard drops the PLATFORM-parent offenders branch, and
`EdgePicker` drops its `canBeParent`/`disabled` gating — plus flipping the
existing 422 regression test into an acceptance case and updating the stale
`docs/digital-products.md` rules/diagram. Self-edge rejection, cycle
detection (`409 CYCLE_DETECTED`), and `CONSUMES_FROM` → `PLATFORM` are
unchanged. No schema, endpoint, or permission changes.

## Technical Context

**Language/Version**: TypeScript 6 (`typescript@^6.0.3`), Node 24

**Primary Dependencies**: Fastify, Kysely, Zod (backend); React 18, TanStack
Query (frontend); `packages/core` shared contracts

**Storage**: PostgreSQL — no schema change; validation-rules-only feature

**Testing**: Vitest — backend testcontainers integration
(`packages/backend/test/integration`), frontend unit
(`packages/frontend/src/test/unit`)

**Target Platform**: Docker Compose app (backend serves frontend static)

**Project Type**: web-service + SPA monorepo (pnpm workspaces + Turborepo)

**Performance Goals**: unchanged — recursive CTE cycle check already runs on
every composes-edge insert; removing a comparison adds nothing

**Constraints**: strict Zod at route boundary unchanged (ADR-095); audit
`edge_changes` rows still written; error envelope `{code,message,details}`
unchanged (ADR-071); `INVALID_EDGE_TYPE` still covers SELF_EDGE and
CONSUMES_FROM_TARGET_TYPE

**Scale/Scope**: ~2 backend service files, ~1 frontend component, ~2 test
files, 1 doc file. No new files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| I. Single-Organization, Self-Hosted | PASS | No tenant concepts touched |
| II. Importer-First | PASS | Product-product edges are user-declared only; importers can't emit COMPOSES |
| III. Two-Level Taxonomy | PASS | Type enum unchanged (closed at 3 values) |
| IV. Environment-as-Instance | PASS | Untouched |
| V. Factual vs. Meaning Layer | PASS | Graph rules are meaning-layer; ADR-109 is a ratified modeling decision |
| VI. Test-First | PASS | Existing 422 test flips to acceptance before code change (red→green) |
| VII. Observability | PASS | Same `writeEdgeChange` audit calls; no new async paths |
| Stack constraints | PASS | No deps, no migration, no sql.raw |

**Gate result**: PASS — no violations. Note: the constitution's normative
graph rules (AGENTS.md mirrors) will need their stale `COMPOSES` line updated
in the same PR to keep the binding docs truthful — tracked as a task.

## Project Structure

### Documentation (this feature)

```text
specs/018-edge-rule-ergonomics/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (api.md — behavioral delta, no surface change)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/
├── backend/
│   ├── src/services/
│   │   ├── product-edge-service.ts    # drop COMPOSES_PARENT_TYPE check (FR-001)
│   │   └── product-service.ts         # drop PLATFORM-parent offenders branch (FR-005)
│   └── test/integration/
│       └── products.test.ts           # flip 422 case; add PLATFORM-parent acceptance (US1/US2)
├── frontend/
│   └── src/components/products/
│       └── edge-picker.tsx            # remove canBeParent/disabled gating (FR-006)
└── docs/
    └── digital-products.md            # update composition rule + diagram (FR-007)
```

**Structure Decision**: Existing service/component seams — this feature
removes code rather than adding it; no new modules warranted.

## Complexity Tracking

N/A — no constitution violations.
