# Implementation Plan: App-level auto ComponentGroups + multi-group membership

**Branch**: `070-app-auto-groups` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/070-app-auto-groups/spec.md` (design grilled in `researches/docker-app-level-grouping-proposal.md`, clarify Q1 resolved)

## Summary

Two coupled changes shipped as one feature:

1. **Multi-membership promotion** — `components.componentGroupId` (single-valued) becomes a `component_group_members(componentId, groupId)` join table. A component may belong to human + source-auto + app-auto groups simultaneously. All ~15 read/write sites migrate to the join table.
2. **App-level auto groups** — a second grouping dimension in `source-group-service`: for each enabled source whose importer declares the new `autoAppGroups` capability, maintain one auto-managed `ComponentGroup` per (source, app-boundary key) where keys are extracted from persisted `components.details` (Docker: `compose:{project}` from `details.composeProject`/`details.labels["com.docker.compose.project"]`, `stack:{name}` from `details.stack`). Membership = components effective-active-reported by that source AND carrying the key — additive, no sole-reporter requirement.

Provenance moves onto `component_groups` itself: new `autoSourceId` + `autoGroupKey` columns replace `importer_sources.componentGroupId`; `autoSourceId IS NOT NULL` becomes the single auto-managed predicate. Human group assignment (`componentGroupIds[]`) manages only human-group memberships — auto-group memberships are system-owned and rejected in the field.

## Technical Context

**Language/Version**: TypeScript 6 (backend/core/frontend), Zod 4 schemas

**Primary Dependencies**: Fastify + Kysely (existing), `node:crypto` slug hash, `generateUniqueSlug`, `writeEntityChange`, existing metrics/logging plumbing

**Storage**: PostgreSQL — migration `030_component_group_membership`: new `component_group_members` join table (backfilled from `components.componentGroupId`), `component_groups` + `autoSourceId`/`autoGroupKey` (source groups backfilled), drop `components.componentGroupId` and `importer_sources.componentGroupId`

**Testing**: Vitest unit + integration (testcontainers Postgres) under `packages/backend/test/`, core schema tests, frontend unit tests, Playwright under `playwright/tests/`

**Target Platform**: Componode hub backend + React frontend; `packages/agent` untouched (grouping is hub-side); `packages/importer-docker` manifest-only change

**Project Type**: web-service (pnpm monorepo)

**Performance Goals**: N/A — set-based pass over catalog-scale data once per trigger; join-table reads are indexed lookups

**Constraints**: failure-isolated pass (never throws into host op); full-recompute idempotent; additive auto-membership; automation-owned eviction inside owned groups; no `DiscoveredAsset` change; `GROUP_AUTO_MANAGED` covers all auto groups

**Scale/Scope**: 1 migration, ~15 backend service/query sites, 1 new strategy dimension in source-group-service, core schema/contract updates, openapi.yaml, ~8 frontend files, docs + ADR-129 amendment

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-org | PASS | No tenancy surface. |
| II. Importer-first | PASS | Importers stay pull-only; grouping is backend derivation from stored memberships/details (ADR-113/129 precedent). `DiscoveredAsset` untouched (FR-016). Manifest gains optional flag — additive. |
| III. Two-level taxonomy | PASS | No category/provider/resourceType changes. |
| IV. Environment-as-instance | PASS | Reuses `ComponentGroup`; derived lifecycle mirrors member `Component.lifecycle`; no lifecycle/status conflation. |
| V. Factual vs. meaning | PASS (via ADR amendment) | Group membership remains a component attribute derived from factual data — not an edge; product hierarchy stays human-authored (FR-017). Multi-membership amends ADR-129's single-group scope note + ADR-082's single-assignment model — ADR update is a tracked deliverable. |
| VI. Test-first | PASS | tasks.md sequences failing tests first; Playwright coverage of changed surfaces is a tracked task. |
| VII. Observability | PASS | Same failure-isolated pass metrics/logging; report gains app-group counters. |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/070-app-auto-groups/
├── plan.md              # This file
├── research.md          # Phase 0 output — decision record
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/
├── core/src/
│   ├── importer-registry.ts            # ImporterManifest.autoAppGroups?: boolean
│   ├── schemas/components.ts           # componentGroupIds[] in create/update;
│   │                                   #   listComponentsQuerySchema unchanged (slug filter)
│   ├── contracts/component.ts          # componentGroups[] replaces componentGroupId/Name
│   └── constants/                      # GROUP_AUTO_MANAGED already exists (067)
├── backend/src/
│   ├── db/migrations/030_component_group_membership.ts  # NEW
│   ├── db/types.ts                     # ComponentGroupMemberRow; ComponentRow −componentGroupId;
│   │                                   #   ComponentGroupRow +autoSourceId/autoGroupKey;
│   │                                   #   ImporterSourceRow −componentGroupId
│   ├── services/
│   │   ├── component-group-membership.ts  # NEW — shared membership read/write helpers
│   │   ├── source-group-service.ts        # join-table membership; provenance columns;
│   │   │                                   #   app-group dimension (key extraction, ensure,
│   │   │                                   #   evict, lifecycle)
│   │   ├── component-group-service.ts     # memberCount via join; isAutoManagedGroup →
│   │   │                                   #   autoSourceId IS NOT NULL; human-only
│   │   │                                   #   componentGroupIds write rule; audit
│   │   ├── component-catalog-service.ts   # list/detail group payloads + slug filter
│   │   ├── component-relationship-service.ts # via-group dependents over all memberships
│   │   ├── product-service.ts             # group-edge expansion via join table
│   │   ├── product-health-service.ts      # same expansion
│   │   ├── catalog-coverage-service.ts    # wiredComponentIdsQuery union via join
│   │   ├── edge-suggestion-service.ts     # coverage = any-membership ∩ depended groups
│   │   ├── importer-source-service.ts     # source→own-group link via autoSourceId
│   │   └── importer-config-service.ts     # (no change — scope passes through)
│   └── plugins/metrics.ts                 # report fields for app-group counts
├── importer-docker/src/manifest.ts        # autoAppGroups: true
└── agent/                                 # no changes

packages/frontend/src/
├── api/types.ts, api/mappers/catalog.ts, api/hooks/{components,component-groups}.ts
├── ux/components/catalog/{component-edit-dialog,component-create-dialog,component-detail}.tsx
├── ux/app/components/new.tsx, ux/components/patterns/title-with-summary.tsx
└── ux/lib/view-types.ts

docs/
├── openapi.yaml                        # componentGroupIds request/response; group provenance fields
├── api.md                              # regenerated (docs:api)
├── using-the-catalog.md                # multi-membership + app groups prose
├── importers/docker.md                 # auto-grouping section update
├── roadmap.md                          # ship-stage update
└── adrs → researches/adrs/ADR-129-*.md  # amendment: multi-membership + provenance columns

playwright/tests/                       # multi-group + app-group journey coverage
```

**Structure Decision**: extends the spec-067 architecture in place — same pass, same trigger sites, same strategy-registry pattern; the membership store and provenance link are the only structural changes.

## Design resolutions (grilling + clarify + plan)

- **Membership store**: `component_group_members(componentId, groupId, createdAt)` PK `(componentId, groupId)`, both FKs `ON DELETE CASCADE`. Backfilled from `components.componentGroupId`; column dropped in the same migration.
- **Human write rule (the key semantic)**: `componentGroupIds` on create/update = the desired set of memberships in **human-managed groups only** (`component_groups.autoSourceId IS NULL`). The service diffs and rewrites only those rows; memberships in auto-managed groups are never touched by human writes, and passing an auto-managed group id is rejected (`409 GROUP_AUTO_MANAGED`-family validation). No per-row origin column needed — ownership derives from the group's `autoSourceId`.
- **Auto-managed predicate**: `component_groups.autoSourceId IS NOT NULL` — single test covering source groups (`autoGroupKey IS NULL`) and app groups (`autoGroupKey = 'compose:{project}' | 'stack:{name}'`). `isAutoManagedGroup`, `GROUP_AUTO_MANAGED` guards, and pass bookkeeping all key off it.
- **App-group membership rule**: component C joins source S's group for key K iff S is an effective-active reporter of C (membership `active` AND S `ACTIVE`/`UNMONITORED`) AND C's `details` yields K via the strategy extractor. NOT sole-reporter — shared components join every reporting source's matching app group. Eviction inside owned groups unchanged (clarify Q1 → A).
- **Source group unchanged**: still one per source, still sole-effective-active-reporter membership — now written as join rows; its members may simultaneously hold app/human memberships.
- **Key extraction (docker strategy)**: `compose-project` kind reads `details.composeProject` (workloads) else `details.labels["com.docker.compose.project"]` (networks/volumes); `swarm-stack` kind reads `details.stack` (swarm services). `autoGroupKey` = `compose:{project}` / `stack:{name}`.
- **Group identity**: name = key label verbatim; slug = `docker-app-{slug(key)}-{hash12(sourceId:autoGroupKey)}` via `generateUniqueSlug`; description = provenance (source identity + key + spec ref); `teamOwnerId` NULL.
- **Enablement**: unchanged — bound config `scope.autoGroup !== false` gates BOTH group types; `autoAppGroups` manifest flag gates only the app dimension. UNMONITORED/unbound → frozen.
- **Evaluation scope**: same full-recompute pass; app-group evaluation runs for `full`-mode sources after source-group evaluation in the same transaction-scoped pass (order-independent under multi-membership).
- **API deltas**: component payloads `componentGroups: [{id,name,slug}]` (replaces `componentGroupId`/`componentGroupName`); create/update accept `componentGroupIds: uuid[]` (absent = unchanged, `[]` = clear human memberships); group payloads gain `autoSourceId`/`autoGroupKey` (nullable); importer-source payload keeps `componentGroupId` = the source's own group (`autoGroupKey IS NULL` lookup).
- **Coverage semantics**: product `DEPENDS_ON` group G covers component C iff ∃ membership `(C,G)` — multi-membership means coverage = any-group intersection (suggestions) / join expansion (product detail, health, wired).
- **Audit**: human membership changes audited via `writeEntityChange` on the component (`componentGroupIds` diff); auto-pass membership churn stays unaudited (067 precedent); group create/lifecycle audited as today.
- **Metrics**: existing `auto_group_pass_*` trio retained; pass report gains `appGroupsEnsured`, `appMembersAssigned`, `appMembersEvicted` fields in the structured log line.

## Phase 0 — Research

`research.md` consolidates: the grilling record (10 decisions), clarify Q1 (eviction), and the code-surface map (all `componentGroupId` readers/writers enumerated above). No NEEDS CLARIFICATION items remain.

## Phase 1 — Design artifacts

- `data-model.md` — migration 030, join table, provenance columns, membership invariants for both group types, write rules.
- `contracts/group-membership-api.md` — request/response deltas, group payload additions, error semantics.
- `quickstart.md` — runnable validation (docker import → app groups; multi-assign; guards; opt-out).
