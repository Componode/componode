# Tasks: Docker Importer Declared-Edge Carrier

**Input**: Design documents from `/specs/078-docker-declared-edges/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D6), data-model.md, contracts/carrier-emission.md

**Tests**: Included — constitution VI (test-first) is non-negotiable; every surface sequences a failing test before its implementation. FR-009 requires `validateDiscoveredAsset` on every emitted asset in tests; FR-011 requires Playwright coverage.

**Organization**: Tasks are grouped by user story so each can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1/US2/US3)

---

## Phase 1: Setup — Surface `edges` on `ImageBomResult` (research D1)

**Purpose**: Stop discarding the parsed dependency graph on both collection paths (OCI referrers in core — CycloneDX + SPDX; Syft fallback in importer-docker). Blocks US1's emission — `bom.edges` must exist before the importer can consume it.

- [x] T001 [P] `packages/core/test/utils/oci-referrers.test.ts` — NEW failing unit tests: (a) CycloneDX attestation with `dependencies[]` → `ImageBomResult.edges` carries normalized version-free purl-identity pairs with the `SPDX_EDGE_SUBJECT` sentinel for subject-declared edges; (b) SPDX attestation with `DESCRIBES`/`DEPENDS_ON` relationships → same `edges` contract (format parity); (c) attestation with no dependency graph → `edges` present and `[]` alongside `entries`; (d) no attestation / registry error → `edges` undefined alongside `entries` (marker still records cause)
- [x] T002 `packages/core/src/utils/oci-referrers.ts` — `ImageBomResult` gains `edges?: SpdxEdge[]`; `parseDoc` returns the full `BomParseResult` (not `.entries`); `fetchReferrersBom` propagates `{ entries, edges }` on the first parseable doc (keep the `entries.length` guard — `edges` rides with `entries`); `fetchImageBom` copies `edges` onto the OK-path result; import the `SpdxEdge` type. No signature changes for `entries`-only callers.
- [x] T003 `packages/importer-docker/src/docker-sbom.ts` — `fetchSyftBom` keeps the full `BomParseResult` (`{ entries, edges } | null` — still `null` when `entries` empty) and `fetchImageBom` wraps the fallback into `{ entries, edges, marker: { status: "OK" } }` so both paths return identical `ImageBomResult` shape. `importer-kubernetes` needs no change (it reads `.entries` only) — verify its suite stays green.

**Checkpoint**: `pnpm --filter @componode/core test` new edge-surfacing tests green; `pnpm --filter @componode/importer-kubernetes test` and existing `importer-docker` SBOM tests green unchanged.

---

## Phase 2: User Story 1 — Editor opts a Docker config into declared-edge import (P1) 🎯 MVP

**Goal**: `importDeclaredEdges` config (+ `includeSbom` refine) + manifest key → opted-in run emits `relationships[]` on every bom-bearing asset (workload CONTAINER + `docker-image:*` PACKAGE_REGISTRY carriers) and `LIBRARY` assets for the document's package graph; off-state output identical to today.

**Independent Test**: `pnpm --filter @componode/importer-docker test` — opted-in runs emit the full edge set through `validateDiscoveredAsset`; opt-out matches the pre-feature yield; refine rejects `importDeclaredEdges` without `includeSbom`.

### Tests for User Story 1

- [x] T004 [P] [US1] `packages/importer-docker/test/declared-edges.test.ts` — NEW failing test file reusing the `collectAssets`/dockerode-mock + referrers/Syft-stub pattern from `sbom.test.ts`: (a) config — `importDeclaredEdges` defaults `false`; schema rejects `importDeclaredEdges:true` without `includeSbom:true` (message on `importDeclaredEdges` path); accepts both `true`; `manifest.declaredEdgesConfigKey === "importDeclaredEdges"`; (b) opt-in emission — workload asset `relationships` = doc `SUBJECT → pkg` edges as `{type:"DEPENDS_ON", targetExternalId:<normalized purl identity>}`; one `LIBRARY` asset per unique identity per run carrying `dependsOnRels` package→package edges; doc edge `pkg → SUBJECT` emits `targetExternalId === "docker-image:{digestRef}"`; every emitted asset passes `validateDiscoveredAsset`; (c) `includeImages` on — the `docker-image:*` PACKAGE_REGISTRY asset carries subject edges too (every SBOM-bearing asset is a carrier); two workloads sharing one digest each declare their own subject edges while the shared `LIBRARY` yields once; (d) doc with no dependency graph — carrier `relationships` present and `[]` (authoritative-empty), `LIBRARY` assets still yielded with no `relationships`; (e) bomless/degraded carrier (no RepoDigest, registry 404) — `relationships` field absent entirely; (f) opt-out — zero `relationships`, zero `LIBRARY` yields, output identical to today
- [x] T005 [P] [US1] `packages/importer-docker/test/` (extend T004 file or `sbom.test.ts`) — regression: opted-in run where one image's SBOM fails while another succeeds — the failed image's carrier omits `relationships`, the successful one declares normally (partial degradation stays non-authoritative for the failed carrier only)

### Implementation for User Story 1

- [x] T006 [US1] `packages/importer-docker/src/config.ts` — rename current schema to `dockerConfigBase` (unrefined — `testSecrets` calls `.partial()`, which Zod 4 refuses on refined schemas; github precedent), add `importDeclaredEdges: z.boolean().default(false).describe("Import declared dependencies as catalog edges. Imported dependencies are added to the catalog without review. You can hide any edge later.")` (verbatim UX-EDGE-03 copy — must match the github/sbom-file field's describe string exactly), and export `dockerConfigSchema = dockerConfigBase.refine((c) => !c.importDeclaredEdges || c.includeSbom, { message: "Declared-edge import requires the SBOM inventory", path: ["importDeclaredEdges"] })`. `packages/importer-docker/src/manifest.ts` — add `declaredEdgesConfigKey: "importDeclaredEdges"` with the ADR-133/spec-078 comment and bump `version` to `1.1.0` (additive field — sbom-file bumped for the same change).
- [x] T007 [US1] `packages/importer-docker/src/importer.ts` — emission under `parsed.importDeclaredEdges` (research D2/D4/D5, contract `carrier-emission.md`): (a) restructure `bomForRef` to expose `digestRef` alongside the result; (b) when `bom.entries` attaches to a carrier — workload assets AND `docker-image:*` image assets — set `asset.relationships = dependsOnRels(edges', carrierExternalId)` where `edges'` maps `from === SPDX_EDGE_SUBJECT → carrierExternalId` and `to === SPDX_EDGE_SUBJECT → docker-image:{digestRef}`; `relationships` present (possibly `[]`) exactly when `bomEntries` is present, omitted otherwise; (c) maintain a run-level `yieldedLibraries: Set<string>` and at each opted-in `bom.entries` point yield `buildLibraryAsset(identity, entry, dependsOnRels(edges', identity))` for each `[identity, entry]` of `indexBomEntries(bom.entries)` not yet yielded; (d) `validateDiscoveredAsset` every yield (carrier + libraries); (e) switch `testSecrets`' parse to `dockerConfigBase.partial()`. Bump `DockerImporter.readonly version` to `1.1.0` (matches manifest).

**Checkpoint**: US1 green — the importer emits the full declared-edge contract under opt-in and nothing under opt-out; zero backend/frontend changes needed (generic gating activates on the manifest key + field-presence authority).

---

## Phase 3: User Story 2 — Imported edges behave like every importer-added edge (P1)

**Goal**: Prove the inherited ADR-133 machinery (provenance badge, Hide suppression, source-scoped retirement, flag gating) works end-to-end for the docker carrier — no new backend/frontend code.

**Independent Test**: Playwright journey — opted-in docker run materializes importer-labelled edges; Hide persists across a re-run; the form switch shows review-bypass copy, hides when the flag is off, and the save-time refine rejects `importDeclaredEdges` without `includeSbom`.

### Tests for User Story 2

- [x] T008 [P] [US2] `playwright/mocks/docker-engine/server.ts` — add OCI registry routes on the same TLS listener (research D6): `/v2/{repo}/referrers/{digest}` → OCI index with one SBOM manifest (`artifactType: application/vnd.cyclonedx+json`), `/v2/{repo}/manifests/{digest}` → manifest with one blob layer, `/v2/{repo}/blobs/{digest}` → a CycloneDX doc with `bom-ref`s, `metadata.component`, and a `dependencies[]` graph: `subject → pw-app`, `subject → express`, `express → accepts` (disposable hideable pair pattern from spec 076/077) plus `pw-lib → subject` (a `package → SUBJECT` edge to prove the `docker-image:{digest}` target rule). Gate all of it — plus a `RepoDigests` entry of `mock-docker-engine:2376/<repo>@sha256:<64-hex>` on the image inspect — behind a `__control` scenario (e.g. `sbom`) so the default scenario's existing specs stay green (digest must be 64-hex for `parseRepoDigest`; `registry-1.docker.io` fallback must never be exercised).
- [x] T009 [US2] `playwright/tests/importers/docker-declared-edges.spec.ts` — NEW journey spec reusing `triggerAndWait`/`findComponent` + the mock `__control` scenario switch: create a docker importer config (ADMIN api) with `targetId` of the seeded target, `includeSbom: true`, `importDeclaredEdges: true` (per-project label/URL params for isolation) → trigger → `COMPLETED` → the workload component's Relationships shows **Added by importer** `DEPENDS_ON` edges to `LIBRARY` components (pw-app/express…) with Source+run links; `express → accepts` library edge exists; `pw-lib → docker-image:{digest}` edge exists when the image asset is yielded (config `includeImages: true`); **Hide edge** the disposable pair → re-trigger → suppressed pair absent while others re-materialize with zero duplicates; second identical run adds no duplicates. Separately: `POST /importer-configs` with `importDeclaredEdges: true` and `includeSbom` absent → 400 refine rejection; the docker form shows the opt-in switch with review-bypass copy and hides it when `bomImporterEdges` is OFF.

**Checkpoint**: US2 green — the generic edge pass + suppression + flag machinery verified against the third carrier with zero backend/frontend modifications (SC-005).

---

## Phase 4: User Story 3 — Importer setup guide documents the opt-in (P2)

**Goal**: `docs/importers/docker.md` documents the new field per the importer contract.

**Independent Test**: guide renders the field in the contract table and explains review-bypass/`includeSbom`/hide-later semantics in prose; `docs:importers:check` reports no drift.

- [x] T010 [US3] `docs/importers/docker.md` — add a prose section for `importDeclaredEdges` (default off, requires `includeSbom`): what it imports (image SBOM dependency graphs → `DEPENDS_ON` catalog edges on `LIBRARY` components, subject edges on every asset carrying the image's BOM — workloads and the image component), review-bypass semantics verbatim, hide-later via **Hide edge**, and that edges retire when the SBOM stops declaring them; run `pnpm --filter @componode/backend docs:importers` to regenerate the `GENERATED:contract` table; `docs:importers:check` green

---

## Phase 5: Polish & Cross-Cutting

**Purpose**: Governance back-pointers + full verification.

- [x] T011 [P] `researches/adrs/ADR-133-importer-declared-component-edges.md` — record `importer-docker` as the third carrier (carrier note only — no contract text change; note the multi-carrier SUBJECT expansion + `docker-image:{digest}` target rule); scan `docs/architecture.md` for any importer-carrier enumeration that should name docker
- [x] T012 Full verification — `pnpm lint && pnpm typecheck && pnpm test && pnpm build` in each changed package (`core`, `importer-docker`) + `importer-kubernetes` test parity + `backend` suite unchanged + root `pnpm build`; `pnpm e2e` targeted subset (`--grep "docker.*edge|docker.*declared"`) green; quickstart.md scenarios A–D spot-check; AGENTS.md done-criteria sweep (ADR back-pointer ✅, importer guide ✅, roadmap entry reserved for ship stage, openapi.yaml unchanged — no endpoint changes)

---

## Phase 6: Review — code-review findings (fixed point `main`)

**Source**: `code-review` skill, two axes (standards + spec) run against the worktree diff vs `main`. Ordered CRITICAL/HIGH first.

- [x] T013 [US1] `packages/importer-docker/src/importer.ts` + `test/declared-edges.test.ts` — **code-review: spec**: cross-image library edge under-emission. `libraryAssetsFor` skips already-yielded purl identities, so a `package → package` edge declared only in a later image's SBOM for an already-yielded purl is dropped; the spec's edge case requires *all* `package → package` edges to declare on that single yield. Collect each identity's `dependsOnRels` union across every SBOM in the run before yielding the `LIBRARY` asset (or merge into the first yield). Add a failing test: two images sharing package P where only the second SBOM declares `P → Q` — the single P `LIBRARY` yield must carry `P → Q`.
- [x] T014 [US1] `packages/importer-docker/test/declared-edges.test.ts` — **code-review: spec** + **code-review: standards** (coverage): SC-001 claims collection-path parity across referrers-CDX, referrers-SPDX, and Syft, but no test exercises the Syft fallback's `edges` propagation. Add a test stubbing `fetchSyftBom`/`execFile` (the T004-planned Syft-stub pattern) proving an opted-in Syft-sourced BOM emits the same `relationships[]`/`LIBRARY` contract.
- [x] T015 [US2] `playwright/mocks/docker-engine/server.ts` + `playwright/tests/importers/docker-declared-edges.spec.ts` — **code-review: spec**: US2/SC-002 retirement-on-removal is unverified — the mock serves one static SBOM. Add a mutable registry scenario (e.g. a `__control` call or variant flag that swaps the SBOM document to one missing the `subject → express`/`express → accepts` edges) and a journey step: run → swap → run → the removed edge retires while the rest persist.
- [x] T016 [US3] `docs/importers/docker.md` — **code-review: standards** (hard): the line "An image whose SBOM is missing or unreadable keeps its previously imported edges untouched" is false — the edge pass retires source-wide once any carrier declares, so a partially degraded run retires the failed image's prior edges. Correct the prose to describe source-scoped retirement semantics accurately.
- [x] T017 [US1] `packages/importer-docker/src/importer.ts` — **code-review: standards** (Duplicated Code): the `to === SPDX_EDGE_SUBJECT → docker-image:${digestRef}` edge mapping appears at two sites; extract a shared `resolveSubjectEdges(edges, digestRef)` (or equivalent) helper called from both.
- [x] T018 [US1] `packages/importer-docker/test/declared-edges.test.ts` + `playwright/tests/importers/docker-declared-edges.spec.ts` — **code-review: standards** (hygiene): remove the dead `const field = …; void field;` statement; fix the misleading "distinct source identity" comment (source identity is `docker-engine:{/info.ID}`, shared with sibling specs — the isolation comes from the dedicated config, not the Source); add the `validateDiscoveredAsset` loop to the degraded-carrier and opt-out tests for FR-009 parity.
- [x] T019 [US1] `packages/importer-docker/src/docker-sbom.ts` — **code-review: standards** (dead parameter): `opts.imageRef` is accepted and passed at both call sites but never read in the body — remove the parameter (and its call-site arguments) or confirm it was intended for a marker/log and use it.

### Round 2

- [x] T020 [US2] `playwright/tests/importers/docker-declared-edges.spec.ts` — **code-review: spec** (US2/AS6): no coverage proved opt-out runs leave existing importer edges untouched. Added a final journey test: PATCH the config to `importDeclaredEdges:false`, trigger, verify subject/library edges persist (field-presence gate — no declaring asset, no retirement). beforeAll now re-asserts the declaring scope so config reuse stays self-healing.
- [x] T021 [US2] `playwright/tests/importers/docker-declared-edges.spec.ts` — **code-review: spec** (latent defect): beforeAll looked up `label === 'pw-docker-edges'` but creates `pw-docker-edges-{project}` — the find never matched, so re-runs on a persistent stack would hit duplicate-label create. Find now uses the project-suffixed label.
- [x] T022 [US1] `packages/importer-docker/src/docker-sbom.ts` — **code-review: spec** (dead API residue): after T019, `opts: { syft?: boolean }` had zero callers passing it — removed the parameter and the `syft === false` branch entirely.
- [x] T023 [US2] Disposition note — **code-review: spec** (US2/AS3+AS4): "other Sources' edges untouched" and "a human-curated edge on a declared pair stays Curated" have no docker-specific e2e added. AS4 is unreachable through `packages/link` for this carrier — every docker-declared pair either already carries an importer edge post-seeding or involves a library consumer with no bom_entries, so a pre-declaration curated pair can't be created; the conflict-safe write itself is e2e-proven on the identical generic machinery by `sbom-file-edges.spec.ts` ("a curated edge on a declared pair is never relabelled"). AS3 is untestable in a single-source mock — same machinery, also covered by the sbom-file/github carrier journeys. No additional docker coverage warranted.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (edge surfacing)**: No dependencies — blocks only T007's emission (consumes `bom.edges`)
- **Phase 2 (US1)**: Depends on Phase 1 (T002 field) — T004/T005 tests can be written in parallel with Phase 1 but fail until T003/T006/T007 land
- **Phase 3 (US2)**: Depends on Phase 2 (needs the emission to e2e-verify) — T008's mock change is independent and can parallel Phase 2
- **Phase 4 (US3)**: Depends on T006 (the manifest field regenerates the doc table)
- **Phase 5**: Depends on all stories

### User Story Dependencies

- **US1**: self-contained after Phase 1 — the MVP
- **US2**: verifies US1's output through inherited machinery — no new app code, only mock routes + journey
- **US3**: depends only on US1's config field existing

### Parallel Opportunities

- T001 (core tests) ∥ T004+T005 (docker tests) ∥ T008 (mock routes) — three independent files, all writable up-front as failing tests
- T003 (syft path) ∥ T006 (config/manifest) — different files
- T011 (ADR note) ∥ T010 (docs) once T006 lands

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: `edges` surfaced on `ImageBomResult` on both paths, kubernetes green
2. Phase 2: importer-docker emits `relationships[]` + `LIBRARY` assets under opt-in — importer tests green
3. **STOP and VALIDATE**: unit-level contract complete; backend machinery picks it up with zero changes

### Incremental Delivery

1. US1 → importer emits the full contract (deliverable alone: feature works via API)
2. US2 → e2e proves provenance/hide/flag/refine inheritance for this carrier
3. US3 → guide + governance complete the ship checklist
