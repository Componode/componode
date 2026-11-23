# Tasks: SBOM File Declared-Edge Carrier

**Input**: Design documents from `/specs/077-sbom-declared-edges/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D5), data-model.md, contracts/carrier-emission.md

**Tests**: Included — constitution VI (test-first) is non-negotiable; every surface sequences a failing test before its implementation. FR-008 requires `validateDiscoveredAsset` on every emitted asset in tests; FR-010 requires Playwright coverage.

**Organization**: Tasks are grouped by user story so each can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1/US2/US3)

---

## Phase 1: Setup — Shared LIBRARY-asset helpers (research D3)

**Purpose**: Hoist the GitHub carrier's private LIBRARY-asset shaping into `core` so the second carrier emits the identical contract (ADR-065 — importers can only share through core). Blocks US1's emission task.

- [x] T001 [P] `packages/core/test/utils/bom-library.test.ts` — NEW failing unit tests for the hoisted helpers: `purlType` extracts the type segment from `pkg:{type}/…` purls (falls back to `generic`); `generateComponentSlug` lowercases + hyphenates + strips edges; `buildLibraryAsset(identity, entry, relationships)` produces `category:"LIBRARY"`, `provider` via `mapEcosystemToProvider`, `resourceType` = purl type, `externalId` = the normalized version-free purl identity, `slug` = `pkg-{type}-{name}`, `details` = `{purl, version?}`, `instances: []`, `relationships` present only when non-empty, and passes `validateDiscoveredAsset`; `indexBomEntries` flattens `children[]`, keys by `normalizePurlIdentity(e.purl)`, first-wins on duplicates, skips un-normalizable purls
- [x] T002 `packages/core/src/utils/bom-library.ts` + `packages/core/src/index.ts` — NEW module hoisting `purlType`, `generateComponentSlug`, `buildLibraryAsset`, `indexBomEntries` verbatim from `packages/importer-github/src/importer.ts` (lines ~195–237); export all four via the core barrel
- [x] T003 `packages/importer-github/src/importer.ts` — delete the four local helpers and import them from `@componode/core` (also drop the now-unused `mapEcosystemToProvider`/`normalizePurlIdentity` imports if nothing else uses them); behavior-neutral refactor — the existing `packages/importer-github` test suite must stay green unchanged

**Checkpoint**: `pnpm --filter @componode/core test` new helper tests green; `pnpm --filter @componode/importer-github test` unchanged suite green.

---

## Phase 2: User Story 1 — Editor opts an SBOM File config into declared-edge import (P1) 🎯 MVP

**Goal**: `importDeclaredEdges` config + manifest key → opted-in run emits `relationships[]` on the configured-component asset and on `LIBRARY` assets for the document's dependency graph; off-state output byte-identical to today.

**Independent Test**: `pnpm --filter @componode/importer-sbom-file test` — opted-in SPDX + CycloneDX runs emit the full edge set through `validateDiscoveredAsset`; opt-out matches the pre-feature yield.

### Tests for User Story 1

- [x] T004 [P] [US1] `packages/importer-sbom-file/test/declared-edges.test.ts` — NEW failing test file reusing the `mockFetch`/`run`/`makeContext` pattern from `spdx.test.ts`: (a) config — `importDeclaredEdges` defaults `false`, accepts `true`, no precondition; `manifest.declaredEdgesConfigKey === "importDeclaredEdges"`; (b) SPDX opt-in — component asset `relationships[]` = subject-declared edges `{type:"DEPENDS_ON", targetExternalId:<normalized purl identity>}`; one `LIBRARY` asset per entry identity each carrying its outgoing edges; an edge targeting `SUBJECT` emits `targetExternalId === resolvedComponent.externalId` on the declaring library; every emitted asset passes `validateDiscoveredAsset`; (c) CycloneDX parity — same dependency graph produces the same emitted edge set; (d) opt-out — exactly one component asset, no `relationships`, zero `LIBRARY` yields; (e) opt-in + document with no dependency graph — `LIBRARY` assets yielded, `relationships` absent on all assets; (f) `relationships` omitted (not `[]`) on assets with no outgoing edges
- [x] T005 [P] [US1] `packages/importer-sbom-file/test/` (extend T004 file or existing) — degraded path regression: opted-in + fetch failure / unrecognized format yields exactly one degraded asset, no `relationships[]`, no `LIBRARY` yields

### Implementation for User Story 1

- [x] T006 [US1] `packages/importer-sbom-file/src/config.ts` — add `importDeclaredEdges: z.boolean().default(false).describe("Import declared dependencies as catalog edges. Imported dependencies are added to the catalog without review. You can hide any edge later.")` (verbatim UX-EDGE-03 copy — must match the GitHub field's describe string exactly); no precondition refine (research D4). `packages/importer-sbom-file/src/manifest.ts` — add `declaredEdgesConfigKey: "importDeclaredEdges"` with the ADR-133/spec-077 comment (mirrors `importer-github/src/manifest.ts`)
- [x] T007 [US1] `packages/importer-sbom-file/src/importer.ts` — after successful parse, when `parsed.importDeclaredEdges` (research D1/D2): map `result.edges` substituting `SPDX_EDGE_SUBJECT` → `resolved.externalId` in **both** positions; attach `relationships` to the component asset for `from === resolved.externalId` (omit when empty — carrier-1 convention); then yield one `buildLibraryAsset` per `[identity, entry]` of `indexBomEntries(result.entries)` with `relationships` for `from === identity` (omit when empty); run `validateDiscoveredAsset` on every yielded asset (component + libraries). Opt-out and degraded paths untouched

**Checkpoint**: US1 green — the importer emits the full declared-edge contract under opt-in and nothing under opt-out; zero backend/frontend changes needed (generic gating activates on the manifest key).

---

## Phase 3: User Story 2 — Imported edges behave like every importer-added edge (P1)

**Goal**: Prove the inherited ADR-133 machinery (provenance badge, Hide suppression, flag gating) works end-to-end for the sbom-file carrier — no new backend/frontend code.

**Independent Test**: Playwright journey — opted-in seeded sbom-file run materializes importer-labelled edges; Hide persists across a re-run; the form switch shows review-bypass copy and hides when the flag is off.

### Tests for User Story 2

- [X] T008 [P] [US2] `playwright/mocks/github/server.ts` — extend the `/sbom/cyclonedx.json` fixture: add a `bom-ref` to every component missing one (lodash, jest, golang.org/x/sys) and a `dependencies[]` graph with exactly one root ref nothing depends on (the document subject — put `bom-ref` on `metadata.component` or rely on single-root inference) → e.g. `root → express`, `root → lodash` (the disposable hideable pair, matching the spec-076 "own pair per project" pattern), `express → accepts`. Additive only — spec 073's `component-bom.spec.ts` assertions must stay green
- [X] T009 [US2] `playwright/tests/journeys/bom-importer-edges.spec.ts` (or sibling spec) — new journey reusing `triggerAndWait`/`findComponent`: patch the seeded `sbomConfigId` to `importDeclaredEdges:true` → trigger → `COMPLETED` → target component's Relationships shows **Added by importer** edges to `LIBRARY` components (express/lodash…) with Source+run links; `express → accepts` library edge exists; opt-in switch on the sbom-file form shows the review-bypass copy; **Hide edge** the disposable pair → re-trigger → edge does not return while others re-materialize with zero duplicates; `bomImporterEdges` flag OFF hides the switch

**Checkpoint**: US2 green — the generic edge pass + suppression + flag machinery verified against the second carrier with zero modifications (spec SC-005).

---

## Phase 4: User Story 3 — Importer setup guide documents the opt-in (P2)

**Goal**: `docs/importers/sbom-file.md` documents the new field per the importer contract.

**Independent Test**: guide renders the field in the contract table and explains review-bypass/hide-later semantics in prose; `docs:importers:check` reports no drift.

- [X] T010 [US3] `docs/importers/sbom-file.md` — add a prose section for `importDeclaredEdges` (default off): what it imports (document dependency graph → `DEPENDS_ON` catalog edges + `LIBRARY` components), review-bypass semantics verbatim, hide-later via **Hide edge**, and that edges retire when the document stops declaring them; run `pnpm --filter @componode/backend docs:importers` to regenerate the `GENERATED:contract` table; `docs:importers:check` green

---

## Phase 5: Polish & Cross-Cutting

**Purpose**: Governance back-pointers + full verification.

- [X] T011 [P] `researches/adrs/ADR-133-importer-declared-component-edges.md` — record `importer-sbom-file` as the second carrier (carrier note only — no contract text change); scan `docs/architecture.md` for any importer-carrier enumeration that should name sbom-file
- [X] T012 Full verification — `pnpm lint && pnpm typecheck && pnpm test && pnpm build` in each changed package (`core`, `importer-github`, `importer-sbom-file`) + root `pnpm build`; `pnpm e2e` targeted subset (`--grep "sbom\|importer edges"`) green; quickstart.md scenarios A–C spot-check; AGENTS.md done-criteria sweep (ADR back-pointer ✅, importer guide ✅, roadmap entry reserved for ship stage, openapi.yaml unchanged — no endpoint changes)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (helpers hoist)**: No dependencies — blocks only T007's emission (imports the helpers)
- **Phase 2 (US1)**: Depends on Phase 1 (T002 exports) — T004/T005 tests can be written in parallel with Phase 1 but fail until T006/T007 land
- **Phase 3 (US2)**: Depends on Phase 2 (needs the emission to e2e-verify) — T008's fixture change is independent and can parallel Phase 2
- **Phase 4 (US3)**: Depends on T006 (the manifest field regenerates the doc table)
- **Phase 5**: Depends on all stories

### User Story Dependencies

- **US1**: self-contained after Phase 1 — the MVP
- **US2**: verifies US1's output through inherited machinery — no new app code, only e2e fixture + journey
- **US3**: depends only on US1's config field existing

### Parallel Opportunities

- T001 (core tests) ∥ T004+T005 (sbom-file tests) ∥ T008 (fixture) — three independent files, all writable up-front as failing tests
- T003 (github refactor) ∥ T006 (sbom-file config/manifest)
- T011 (ADR note) ∥ T010 (docs) once T006 lands

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: helpers hoisted, github green
2. Phase 2: sbom-file emits `relationships[]` + `LIBRARY` assets under opt-in — importer tests green
3. **STOP and VALIDATE**: unit-level contract complete; backend machinery picks it up with zero changes

### Incremental Delivery

1. US1 → importer emits the full contract (deliverable alone: feature works via API)
2. US2 → e2e proves provenance/hide/flag inheritance for this carrier
3. US3 → guide + governance complete the ship checklist

## Phase 6: Convergence

- [X] T013 [US2] Extend `playwright/tests/journeys/sbom-file-edges.spec.ts` for SC-003/US2/AC4 literal coverage (partial): (a) after the hide test's re-run assertion, trigger one more completed run and re-assert the suppressed pair stays absent (≥2 subsequent runs); (b) curated coexistence — add `golang.org/x/sys` to the subject's `dependsOn` in the mock fixture, and in `beforeAll` (only in the project that creates the config, before its first trigger) mint a CURATED `pw-edge-* → pkg:golang/golang.org/x/sys` edge via the curation route (`POST /api/v1/packages/add-to-catalog` or `/packages/link` — read the body schema in `packages/core`/`packages.ts` first; it must mint the LIBRARY + edge before the run imports the pair), then after the run assert the row on golang's `dependedOnBy` lane shows **Curated** — never relabelled, overwritten, or duplicated (per US2/AC4 + SC-003)

## Phase 7: Review

- [X] T014 [code-review: spec] Prove source-scoped edge retirement end-to-end (US2/AC3, SC-002 — HIGH): add a mutable mock endpoint `/sbom/cyclonedx-edges-retire.json` in `playwright/mocks/github/server.ts` that serves a doc declaring `root → debug` + `debug → ms` on the first request per `?seq=` key and `root → debug` only afterwards (per-project counter so each Playwright project gets its own v1→v2 sequence); in `sbom-file-edges.spec.ts` create a config at `…retire.json?seq=${project.name}` (ADMIN api), run once, assert `pkg-npm-ms`'s `libraries-summary-dependedOnBy` shows `1 library`, run again, assert that summary is gone while `pkg-npm-debug`'s dependedOnBy lane still shows the `PW Edge Target` importer row — exactly the removed declaration retires
- [X] T015 [code-review: spec] Exercise the form opt-in end-to-end (US1/AC1 — HIGH): extend the opt-in-switch test in `sbom-file-edges.spec.ts` to fill the create form (`#i-label`, `#i-scope-sbomUrl` with a never-fetched dummy URL, `#i-scope-componentSlug` with `seed().edgeSlug`), toggle `#i-scope-importDeclaredEdges` on, submit `Create importer`, then verify via ADMIN `GET /api/v1/importer-configs` that the created config persisted `scope.importDeclaredEdges === true`
- [X] T016 [code-review: spec] Assert zero-duplicate re-materialization (US1/AC7 — MEDIUM): in the hide/rerun test, after the final run assert the surviving `PW Edge Target → express` row matches exactly once on express's dependedOnBy lane
- [X] T017 [code-review: standards] Hoist the duplicated edge projection into `packages/core/src/utils/bom-library.ts` as `dependsOnRels(edges, fromId)` (filter `e.from === fromId` → `{type:"DEPENDS_ON", targetExternalId:e.to}`); use it at all 4 sites (importer-github ×2, importer-sbom-file ×2); extend `bom-library.test.ts`
- [X] T018 [code-review: standards] Stop hand-rolling purl/slug normalization in `bom-library.ts`: `purlType` delegates to `purlEcosystem(purl) || "generic"` (purl.ts: per-type normalization is NOT hand-rolled); `generateComponentSlug` delegates to `packageSlugToken` (verified output-equivalent); `buildLibraryAsset` slug falls back to `unnamed` when the name token is empty (avoids malformed `pkg-{type}-` slugs)
- [X] T019 [code-review: standards] Report `Completed` after the LIBRARY yields (github convention), and bump `importer-sbom-file` manifest `version` to `1.1.0` (additive field — github bumped to 1.2.0 for the same change); regenerate importer docs if the version surfaces there
- [X] T020 [code-review: spec] Fix doc artifacts: amend `contracts/carrier-emission.md`'s invariant — emission is verbatim and unresolved targets rely on the pass's silent-drop rule (spec edge case), not on importer-side resolution; update the stale CONTEXT.md line claiming Library components are "created only through Add to catalog" (importer-native libraries exist since spec 076); fix the misleading `'golang.org/x/sys'` slug argument/comment in `sbom-file-edges.spec.ts` (it matches via the `c.name` fallback)

- [X] T021 [code-review: spec] HIGH — make `relationships` field-presence the run's edge-completeness signal (US2/AC5, FR-007; a degraded yield must not retire prior importer edges): (a) declaring positions emit `[]` for authoritative-empty under opt-in — sbom-file subject asset always emits `relationships` when `importDeclaredEdges`, github repo asset emits it whenever `bomEdges !== undefined`; (b) backend gates `runImporterEdgePass` on "at least one yielded asset carried the `relationships` field" in both run services (import-run-service.ts, remote-run-service.ts) — a degraded/non-graph run declares nothing → pass skipped → prior edges preserved; (c) backend test: curated-test run-2 yields `repoAsset("repo-a", [])` to declare authoritatively-empty, plus a NEW test proving a non-declaring run preserves prior edges; (d) importer tests assert the `[]` presence contract
- [X] T022 [code-review: standards] Bump `SbomFileImporter.readonly version` to `1.1.0` (matches manifest); fix the remaining stale CONTEXT.md Library-component definition line (~:233 "created via Add to catalog")
- [X] T023 [code-review: spec] e2e hygiene: beforeAll matches `scope.sbomUrl === SBOM_EDGES_URL` only (label `startsWith` could adopt -retire/-v2/-ui configs); v2 config URL gets `?p=${project.name}` for per-project Source isolation; retire seq + config label include `testInfo.retry` so a retried attempt gets a fresh v1→v2 sequence (US2/AC5 degraded preservation is proven by the new backend integration test in T021, not a third e2e run — a degraded run's unmarked yield would confound the assertion via membership reconciliation)
- [X] T024 [code-review: spec] Doc amendments: spec FR-006 deviation note (minimal authority gate required by FR-007's degraded clause — the only backend change); carrier-emission.md invariant — declaring positions emit `relationships: []` for authoritative-empty under opt-in; absence on every yielded asset marks the run non-authoritative (degraded/non-graph), mirroring the bomEntries presence doctrine (ADR-057 A1)
