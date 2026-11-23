# Tasks: Kubernetes Declared-Edge Carrier

**Input**: Design documents from `/specs/079-kubernetes-declared-edges/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D5), data-model.md, contracts/carrier-emission.md

**Tests**: Included — constitution VI (test-first) is non-negotiable; every surface sequences a failing test before its implementation. FR-009 requires `validateDiscoveredAsset` on every emitted asset in tests; FR-011 requires Playwright coverage.

**Organization**: Tasks are grouped by user story so each can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1/US2/US3)

---

## Phase 1: Setup — Surface `edges` on `PodImageBom` (research D1)

**Purpose**: Stop discarding the parsed dependency graph at the collection site — `collectPodImageBoms` reads `ImageBomResult.edges` (populated since spec 078) and carries the per-workload union forward with target-position `SUBJECT` resolved while `digestRef` is still in scope. Blocks US1's emission — `bom.edges` must exist before `importer.ts` can consume it.

- [x] T001 [P] `packages/importer-kubernetes/test/declared-edges.test.ts` — NEW failing test file, `collectPodImageBoms`-level cases reusing the `mockApi` fetch-stub pattern from `pod-image-sbom.test.ts`: (a) a pod image whose SBOM (CycloneDX doc with `dependencies[]`, or SPDX with `DEPENDS_ON`/`DEPENDENCY_OF` relationships) declares `SUBJECT → pkg` + `pkgA → pkgB` + `pkg → SUBJECT` edges → the workload's `PodImageBom.edges` carries the union with `from === SPDX_EDGE_SUBJECT` intact and `to === SPDX_EDGE_SUBJECT` resolved to `docker-image:{digestRef}` (64-hex digest ref, e.g. `mock.example.test/repo@sha256:a…`); (b) a second pod image on the same workload contributes its own document's edges to the same union — duplicates collapse on `(from, to)`; (c) an image with no attestation contributes no edges; `edges` is absent (not `[]`) when `entries` is absent; (d) `edges` present (possibly `[]`) exactly when `entries` is present
- [x] T002 `packages/importer-kubernetes/src/k8s-pods.ts` — `PodImageBom` gains `edges?: { from: string; to: string }[]`; inside the per-image loop where `result.entries` resolved, accumulate `result.edges` with `to === SPDX_EDGE_SUBJECT → \`docker-image:${digestRef}\`` into a per-workload `(from,to)`-deduped list (per-image `resolveSubjectTargets` shape — the docker `importer.ts` precedent); attach `edges` to the workload's `PodImageBom` iff `entries` was set. Import `SPDX_EDGE_SUBJECT` + the `SpdxEdge` type from `@componode/core`. No signature or marker-semantics changes.

**Checkpoint**: T001 green; `pnpm --filter @componode/importer-kubernetes test` existing suites (`importer.test.ts`, `pod-image-sbom.test.ts`) green unchanged.

---

## Phase 2: User Story 1 — Editor opts a Kubernetes config into declared-edge import (P1) 🎯 MVP

**Goal**: `importDeclaredEdges` config (+ `includePodImageSbom` refine) + manifest key → opted-in run emits `relationships[]` on every bom-bearing workload asset and `LIBRARY` assets for the documents' package graph; off-state output identical to today.

**Independent Test**: `pnpm --filter @componode/importer-kubernetes test` — opted-in runs emit the full edge set through `validateDiscoveredAsset`; opt-out matches the pre-feature yield; refine rejects `importDeclaredEdges` without `includePodImageSbom`.

### Tests for User Story 1

- [x] T003 [P] [US1] `packages/importer-kubernetes/test/declared-edges.test.ts` — extend with importer-level cases (config flows through `KubernetesImporter.run` + `mockApi`): (a) config — `importDeclaredEdges` defaults `false`; schema rejects `importDeclaredEdges:true` without `includePodImageSbom:true` (message on `importDeclaredEdges` path); accepts both `true`; accepts `importDeclaredEdges:true` + `includePodImageSbom:true` under `sourceKey`-only config (no `endpoint` — refine must not require it, research D3); `manifest.declaredEdgesConfigKey === "importDeclaredEdges"`; (b) opt-in emission — workload asset `relationships` = carried docs' `SUBJECT → pkg` edges as `{type:"DEPENDS_ON", targetExternalId:<normalized purl identity>}` resolved onto the workload's own externalId; `pkg → SUBJECT` emits `targetExternalId === "docker-image:{digestRef}"`; every emitted asset passes `validateDiscoveredAsset`; (c) LIBRARY drain — one `LIBRARY` asset per unique identity per run carrying the **run-wide union**: two workloads/images sharing package P where only the second SBOM declares `P → Q` → the single P yield carries `P → Q` (docker T013 regression guard); (d) doc with no dependency graph — carrier `relationships` present and `[]` (authoritative-empty), `LIBRARY` assets still yielded with no `relationships`; (e) degraded carrier (no referrers, undigestable ref, `sourceKey`-only, pod 403) — `relationships` field absent entirely; (f) partial coverage — workload with one resolving image + one failing image emits `bomEntries`+`relationships` for the resolved set only (authoritative for it); (g) opt-out — zero `relationships`, zero `LIBRARY` yields, output identical to today
- [x] T004 [P] [US1] `packages/importer-kubernetes/test/importer.test.ts` — regression guard stays green: a non-opted run over `includePodImageSbom` produces `bomEntries` without `relationships`/`LIBRARY` (extend with explicit absence assertions if not already covered)

### Implementation for User Story 1

- [x] T005 [US1] `packages/importer-kubernetes/src/config.ts` — add `importDeclaredEdges: z.boolean().default(false).describe("Import declared dependencies as catalog edges. Imported dependencies are added to the catalog without review. You can hide any edge later.")` (verbatim UX-EDGE-03 copy — must match the github/sbom-file/docker field's describe string exactly) and stack a refinement `(c) => !c.importDeclaredEdges || c.includePodImageSbom` (message on `importDeclaredEdges` path, docker's "Declared-edge import requires the SBOM inventory" wording adapted to kubernetes) onto the existing schema — no base split needed (no `testSecrets` `.partial()` consumer, research D3). `packages/importer-kubernetes/src/manifest.ts` — add `declaredEdgesConfigKey: "importDeclaredEdges"` with the ADR-133/spec-079 comment and bump `version` to `1.1.0` (carrier precedent).
- [x] T006 [US1] `packages/importer-kubernetes/src/importer.ts` — emission under `parsed.importDeclaredEdges` (research D2/D4, contract `carrier-emission.md`): (a) when `bom.entries` attaches to a workload asset, set `asset.relationships = dependsOnRels(edges', asset.externalId)` where `edges'` maps `from === SPDX_EDGE_SUBJECT → asset.externalId` over `bom.edges`; `relationships` present (possibly `[]`) exactly when `bomEntries` is present, omitted otherwise; (b) run-level `libraryEntries`/`libraryEdges` maps fed from each opted-in `bom` (`indexBomEntries(bom.entries)` + the target-resolved `bom.edges`); drain after the `resourceTypes` loop — `buildLibraryAsset(identity, entry, dependsOnRels(allEdges, identity))` per identity; (c) `validateDiscoveredAsset` every yield (carrier + libraries); bump `KubernetesImporter.readonly version` to `1.1.0` (matches manifest).

**Checkpoint**: US1 green — the importer emits the full declared-edge contract under opt-in and nothing under opt-out; zero backend/frontend changes needed (generic gating activates on the manifest key + field-presence authority).

---

## Phase 3: User Story 2 — Imported edges behave like every importer-added edge (P1)

**Goal**: Prove the inherited ADR-133 machinery (provenance badge, Hide suppression, source-scoped retirement, flag gating) works end-to-end for the kubernetes carrier — no new backend/frontend code.

**Independent Test**: Playwright journey — opted-in kubernetes run materializes importer-labelled edges; Hide persists across a re-run; `sbom-reduced` retires exactly `express → accepts`; `pw-lib → root` drops (no image carrier); the form switch shows review-bypass copy, hides when the flag is off, and the save-time refine rejects `importDeclaredEdges` without `includePodImageSbom`.

### Tests for User Story 2

- [x] T007 [P] [US2] `playwright/mocks/kubernetes/server.ts` — NEW fixture server on the shared `mocks/lib` helpers (`startDataServer` + `startControlServer` + `log`, plain HTTP — no TLS; research D5): `GET /api/v1/namespaces/prod/pods` → pod `web-abc` owned by `ReplicaSet/web-abc` running container `web` with image `mock-docker-engine:5000/pw-web@sha256:{64-hex}` (digest form — no `imageID` lookup needed; reuse the docker mock's `SBOM_IMAGE_REF`/`SBOM_DIGEST` constants) plus a digestless `busybox:latest` sidecar to exercise partial coverage; `GET /apis/apps/v1/namespaces/prod/replicasets/web-abc` → RS owned by `Deployment/web`. Scenario `pods-empty` serves an empty pod list (degraded path); default scenario serves the fixture. No auth required (Bearer token optional).
- [x] T008 [US2] `playwright/compose.test.yml` — add `mock-kubernetes` service (build `Dockerfile.mocks`, `command: ["node", "--import", "tsx", "mocks/kubernetes/server.ts"]`, `MOCK_PORT: 6443`, `MOCK_CONTROL_PORT: 9444`, `/pw-private` mount not needed if unused — match sibling mocks' minimal shape, alias `mock-kubernetes` on `pwnet`, healthcheck `wget --spider http://localhost:9444/__control/health`); `playwright/mocks/control/server.ts` — add `'mock-kubernetes': 'http://mock-kubernetes:9444'` to `TARGETS`; `mock-control`'s `depends_on` gains `mock-kubernetes` (service_healthy)
- [x] T009 [US2] `playwright/tests/importers/kubernetes-declared-edges.spec.ts` — NEW journey spec reusing `triggerAndWait`/`findComponent` + `scenario()` helpers (docker-declared-edges.spec.ts precedent): beforeAll — ADMIN api creates a kubernetes importer config (`importerName: 'kubernetes'`, per-project label, scope `{ endpoint: 'http://mock-kubernetes:6443', namespace: 'prod', resourceTypes: ['apps/v1:Deployment'], includePodImageSbom: true, importDeclaredEdges: true }`, `enabled: true`, no credentials), sets `mock-docker-engine` scenario `sbom`, triggers a run, waits for the `pkg-npm-express` LIBRARY component; afterAll resets the scenario to `baseline`. Tests: (a) opt-in switch renders review-bypass copy + persists through the form, and `POST /importer-configs` with `importDeclaredEdges:true` + `includePodImageSbom:false` → 400 refine rejection; (b) viewer sees `apps/v1:Deployment:prod` workload → express/pw-app `Added by importer` rows with Source+run provenance links, no Hide for VIEWER; (c) `express → accepts` library edge renders (bounded libraries summary); `pw-lib → docker-image:{digest}` does **not** exist — same-run drop assertion unique to this carrier; (d) editor hides the disposable pair → two re-runs → suppressed pair absent, zero duplicates; (e) `sbom-reduced` re-run retires exactly `express → accepts` while subject edges persist; (f) flag-off hides the opt-in switch + provenance surfaces; (g) PATCH config `importDeclaredEdges:false` + re-run → existing importer edges persist untouched (field-presence gate)

**Checkpoint**: US2 green — the generic edge pass + suppression + flag machinery verified against the fourth carrier with zero backend/frontend modifications (SC-005).

---

## Phase 4: User Story 3 — Importer setup guide documents the opt-in (P2)

**Goal**: `docs/importers/kubernetes.md` documents the new field per the importer contract.

**Independent Test**: guide renders the field in the contract table and explains review-bypass/`includePodImageSbom`/hide-later semantics in prose; `docs:importers:check` reports no drift.

- [x] T010 [US3] `docs/importers/kubernetes.md` — add a prose section for `importDeclaredEdges` (default off, requires `includePodImageSbom` and `endpoint`): what it imports (pod-image SBOM dependency graphs → `DEPENDS_ON` catalog edges on `LIBRARY` components, subject edges on each workload carrying the image's BOM), review-bypass semantics verbatim, hide-later via **Hide edge**, source-scoped retirement when the SBOM stops declaring an edge, and the `→ SUBJECT`/same-run-drop note (no image components are imported); run `pnpm --filter @componode/backend docs:importers` to regenerate the `GENERATED:contract` table; `docs:importers:check` green

---

## Phase 5: Polish & Cross-Cutting

**Purpose**: Governance back-pointers + full verification.

- [x] T011 [P] `researches/adrs/ADR-133-importer-declared-component-edges.md` — record `importer-kubernetes` as the fourth carrier (carrier note only — no contract text change; note the single-carrier-kind SUBJECT expansion + `docker-image:{digest}` target rule that always drops under same-run scope); scan `docs/architecture.md` for any importer-carrier enumeration that should name kubernetes
- [x] T012 Full verification — `pnpm lint && pnpm typecheck && pnpm test && pnpm build` in `importer-kubernetes` + `core`/`importer-docker`/`backend` suite parity unchanged + root `pnpm build`; `pnpm e2e` targeted subset (`--grep "kubernetes.*edge|kubernetes.*declared"`) green; quickstart.md scenarios A–D spot-check; AGENTS.md done-criteria sweep (ADR back-pointer ✅, importer guide ✅, roadmap entry reserved for ship stage, openapi.yaml unchanged — no endpoint changes)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (edge plumbing)**: No dependencies — blocks only T006's emission (consumes `PodImageBom.edges`)
- **Phase 2 (US1)**: Depends on Phase 1 — T003/T004 tests can be written in parallel with Phase 1 but fail until T002/T005/T006 land
- **Phase 3 (US2)**: Depends on Phase 2 (needs the emission to e2e-verify) — T007/T008 mock wiring is independent and can parallel Phase 2
- **Phase 4 (US3)**: Depends on T005 (the manifest field regenerates the doc table)
- **Phase 5**: Depends on all stories

### User Story Dependencies

- **US1**: self-contained after Phase 1 — the MVP
- **US2**: verifies US1's output through inherited machinery — no new app code, only the mock + journey
- **US3**: depends only on US1's config field existing

### Parallel Opportunities

- T001 (collection tests) ∥ T003+T004 (importer tests) ∥ T007 (mock server) — three independent files, all writable up-front as failing tests
- T002 (k8s-pods plumbing) ∥ T005 (config/manifest) — different files
- T011 (ADR note) ∥ T010 (docs) once T005 lands

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: `edges` surfaced on `PodImageBom` per workload
2. Phase 2: importer-kubernetes emits `relationships[]` + `LIBRARY` assets under opt-in — importer tests green
3. **STOP and VALIDATE**: unit-level contract complete; backend machinery picks it up with zero changes

### Incremental Delivery

1. US1 → importer emits the full contract (deliverable alone: feature works via API)
2. US2 → e2e proves provenance/hide/retirement/flag/refine inheritance for this carrier
3. US3 → guide + governance complete the ship checklist

## Phase 4: Review

- [x] T013 Correct the stale `includePodImageSbom` + `sourceKey` claim in `docs/importers/kubernetes.md` — the schema accepts the combination and the run degrades to `UNAVAILABLE` markers, it is not rejected at save (code-review: standards + spec)
- [x] T014 Rename the shadowed `identity` loop variable in `packages/importer-kubernetes/src/importer.ts` (library drain loops) to `purlIdentity` so it cannot be confused with the source identity (code-review: standards)
- [x] T015 Type `PodImageBom.edges` as `SpdxEdge[]` from `@componode/core` instead of the inline `{ from: string; to: string }[]` structural type in `packages/importer-kubernetes/src/k8s-pods.ts` (code-review: standards)
- [x] T016 Drop the unused `/pw-private` volume mount from the `mock-kubernetes` service in `playwright/compose.test.yml` (code-review: standards)
