# Tasks: BOM Inventory (Phase 1)

**Input**: Design documents from `/specs/073-bom-inventory/`
**Prerequisites**: plan.md, spec.md, research.md (D1–D10), data-model.md, contracts/bom-api.md, contracts/importer-contract.md, quickstart.md

**Tests**: REQUIRED — constitution VI test-first: write failing tests, then implement. Every importer unit test MUST exercise `validateDiscoveredAsset`. Playwright coverage per FR-030.

**Organization**: by user story (US1…US6 from spec.md). Normative detail lives in `researches/sbom_research.md` and the spec Clarifications — do not reopen settled decisions.

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Create `packages/importer-sbom-file/` skeleton mirroring `packages/importer-web-url` (package.json `@componode/importer-sbom-file` with `./manifest` + `./importer` exports, tsconfig, `src/index.ts`, `src/manifest.ts`, `src/config.ts`, `src/importer.ts`, `test/` dir)
- [x] T002 [P] Add `packageurl-js` (`^x.y.z`, release ≥7 days old) to `packages/core` via `pnpm add`; add `ajv` as devDependency to `packages/backend`
- [x] T003 [P] Vendor `cyclonedx-1.5.schema.json` and the SPDX 2.3 JSON schema into `packages/backend/test/fixtures/schemas/` (official sources; commit the files)
- [x] T004 Register `@componode/importer-sbom-file` in `IMPORTER_PACKAGES` (`packages/core/src/importer-registry.ts`) and add the workspace dep to `packages/backend/package.json` and `packages/agent/package.json` (lockstep, ADR-116 #7); commit `pnpm-lock.yaml`

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: contract + table must exist before any story works

- [x] T005 [P] Create `packages/core/src/constants/bom-entry.ts` with `BOM_DEPENDENCY_SCOPES` (RUNTIME, DEV, BUILD, TEST, SYSTEM, OPTIONAL, BUNDLED, TRANSITIVE), `BOM_EVIDENCE_SOURCES` (LOCK_FILE, MANIFEST_FILE, SBOM_DOCUMENT, IMAGE_LAYER, REGISTRY_API, VCS_ANALYSIS), `BOM_CDX_TYPES` (12 values per data-model.md) + types; export from `constants/index.ts`
- [x] T006 [P] Create `packages/core/src/lib/purl.ts` — `parsePurl`, `isValidPurl`, `purlEcosystem` (type fragment), `normalizePurlIdentity` (version/qualifiers/subpath stripped, per-type casing via packageurl-js); unit tests in `packages/core/test/`
- [x] T007 Add `DiscoveredBomEntry` + `bomEntries?: DiscoveredBomEntry[]` to `DiscoveredAsset` AND `bomEntries?` to `DiscoveredAssetInstance` in `packages/core/src/contracts/discovered-asset.ts` (ADR-057 A1 comment — factual inventory, not edges); add `BomEntry`/`BomEntryListItem`/`BomSummary` to new `packages/core/src/contracts/bom-entry.ts`; export both from index
- [x] T008 Extend `packages/core/src/validation/discovered-asset.ts` with recursive `discoveredBomEntrySchema` — `purl` valid via `isValidPurl` + `min(1)`, `name min(1)`, `evidenceSource` required enum, `scope` enum default `RUNTIME`, `direct` optional (default applied at write: `scope !== 'TRANSITIVE'`), `children` recursive — field OPTIONAL and presence-preserving (never defaulted in); core unit tests for valid/invalid/absent-vs-empty
- [x] T009 [P] Create `packages/core/src/schemas/bom.ts` — `listBomQuerySchema` extending `listParamsBaseSchema` with `sort` whitelist (`name`,`version`,`scope`,`ecosystem`,`lastReportedAt`, default `name`), `scope`/`ecosystem`/`found` CSV filters (`splitCsvParam` + enum checks), `direct` (`optionalBooleanParam`), `catalog` (`linked|suggested|none` optional), `instanceId` uuid optional, `view` (`flat|tree` default flat), `parentId` uuid optional; `.strict()`; export
- [x] T010 Migration `packages/backend/src/db/migrations/032_bom_entries.ts` — exact DDL from data-model.md: all columns, FKs (components CASCADE, component_instances CASCADE, self-parent CASCADE, import_runs/importer_sources/components-resolved SET NULL), CHECK constraints from core constant arrays, both partial unique indexes with `NULLS NOT DISTINCT`, all 7 secondary indexes
- [x] T011 [P] Migration `033_import_run_package_counts.ts` — `packagesCreated`, `packagesUpdated`, `packagesUnchanged`, `packagesRemoved` int NOT NULL DEFAULT 0 on `import_runs`; add columns to `packages/backend/src/db/types.ts` (plus `BomEntryRow` + `bom_entries` table entry)
- [x] T012 Add `getBomStaleThresholdDays()` to `packages/backend/src/services/settings-service.ts` — `app_settings` key `bom.staleThresholdDays`, default 7, env override `BOM_STALE_THRESHOLD_DAYS` (D4)

**Checkpoint**: contract, table, types exist — importer + service work can begin

---

## Phase 3: User Story 1 — Importer-reported package inventory lands (P1) 🎯 MVP

**Goal**: importers yield `bomEntries`; stored queryable BOM with source-scoped diff-replace and honest degradation

**Independent Test**: enable a BOM toggle → completed run populates entries; re-run dedupes; failed/cancelled run preserves; absent-vs-empty presence semantics hold (spec US1 scenarios 1–6)

### Tests for User Story 1 ⚠️ write FIRST, ensure FAIL

- [x] T013 [P] [US1] `packages/backend/test/bom-service.test.ts` — upsert tree (nested parent binding), key-matched replace (absent keys deleted only on COMPLETED), NULL-instance `NULLS NOT DISTINCT` dedupe, `lastReportedAt` bump vs `createdAt` preserved, absent-field preserve vs `[]` replace, `direct` defaulting + TRANSITIVE conflict (direct wins), counter values (created/updated/unchanged/removed), multi-source replace isolation
- [x] T014 [P] [US1] `packages/backend/test/import-run-bom.test.ts` — end-to-end through the run loop: `bomEntries` on asset → component-scope; on instance → instance-scope; FAILED run keeps prior rows; field-absent asset preserves prior set
- [x] T015 [P] [US1] `packages/importer-github/test/dependency-graph.test.ts` — dep-graph SPDX fetch → `DiscoveredBomEntry[]` mapping (scope/direct/evidence=REGISTRY_API), lockfile fallback per research table, `includeDependencyGraph` off → field absent, `bomInventory` capability marker on 403/error; run output passes `validateDiscoveredAsset`
- [x] T016 [P] [US1] `packages/importer-docker/test/sbom.test.ts` — OCI referrers attestation → nested `bomEntries` (`evidenceSource=IMAGE_LAYER`, `cdxType=container`), image without attestation → field absent + capability marker; `validateDiscoveredAsset` on output
- [x] T017 [P] [US1] `packages/importer-kubernetes/test/pod-image-sbom.test.ts` — pod `containers[].image` → image SBOM → workload `bomEntries` with `evidenceDetail="k8s:pod-spec:image:{ref}"`; registry failure → absent + marker; `validateDiscoveredAsset`

### Implementation for User Story 1

- [x] T018 [US1] Create `packages/backend/src/services/bom-service.ts` — `processBomEntries(trx, {componentId, componentInstanceId|null, sourceId, runId, entries, scope-set-collector})`: top-down tree upsert by `(componentId, purl, scope, componentInstanceId, parentBomEntryId)` using the unique indexes (`onConflict` on index columns); stamp `importRunId`, `sourceId`, `lastReportedAt`; count created/updated/unchanged; `direct` default `scope !== 'TRANSITIVE'` with explicit `direct` winning; `ecosystem` from `purlEcosystem`
- [x] T019 [US1] Add `deleteAbsentBomEntries(trx, scopes, sourceId, runId)` to `bom-service.ts` — per reported `(componentId, componentInstanceId|null)` scope: `DELETE WHERE sourceId=? AND scope=? AND (importRunId IS NULL OR importRunId != ?)`; returns removed count (D1)
- [x] T020 [US1] Wire `packages/backend/src/services/import-run-service.ts`: in `processAsset` after instance upsert, call `processBomEntries` for asset-level `bomEntries` (NULL scope) and each instance's `bomEntries` (instance scope) — **only when the field is present** (track reported scopes); accumulate package counters into run update; at run completion (before status COMPLETED, same place as `runAutoGroupPass`) call `deleteAbsentBomEntries` for reported scopes + persist `packages*` columns — FAILED/CANCELLED/INTERRUPTED paths untouched
- [x] T021 [US1] `packages/importer-github/src/config.ts` — add `includeDependencyGraph` (`z.boolean().default(false)`) with the UX-IMP-02 helper text verbatim
- [x] T022 [US1] `packages/importer-github/src/` — dep-graph fetch (`GET /repos/{o}/{r}/dependency-graph/sbom`) → `DiscoveredBomEntry[]` per research mapping (`evidenceSource=REGISTRY_API`); lockfile/manifest fallback (`LOCK_FILE`/`MANIFEST_FILE`, path as `evidenceDetail`); `bomInventory` family in `capabilities.ts`; field absent (not `[]`) when unavailable
- [x] T023 [US1] `packages/importer-docker/src/` — `includeSbom` config (default false, UX-IMP-02 text): OCI Referrers attestations (CycloneDX+SPDX accept) → nested `bomEntries`, `IMAGE_LAYER`, Syft fallback per research; capability marker; absent-not-empty on missing attestation
- [x] T024 [US1] `packages/importer-kubernetes/src/` — `includePodImageSbom` config (default false, UX-IMP-02 text): per-pod `containers[].image` → referrers → `bomEntries` on workload asset with `evidenceDetail="k8s:pod-spec:image:{image_ref}"`; capability marker
- [x] T025 [US1] Surface `bomInventory` in run/config views: extend `CAPABILITY_LABELS` with "Dependency inventory" (frontend) and ensure run detail data carries the package counters (run contract/serializer update in `packages/core/src/contracts/import-run.ts` + run route)

**Checkpoint**: a BOM-enabled run stores a deduped, scoped, queryable inventory — US1 complete

---

## Phase 4: User Story 2 — Read a component's bill of materials (P1)

**Goal**: paginated list + summary APIs and the flag-gated read-only BOM tab with the full UX-BOM/UX-STATE/UX-A11Y surface

**Independent Test**: spec US2 scenarios 1–7 — URL round-trip, 5k pagination, merged/instance views, tree lazy-load + filters→flat, state matrix, no forbidden words/tones

### Tests for User Story 2 ⚠️ write FIRST

- [x] T026 [P] [US2] `packages/backend/test/bom-routes.test.ts` — list endpoint: envelope `{data, pagination}`, `.strict()` param rejection, `search` across name/purl/licences, CSV filters OR, `direct`, `instanceId` merged-vs-scoped (`instanceCount`/`instanceTotal`), `view=tree` top-level + `hasChildren`/`childCount`, `parentId` children, sort whitelist, auth + 404s
- [x] T027 [P] [US2] `packages/backend/test/bom-summary.test.ts` — summary shape (`total`, `direct`, `ecosystems`, `licenseCount`, `hasNesting`, `lastReportedAt`, `staleThresholdDays` from settings, `sources[]` per-Source times, `instances[]` entryCounts); `GET /component-instances/:id/bom` returns exactly that instance's entries
- [x] T028 [P] [US2] `packages/frontend/src/test/unit/component-bom.test.tsx` — tab renders summary/table from hook data; URL param round-trip; filter→page reset; instance picker conditional; tree toggle conditional on `hasNesting`; flag off → tab absent

### Implementation for User Story 2

- [x] T029 [US2] `packages/backend/src/services/bom-service.ts` — `getBomForComponent(query)` implementing the merged/tree/children/parametrized reads in contracts/bom-api.md; `getBomSummary(componentId, instanceId)`; `getBomForInstance(instanceId, query)`
- [x] T030 [US2] `packages/backend/src/routes/components.ts` — `GET /components/:id/bom`, `GET /components/:id/bom/summary` (verifySession, Zod parse, error envelope); `packages/backend/src/routes/component-instances.ts` — `GET /component-instances/:id/bom`
- [x] T031 [US2] `packages/frontend/src/ux/lib/flags.ts` — `componentBom: false` + G36 doc comment; `ux/lib/domain.ts` — `BOM_SCOPE_META` + `BOM_EVIDENCE_META` (labels/tones/tooltips per UX-BOM-05/06, neutral/brand/info only); `ux/lib/view-types.ts` — `BomEntryView`, `BomSummaryView`
- [x] T032 [US2] `packages/frontend/src/api/hooks/bom.ts` + `api/mappers/bom.ts` — SWR hooks: `useBomList`, `useBomSummary`, `useBomChildren`, `exportBom` trigger (URL `q` → API `search` mapping)
- [x] T033 [US2] `packages/frontend/src/ux/components/patterns/tree-grid.tsx` — treegrid primitive per UX-A11Y-01 (`role="treegrid"`, `aria-level`/`aria-expanded`/`aria-posinset`/`aria-setsize`, arrow/Home/End keyboard model, roving tabindex, lazy children 50/page + "Show 50 more" + inline retry row)
- [x] T034 [US2] `packages/frontend/src/ux/components/patterns/status-badge.tsx` — `BomScopeBadge`, `BomEvidenceBadge` (dot+label+tooltip, restricted tones)
- [x] T035 [US2] `packages/frontend/src/ux/components/catalog/component-bom.tsx` — the tab: summary strip (5 facts + Source link), `ListToolbar` (`q`,`ecosystem`,`scope`,`found`,`catalog`-hidden-P1,`depth`,`instance`,`view`), flat table columns per UX-BOM-04 (+Transitive tag, licence `+N` chips, "in {parent}" line, `MonoValue` purl), row menu (Copy purl; See-where-used hidden until Phase 1b; In-catalog column hidden until `bomCuration`), `ListPagination`, footer disclaimer verbatim, state matrix UX-STATE-01…11, stale treatment UX-FRESH-02/03, multi-source popover UX-FRESH-04, export-menu slot, no advisories column (UX-BOM-16)
- [x] T036 [US2] `packages/frontend/src/ux/components/catalog/component-detail.tsx` — third tab `?tab=bom` with count, gated on `componentBom` flag (hidden not disabled)

**Checkpoint**: the tab reads real paginated inventory end-to-end — US2 complete

---

## Phase 5: User Story 3 — Ingest external SBOM via `importer-sbom-file` (P2)

**Goal**: CycloneDX/SPDX JSON at a URL lands on a slug-targeted component as an additional reporting Source

**Independent Test**: spec US3 scenarios 1–4 — both formats, tree depth, slug save/dispatch rules, double-ingest dedupe

### Tests for User Story 3 ⚠️ write FIRST

- [x] T037 [P] [US3] `packages/importer-sbom-file/test/cyclonedx.test.ts` — nested `components[]` → `children[]`, scope map (`required`→RUNTIME, `optional`→OPTIONAL, `excluded`→DEV, absent→RUNTIME), `dependencies[]` refining `direct`, licences/supplier/hashes→`details.checksums`, cpe→`details.cpe`, tools→`evidenceDetail` (`evidenceSource=SBOM_DOCUMENT`); `validateDiscoveredAsset` on yielded asset
- [x] T038 [P] [US3] `packages/importer-sbom-file/test/spdx.test.ts` — `externalRefs[purl]`→purl, `relationshipType`→scope table (all rows), `CONTAINS`/`CONTAINED_BY`→tree, `DESCRIBES`→subject, supplier prefix strip, `SPDXID`→`cdxBomRef`, checksums→details
- [x] T039 [P] [US3] `packages/backend/test/sbom-file-targeting.test.ts` — save-time: `componentSlug` rejected when missing/RETIRED; dispatch: slug→`(category, provider, externalId)` triple into scope; renamed/retired slug at dispatch → run FAILED with clear error, zero components/entries created

### Implementation for User Story 3

- [x] T040 [US3] `packages/importer-sbom-file/src/config.ts` — `{sbomUrl: url+HTTPS+url-safety refine, componentSlug: min(1)}` + `.describe` helper text naming the matching rule (UX-IMP-02); `src/manifest.ts` — `name:"sbom-file"`, `reportsSourceIdentity: true`, label/description
- [x] T041 [US3] `packages/importer-sbom-file/src/` — fetch `sbomUrl` (`context.resolveTarget` n/a — hub URL), auto-detect (`bomFormat==="CycloneDX"` / `spdxVersion`), CycloneDX+SPDX parsers → `DiscoveredBomEntry` tree per research tables; yield single `DiscoveredAsset` at the resolved identity triple + `bomEntries`; `bomInventory` UNAVAILABLE on fetch/parse failure
- [x] T042 [US3] Backend targeting — save: validate `componentSlug` resolves to an `ACTIVE` component in importer-config create/update (sbom-file only); dispatch: resolve slug→identity triple into the run scope in `import-run-service.ts`; unresolvable → run fails `TARGET_RESOLUTION_FAILED`-style error before importer starts

**Checkpoint**: both document formats ingest onto an existing component — US3 complete

---

## Phase 6: User Story 4 — Export BOM for external tools (P2)

**Goal**: streamed full-BOM download in Componode JSON / CycloneDX 1.5 / SPDX 2.3 with contract filenames

**Independent Test**: spec US4 scenarios 1–5 — schema-valid outputs, filenames, lossy notice, streaming, Viewer access, filters ignored

### Tests for User Story 4 ⚠️ write FIRST

- [x] T043 [P] [US4] `packages/backend/test/bom-export.test.ts` — `format=cyclonedx` output validates against vendored CycloneDX 1.5 schema via ajv; `format=spdx` validates against SPDX 2.3 schema incl. `CONTAINS` relationships; lossy scope mapping per research tables; `Content-Disposition` filenames (incl. `-{instance}` infix); Viewer role allowed; filters never applied
- [x] T044 [P] [US4] `packages/backend/test/bom-roundtrip.test.ts` — ingest SPDX doc → export CycloneDX → re-ingest → zero duplicates (SC-003)

### Implementation for User Story 4

- [x] T045 [US4] `packages/backend/src/services/bom-service.ts` — `buildCycloneDx()` / `buildSpdx()` / `buildComponodeJson()` serializers per research reverse-mapping tables; nesting → `components[]` / `CONTAINS`
- [x] T046 [US4] `GET /components/:id/bom/export` in `routes/components.ts` — `format`+`instanceId` params; streamed `reply.send(Readable)` over an async serializer generator; `Content-Disposition` + `Content-Type` per contracts/bom-api.md
- [x] T047 [US4] `packages/frontend/src/ux/components/catalog/bom-export-menu.tsx` — 3 items with audience descriptions, lossy notice + "always full BOM" lines above items, live-region start/finish announcements, toast+retry on failure; wire into `component-bom.tsx` export slot

**Checkpoint**: schema-valid exports download for all roles — US4 complete

---

## Phase 7: User Story 5 — Freshness & provenance (P3)

**Goal**: last-reported honesty — per-entry and per-Source timestamps, stale indicator, multi-source popover

**Independent Test**: spec US5 scenarios 1–3

- [ ] T048 [P] [US5] `packages/frontend/src/test/unit/bom-freshness.test.tsx` — stale threshold styling (warning tone + tooltip past `staleThresholdDays`), multi-source popover contents, row-hover Source name, `lastReportedAt` bump rendering
- [ ] T049 [US5] `component-bom.tsx` — stale *Last reported* (warning tone, "No import run has reported this inventory since {date}."), multi-source popover listing each Source + time, per-row source attribution on hover (UX-FRESH-01…05)

**Checkpoint**: freshness honest per state matrix — US5 complete

---

## Phase 8: User Story 6 — Lists, runs & importer configuration (P3)

**Goal**: BOM discoverability — list filter, dashboard line, run Packages tile, schema-driven toggles + capability notices

**Independent Test**: spec US6 scenarios 1–4

- [ ] T050 [P] [US6] `packages/backend/test/bom-list-filter.test.ts` — `listComponents` BOM filter (Has BOM / No BOM EXISTS-subquery) + dashboard `componentsWithBom` count
- [ ] T051 [US6] `packages/backend/src/services/component-catalog-service.ts` — `hasBom` filter param + dashboard-service `componentsWithBom` line (flag-gated surfacing)
- [ ] T052 [US6] `packages/frontend/src/ux/components/catalog/components-table.tsx` — BOM filter beside Coverage; dashboard coverage card "Components with a BOM" line (both under `componentBom`)
- [ ] T053 [US6] `packages/frontend/src/ux/components/importers/run-detail.tsx` — Packages tile (created/unchanged/updated/removed) from run contract fields; Changes tab untouched
- [ ] T054 [US6] Verify schema-driven forms render `includeDependencyGraph`/`includeSbom`/`includePodImageSbom`/sbom-file fields with the UX-IMP-02 helper texts (no bespoke code); `bomInventory` non-OK renders via the CapabilityNotice pattern

**Checkpoint**: BOM presence discoverable outside the tab — US6 complete

---

## Phase 9: Polish & Cross-Cutting

**Purpose**: governance, docs, e2e — the "same change" requirements

- [ ] T055 [P] ADR-057 Amendment 1 appended (`researches/adrs/ADR-057-*.md` — `bomEntries` = factual inventory, `relationships[]` prohibition unchanged); new `researches/adrs/ADR-131-bom-entry-entity.md` (tree, source-scoped diff-replace, field-presence, NULLS NOT DISTINCT, `resolvedComponentId` Phase-2 only); register ADR-131 in `researches/architecture-decisions.md`; Principle V clarification note in `.specify/memory/constitution.md`
- [ ] T056 [P] `docs/ux.md` — route map `?tab=bom`, BOM vocabulary (Package/Bill of materials/Found in/Add to catalog·Link reserved for P2), flag governance rows; `researches/ux-rewrite-gaps.md` — G36 entry (surface/capability/flag/flip-condition/fallback-hidden) + G40 (deferred, no flag, never rendered)
- [ ] T057 `docs/openapi.yaml` — all four endpoints + `x-permission`/`security` consistent with `verifySession` (ADR-104); run `pnpm --filter @componode/backend docs:api` + `docs:schema` + `docs:importers`; all `*:check` scripts green
- [ ] T058 [P] `docs/importers/sbom-file.md` NEW setup guide (what it imports, external setup, every config field, componentSlug rule, common failures); update `docs/importers/github.md`, `docker.md`, `kubernetes.md` for the new toggles + `bomInventory` behaviour; docs-site sidebar updated if the new page isn't already listed
- [ ] T059 [P] Update `AGENTS.md` importer enumeration — the in-tree set is 10 packages with `importer-docker` and `importer-sbom-file` (line currently says 8 and omits docker)
- [ ] T060 `playwright/tests/` — BOM e2e spec(s): tab states + URL round-trip + tree + export menu + stale/empty states, importer-form toggles, run Packages tile, list BOM filter (per FR-030); run `pnpm e2e` green
- [ ] T061 Full verification per quickstart.md + `pnpm lint && pnpm typecheck && pnpm test && pnpm build` + `pnpm audit --prod --audit-level=high`; fix AGENTS.md done-criteria deltas

---

## Dependencies & Execution Order

- **Phase 1 → 2**: sequential; contract/migration block everything.
- **US1 (Phase 3)** depends on Phase 2 (needs `processBomEntries` targets) — and conversely the write path is *delivered by* US1, so T018–T020 define it once for all later stories.
- **US2 (Phase 4)** depends on T010 + T018 (read needs stored rows); independent of US3–US6.
- **US3 (Phase 5)** depends on Phase 2 + T004; independent of US2.
- **US4 (Phase 6)** depends on T029 (reuses the full-BOM read); parallel to US3.
- **US5/US6** depend on US2 (surfaces) + US1 (data).
- **Phase 9** last — docs reflect shipped behaviour; T060 after all stories.

### Parallel opportunities

- T002/T003 (deps, schemas) || T001; T005/T006/T009 (core files) || T010/T011 (migrations); T013–T017 (all US1 tests); T026–T028 (US2 tests); T037–T039 (US3 tests); T043–T044 (US4 tests); importer work T022/T023/T024 (different packages); governance docs T055/T056/T058/T059.

## Implementation Strategy

**MVP**: Phases 1–3 (+ T029/T030 minimal read) — a populated, deduped, API-readable BOM. Then US2 unlocks the visible tab; US3/US4 complete interop; US5/US6 polish; Phase 9 ships governance+e2e. Commit per task/logical group (temp-file `-F` messages per AGENTS.md).
