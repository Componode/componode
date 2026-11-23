# Tasks: BOM Importer-Native Declared Edges (Phase 3)

**Input**: Design documents from `/specs/076-bom-importer-native/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D10), data-model.md, contracts/importer-edges-api.md

**Tests**: Included — constitution VI (test-first) is non-negotiable; every surface sequences a failing test before its implementation.

**Organization**: Tasks are grouped by user story so each can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1/US2/US3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Core contract, constants, and parse primitives every later task imports.

- [x] T001 [P] `packages/core/src/constants/importer-edge.ts` — new constants module: `DISCOVERED_RELATIONSHIP_TYPES` (`DEPENDS_ON` | `SOURCES_FROM` | `EXPOSES`), `EDGE_PROVENANCES` (`CURATED` | `IMPORTER`), `EDGE_KINDS` (same three values — junction/suppression/request enum), types `DiscoveredRelationshipType`/`EdgeProvenance`/`EdgeKind`; `EDGE_JUNCTION` map from `EdgeKind` → `{ table, fromColumn, toColumn }` per the data-model direction table (`DEPENDS_ON`→`component_depends_on_component(parentId,childId)`; `SOURCES_FROM`→`component_sources_from(serviceId,repositoryId)`; `EXPOSES`→`component_exposes(serviceId,apiId)`); export all via `packages/core/src/index.ts`
- [x] T002 [P] `packages/core/src/contracts/discovered-asset.ts` — add `DiscoveredAssetRelationship { type: DiscoveredRelationshipType; targetExternalId: string }` and `relationships?: DiscoveredAssetRelationship[]` on `DiscoveredAsset`, replacing the "relationships[] is NOT part of the v1 contract" NOTE with an ADR-133 comment (opt-in gated, same-run scope); `packages/core/src/contracts/component-relationships.ts` — `RelatedComponent` gains optional `edgeProvenance?: EdgeProvenance`, `edgeImporterSourceId?: string | null`, `edgeImporterConfigId?: string | null`, `edgeImportRunId?: string | null` (doc: populated on the six component-edge families only); extend the importer manifest contract type (where manifests are typed for backend/agent consumption) with `declaredEdgesConfigKey?: string`
- [x] T003 [P] `packages/core/src/validation/discovered-asset.ts` — `discoveredAssetSchema` gains `relationships: z.array(z.object({ type: z.enum(DISCOVERED_RELATIONSHIP_TYPES), targetExternalId: z.string().min(1) }).strict()).optional()`; malformed entries fail the whole asset per the existing contract
- [x] T004 [P] `packages/core/src/utils/spdx.ts` — `BomParseResult` gains `edges: { from: string, to: string }[]` where `from`/`to` are version-free purl identities of parsed packages and the literal `SUBJECT` marks the document-described element (D7): emit edges for the `DEPENDS_ON`/`DEPENDENCY_OF`-family types already walked in `SPDX_SCOPE_MAP` (both direction forms normalized to `declaring → target`); `CONTAINS`/`DESCRIBES` never emit edges
- [x] T005 [P] `packages/core/test/` — unit tests for T001–T004: enum contents, `validateDiscoveredAsset` accepts a valid `relationships[]` and rejects bad type / empty `targetExternalId` / unknown fields; SPDX parse emits `SUBJECT→pkg` edges for direct deps and `pkg→pkg` edges where the document declares them, keyed by normalized purl identity

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Migration 038, DB types, RBAC action, and the shared junction write primitives every story consumes. **CRITICAL — blocks all user stories.**

- [x] T006 `packages/backend/test/` — migration test for 038: all three junctions gain `provenance` CHECK `('CURATED','IMPORTER')` default `CURATED`, `importerSourceId`/`importRunId` FKs `ON DELETE SET NULL`, and the `provenance<>'IMPORTER' OR importerSourceId IS NOT NULL` CHECK; pre-existing rows read `CURATED`; `component_edge_suppressions` has UNIQUE `(edgeKind, fromComponentId, toComponentId)`, cascade FKs to components, `suppressedBy`→persons SET NULL; `down()` restores. Fails before T007
- [x] T007 `packages/backend/src/db/migrations/038_bom_edge_provenance.ts` — alter the three junctions + create `component_edge_suppressions` per data-model.md verbatim (uuid PK, `edgeKind` CHECK over `EDGE_KINDS`, `fromComponentId`/`toComponentId` FK `ON DELETE CASCADE`, `suppressedBy` FK `ON DELETE SET NULL`, `createdAt`, `UNIQUE(edgeKind, fromComponentId, toComponentId)`, index on `(fromComponentId)`); `packages/backend/src/db/types.ts` — new columns on the three row types + `ComponentEdgeSuppressionRow` + table entry
- [x] T008 `packages/backend/src/plugins/rbac.ts` — add `"component:edge:remove": "EDITOR"` (hide edge), symmetric with `product:edge:remove`; extend any permission-mapping test
- [x] T009 `packages/backend/src/services/component-edge-store.ts` — shared write primitives used by the pass and the suppression service: `insertImporterEdge(trx, kind, fromId, toId, { sourceId, runId })` — junction switch over `EDGE_JUNCTION`, `ON CONFLICT (pk cols) DO NOTHING`, returns created boolean; `getEdgeProvenance(trx, kind, fromId, toId)`; `deleteEdge(trx, kind, fromId, toId)` returns removed boolean; `listSuppressedPairs(trx, kind, pairs)` batched; `suppressPair(trx, kind, fromId, toId, personId)` upsert. `packages/backend/test/` — store tests: insert is idempotent, a pre-existing `CURATED` row conflicts and keeps `CURATED`; provenance lookup; delete returns removed flag; suppression upsert unique-per-pair

**Checkpoint**: migrations apply/rollback clean; `pnpm --filter @componode/backend test` T006 + T009 green.

---

## Phase 3: User Story 1 — Importer declares dependency edges end-to-end (P1) 🎯 MVP

**Goal**: Opt-in config → completed run writes resolved `relationships[]` as `IMPORTER`-provenance junction edges (LIBRARY assets dedup-merged), idempotent on re-run, source-scoped diff-retire, gated server-side on the opt-in.

**Independent Test**: enable the switch on a GitHub config, run it, verify LIBRARY components, `IMPORTER` edges, a clean second run, and retirement of an edge a later run drops — all without any UI surface (badges land in US2).

### Tests for User Story 1

- [x] T010 [P] [US1] `packages/backend/test/importer-edge-service.test.ts` — pass resolves `targetExternalId` only within the run's yielded map (a catalog-resident-but-unyielded target is dropped); self-edges + duplicate declarations collapse to one write; suppressed pairs skipped; existing `CURATED` row on the pair untouched and keeps `CURATED`; re-run writes 0 duplicates; diff-retire deletes only this source's absent `IMPORTER` rows (other sources' `IMPORTER` rows and all `CURATED` rows untouched); suppressed pair in retire set not required (junction row already absent); `writeEdgeChange` audited with `runActor`
- [x] T011 [P] [US1] `packages/backend/test/import-run-edges.test.ts` (+ remote-run parity case) — `relationships[]` collected only when the run's manifest declares `declaredEdgesConfigKey` AND `config[key] === true`; pass runs after `runBomMatchPass` on `COMPLETED` only (FAILED/CANCELLED/INTERRUPTED write/remove nothing); pass failure never flips a completed run
- [x] T012 [P] [US1] `packages/importer-github/test/` — config schema: `importDeclaredEdges` defaults false, `true` without `includeDependencyGraph` rejected by refinement; with opt-in, importer yields LIBRARY-category `DiscoveredAsset`s whose `externalId` is the normalized version-free purl (`provider` via `mapEcosystemToProvider`, `resourceType` = purl type) that all pass `validateDiscoveredAsset`, plus `relationships[]` on the repo asset (`SUBJECT→pkg`) and on library assets (`pkg→pkg`); opt-in OFF yields neither; lockfile-fallback path yields no `relationships[]`

### Implementation for User Story 1

- [x] T013 [US1] `packages/backend/src/services/importer-edge-service.ts` — `runImporterEdgePass({ runId, sourceId, declared, externalIdToComponentId, importerName })` per data-model.md algorithm: resolve → drop unresolved (counted, silent) → dedupe/self-edge → subtract suppressed → `insertImporterEdge` per pair with `provenance='IMPORTER'` + source/run → delete this source's absent `IMPORTER` rows across all three junctions → `writeEdgeChange` per write/delete via `runActor`; returns `{declared, dropped, suppressed, created, removed}` counters logged like the suggestion passes
- [x] T014 [US1] `packages/backend/src/services/import-run-service.ts` — during `processAsset`, when the run's manifest declares `declaredEdgesConfigKey` and `config[key] === true`, record `(declaringComponentId, type, targetExternalId)` per yielded `relationships[]` entry (componentId from the dedup result) and keep the `externalId→componentId` map for the pass; on the completed path after `runBomMatchPass`, invoke `runImporterEdgePass` failure-isolated with `currentPhase` telemetry
- [x] T015 [US1] `packages/backend/src/services/remote-run-service.ts` — identical collect + pass wiring on the agent path (parity required — agent runs yield the same contract over WSS)
- [x] T016 [US1] `packages/importer-github/src/` — `config.ts`: `importDeclaredEdges: z.boolean().default(false).describe("Import declared dependencies as catalog edges. Imported dependencies are added to the catalog without review. You can hide any edge later.")` + `.refine` requiring `includeDependencyGraph` when on; `manifest.ts`: `declaredEdgesConfigKey: "importDeclaredEdges"`; `github-dependency-graph.ts`: `fetchRepoBom`/`BomFetchResult` gains `edges` from `parseSpdxDocument`'s new output (dep-graph path only — lockfile fallback returns none); `importer.ts`: when opted in, yield one LIBRARY `DiscoveredAsset` per SPDX package (identity per D6) and attach `relationships[]` — `SUBJECT→pkg` on the repo asset, `pkg→pkg` on the declaring library asset

**Checkpoint**: US1 independently verifiable via backend + importer tests: opt-in run produces IMPORTER edges + merged LIBRARY components; re-run idempotent; dropped edge retires.

---

## Phase 4: User Story 2 — Answer "why does this edge exist?" in one click (P1)

**Goal**: Every component dependency edge row shows **Curated** or **Added by importer** with a one-click link to the Source and the run (UX-EDGE-01/04).

**Independent Test**: a component with both edge kinds renders both badges; the importer badge links to `/sources/{id}` and `/importers/{configId}/runs/{runId}` — works even if US1's importer yield is simulated by direct junction writes.

### Tests for User Story 2

- [x] T017 [P] [US2] `packages/backend/test/` — relationships read test: all six component-edge families return `edgeProvenance`/`edgeImporterSourceId`/`edgeImporterConfigId`/`edgeImportRunId` from the junction row; `CURATED` rows carry `edgeProvenance:"CURATED"` with null source/run; `libraryCounts` and product lanes unchanged; route test asserts the new fields in the response contract
- [x] T018 [P] [US2] `packages/frontend/` — unit tests for the provenance badge (CURATED→"Curated", IMPORTER→"Added by importer") and Hide-item visibility rules (T023's component renders only for Editor + `IMPORTER`)

### Implementation for User Story 2

- [x] T019 [US2] `packages/backend/src/services/component-relationship-service.ts` — each of the six family selects gains the three junction columns; `edgeImporterConfigId` resolved via the `importer_sources.configId` join (D9); `$castTo<RelatedComponent>` contract updated — bounded read preserved (columns only, no extra rows)
- [x] T020 [US2] `packages/frontend/src/ux/components/catalog/component-relationships.tsx` + `packages/frontend/src/api/` — provenance badge on each edge row (**Curated** muted / **Added by importer** info tone, per Vocabulary) linking to `/sources/{edgeImporterSourceId}` and the run at `/importers/{edgeImporterConfigId}/runs/{edgeImportRunId}`; `packages/frontend/src/ux/components/catalog/package-consumers.tsx` — same badge on Used-by rows; all surfaces gated on `flags.bomImporterEdges` (hidden, never disabled)

**Checkpoint**: UX-EDGE-04 exit criterion met — any edge answers "why does this exist?" in one click.

---

## Phase 5: User Story 3 — Editor hides an importer-added edge (P1)

**Goal**: **Hide edge** writes a suppression record + removes the junction row atomically; later runs never recreate the pair; human re-creation stays possible (UX-EDGE-02).

**Independent Test**: hide an importer-added edge, re-run the importer still declaring it, verify non-return; verify `409` on a curated edge and `403` for a Viewer.

### Tests for User Story 3

- [x] T021 [P] [US3] `packages/backend/test/` — route + service test for `POST /component-edge-suppressions`: `200 {suppressed:true, edgeRemoved:true}` writes the record and deletes the junction row in one transaction; re-hide idempotent (`edgeRemoved:false`, no duplicate record — UNIQUE pair); `409 CONFLICT` when the existing junction row is `CURATED`; `404` for a missing component; `403` for Viewer; strict-body `400` on unknown fields; integration: a suppressed pair re-declared by a subsequent run (any Source) produces no edge; `writeEdgeChange("removed", sessionActor, "edge-suppressed")` audited
- [x] T022 [P] [US3] `packages/frontend/` — unit test: Hide menu item only on `IMPORTER`-provenance rows for Editor+, confirm dialog wording, relationships query invalidated on success, hidden edge absent after refresh

### Implementation for User Story 3

- [x] T023 [US3] `packages/backend/src/services/importer-edge-suppression-service.ts` — `suppressComponentEdge({ edgeKind, fromComponentId, toComponentId }, actor)` per contracts doc: both components exist → `404`; transaction = refuse `CURATED` row (`409`) → `suppressPair` upsert → `deleteEdge` → audit; `packages/backend/src/routes/` — `POST /component-edge-suppressions` with `verifySession` + `requireRole("component:edge:remove")`, `.strict()` Zod body `{ edgeKind, fromComponentId: uuid, toComponentId: uuid }`, `{code,message,details?}` envelope
- [x] T024 [US3] `packages/frontend/src/` — API client + `component-relationships.tsx` row-menu **Hide edge** item (Editor + `IMPORTER` provenance + flag ON): confirm dialog ("This edge won't be recreated by future imports."), POST, invalidate the relationships query, toast on success

**Checkpoint**: UX-EDGE-02 exit criterion — a hidden edge stays hidden across re-imports, from any Source.

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: Flag + gap registry, governance docs, ADRs, e2e coverage, full verification.

- [x] T025 [P] `packages/frontend/src/ux/lib/flags.ts` — `bomImporterEdges: flagOverride("bomImporterEdges") ?? true` + G39 doc comment; `researches/ux-rewrite-gaps.md` — `## G39 — Importer-added edge provenance — RESOLVED by spec 076` entry (surface: provenance badge, Hide edge, opt-in switch; capability: Phase-3 provenance + suppression record live; flag `bomImporterEdges`; fallback hidden) matching the G37/G38 format; `docs/ux.md` — §7 flags table row + any §4/§5 surface notes
- [x] T026 `docs/openapi.yaml` — `POST /component-edge-suppressions` (body, `200`, `403`, `404`, `409`) + the four `edge*` response fields on the relationships read; `x-permission: "component:edge:remove"`; run `pnpm --filter @componode/backend docs:api` to regen `docs/api.md`; `docs:oracle:check` + `docs:sidebar:check` green
- [x] T027 [P] `researches/adrs/ADR-133-v2-importer-relationship-contract.md` — new ADR (lifts `relationships[]` prohibition for opt-in declared component edges; same-run scope; `ON CONFLICT DO NOTHING` preserves curated edges; source-scoped diff-retire; provenance columns + `component_edge_suppressions` via migration 038; single-writer provenance limitation per D4); `ADR-057` — amendment note pointing to ADR-133; `.specify/memory/constitution.md` — Principle V note updated (v2 contract exists, opt-in + provenance + suppression guardrails); `researches/architecture-decisions.md` — register ADR-133; `CONTEXT.md` — "Added by importer" / "Curated" provenance terms if absent
- [x] T028 [P] `docs/importers/github.md` — `importDeclaredEdges` field (opt-in, requires dependency graph, review-bypass copy verbatim, what it creates: LIBRARY components + dependency edges, Hide edge pointer); `docs/roadmap.md` — `076-bom-importer-native` shipped entry + revised Next entry
- [x] T029 `playwright/` — seed fixtures (importer-added edges with provenance, a curated edge, a GitHub config) + `playwright/tests/journeys/bom-importer-edges.spec.ts` (opt-in switch shows review-bypass copy; provenance badge + Source/run link; Hide edge → edge gone → survives "re-import"; Viewer sees badges but no Hide; flag-off hides all three surfaces) — run `pnpm e2e` subset green
- [x] T030 Full verification — `pnpm lint && pnpm typecheck && pnpm test && pnpm build` for changed packages (core, backend, frontend, importer-github) + root build + `pnpm audit --prod --audit-level=high`; quickstart scenarios A–D spot-check; AGENTS.md done-criteria sweep (openapi ✅, ADR-133 + back-pointers ✅, roadmap ✅, gap G39 ✅, importer guide ✅)

---

## Phase 7: Review (code-review findings)

- [x] T031 `packages/backend/src/db/migrations/038_bom_edge_provenance.ts` [code-review: standards] — **HIGH**: `importerSourceId`/`importRunId` are `ON DELETE SET NULL` but the `*_importer_provenance_check` CHECK forbids a null source on IMPORTER rows, so the FK can never fire and any referenced source/run delete would fail with a misleading CHECK error. Switch both provenance FKs to `onDelete("no action")` (provenance is durable per ADR-133; deleting a referenced Source/run is blocked, not silently un-attributed) and fix the header comment; update `edge-provenance-migration.test.ts` to assert `NO ACTION` instead of `SET NULL`
- [x] T032 `docs/architecture.md` [code-review: standards] — **HIGH**: line ~236 still states "`DiscoveredAsset.relationships` is **not** part of the v1 contract — importer-declared product edges are a v2 feature". Update the prose to describe the ADR-133 v2 contract (opt-in `relationships[]`, component edges only, same-run scope). Also add one line to `researches/adrs/ADR-133-*.md` clarifying source-scoped retirement compares against the *resolved* desired set (a declared-but-unresolvable edge is removed, matching "the completed run's deliverable set is authoritative")
- [x] T033 `docs/openapi.yaml` [code-review: spec] — **HIGH**: the suppression 409 is documented as `EDGE_NOT_IMPORTER` but the service returns `code: "CONFLICT"` (matching contracts/importer-edges-api.md and the controlled error-code enum). Fix the description to `409 CONFLICT` and regenerate `docs/api.md`
- [x] T034 `packages/frontend/src/ux/components/catalog/package-consumers.tsx` [code-review: spec] — **MEDIUM** (SC-001): the Used-by provenance badge is label-only while the API already returns `edge.importerSourceId`/`importerConfigId`/`importRunId` — add the same Source/Import-run links as the relationships panel (IMPORTER provenance + flag on only); extend the consumers frontend type if the ids aren't typed
- [x] T035 `packages/core/src/validation/discovered-asset.ts` [code-review: spec] — **MEDIUM**: the `relationships[]` item schema must be `.strict()` per T003/T005 (unknown fields rejected, not stripped); extend the core test to assert rejection
- [x] T036 `packages/backend/src/services/{importer-edge-pass.ts,component-edge-store.ts}` [code-review: standards] — junction-table maps `JUNCTION_OF`/`JUNCTION_TABLE` re-encode what core's `EDGE_JUNCTION` already declares; use `EDGE_JUNCTION[kind].table` (the per-kind column branches stay — Kysely needs literal columns)
- [x] T037 `packages/backend/src/services/component-edge-store.ts` [code-review: standards] — `listSuppressedPairs` builds an inline pair key duplicating `edgePairKey`; reuse the exported helper
- [x] T038 `packages/backend/src/services/{import-run-service.ts,remote-run-service.ts}` + `importer-edge-pass.ts` [code-review: standards] — the declared-edge collection loop is identical on both run paths; export a `collectDeclaredEdges(asset, componentId): DeclaredEdge[]` helper from the pass module and call it from both (each caller keeps its own opt-in flag check)
- [x] T039 `packages/backend/src/services/remote-run-service.ts` [code-review: standards] — remove the try/catch wrapping `runImporterEdgePass`; the pass is already failure-isolated internally (dead isolation)
- [x] T040 `packages/backend/src/services/importer-edge-pass.ts` [code-review: standards] — count duplicate declarations so `declared = resolved + dropped + suppressed…` reconciles in the logged report; add a `duplicates` counter (report is internal, log-only)
- [x] T041 `packages/core/src/utils/{spdx.ts,cyclonedx.ts}` [code-review: standards] — the identity-resolve → self-skip → dedupe loop is duplicated between the two edge projections; extract a shared `dedupeEdges` helper (core util) both parsers call

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — core contract/validation/parse only
- **Foundational (Phase 2)**: depends on Phase 1 constants for enum parity — BLOCKS all stories
- **US1 (Phase 3)**: depends on Phase 2 (junction cols, store) — the pass writes provenance
- **US2 (Phase 4)**: depends on Phase 2 (provenance cols exist) + T019's read change; UI badge independent of US1's importer yield (can be tested with hand-written junction rows)
- **US3 (Phase 5)**: depends on Phase 2 (`component_edge_suppressions`, store, RBAC) + T013's suppression-aware pass
- **Polish (Phase 6)**: all stories

### User Story Dependencies

- **US1 → US3**: the pass must consult suppressions from first ship (T013) — US3 only adds the write path to the table
- **US2** is independent of US1/US3 ordering but ships in the same flag flip

### Parallel Opportunities

- Phase 1: T001–T005 all parallel (different core files)
- Phase 2: T008, T009 parallel with T006/T007 sequence
- US1: T010–T012 tests parallel; T016 (importer pkg) parallel with T013–T015 (backend)
- US2/US3: backend and frontend tasks split cleanly by package

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phases 1–2: contract + schema + migration + store
2. Phase 3: the edge pass + GitHub carrier — the declared graph materializes
3. **VALIDATE**: run detail + DB assertions per quickstart Scenario A

### Incremental Delivery

1. US1 → declared edges exist with provenance columns (headless-verifiable)
2. US2 → provenance visible (UX-EDGE-01/04)
3. US3 → Hide edge (UX-EDGE-02)
4. Polish → flag/ADR/docs/e2e — UX-EDGE ship-gate complete
