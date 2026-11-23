# Feature Specification: Kubernetes Declared-Edge Carrier

**Feature Branch**: `079-kubernetes-declared-edges`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User request — "Kubernetes as the fourth declared-edge carrier (spec 079)." This is a follow-on to spec `078-docker-declared-edges` (third carrier), spec `077-sbom-declared-edges` (second carrier), and spec `076-bom-importer-native` (ADR-133 contract + first carrier `importer-github`). `importer-kubernetes` already walks the shared `fetchImageBom` path — `collectPodImageBoms` resolves each pod image's `ImageBomResult` and keeps only `.entries` — so since spec 078 populated `ImageBomResult.edges`, the parsed dependency graph is already in hand and discarded at exactly one place. Same incremental carrier shape as 077/078: `importDeclaredEdges` config switch (requires `includePodImageSbom` — the pod-image SBOM fetch is the only edge source), `declaredEdgesConfigKey` manifest entry, `relationships[]` emission via the shared core helpers (`buildLibraryAsset`, `indexBomEntries`, `dependsOnRels`), zero backend/frontend/core work — the field-presence gate already covers it. Emission: workload→package + package→package `DEPENDS_ON` edges onto LIBRARY assets, `IMPORTER` provenance, suppression/retirement inherited. Governing docs: ADR-133 (the contract being exercised — carrier note only), ADR-057 A1/A2 (field-presence completeness doctrine), ADR-131 (image-SBOM referrers semantics), ADR-119 (source-scoped retirement — inherited), ADR-120 (kubernetes source identity — `endpoint`/`sourceKey`), ADR-065 (importer↔core boundary), spec 076/077/078 `spec.md` (carrier precedents), `docs/ux.md` flag `bomImporterEdges` / gap G39 (already ON, generic gating).

## Clarifications

### Session 2026-11-23 — inherited decisions normative (no open markers)

Specs 076–078 and the research grill settled the contract; this spec records how the settled rules apply to the fourth carrier. It MUST NOT reopen them:

- **Same contract, same safety model**: per-config opt-in with the verbatim review-bypass copy, importer-added edges bypass the suggestion queue, `IMPORTER` provenance with Source/run attribution on every edge, pair-scoped Hide suppression, `ON CONFLICT DO NOTHING` preserving curated edges, source-scoped diff retirement on `COMPLETED` runs, and the `relationships` field-presence authority gate — all already implemented generically in the backend edge pass, keyed on `manifest.declaredEdgesConfigKey` + the config's scope value (ADR-133).
- **`DEPENDS_ON` only**: the BOM parsers project dependency-graph edges only; kubernetes emits no `SOURCES_FROM`/`EXPOSES` declarations.
- **Flag `bomImporterEdges` / G39** already governs the opt-in switch generically (the schema-driven form hides the manifest's `declaredEdgesConfigKey` field while the flag is OFF). No new flag, no new gap entry.
- **LIBRARY-asset emission** uses the shared `core` helpers (`buildLibraryAsset`, `indexBomEntries`, `dependsOnRels`) verbatim — identical identity (`externalId` = normalized version-free purl), provider mapping, and `pkg-{type}-{name}` slug family to carriers 1–3 (ADR-133 §7).

Four scope decisions specific to this carrier, recorded here and in Assumptions:

- **The document subject is the pod image; the only carrier kind is the workload asset.** Where docker expanded `SUBJECT` onto two carrier kinds (workload components + `docker-image:*` components), kubernetes yields only `CONTAINER_ORCHESTRATION` workload assets — one placeholder per configured `apiVersion:Kind`. A workload's `bomEntries` is already the union of its pods' resolved image SBOMs; under the opt-in, each resolved image document's `SUBJECT → package` edges land on the workload asset carrying that image's BOM. A workload running several images declares each image's subject edges on itself.
- **`importDeclaredEdges` requires `includePodImageSbom`** — the dependent-toggle shape of carriers 1 and 3 (`importDeclaredEdges → includeDependencyGraph` / `→ includeSbom`), not carrier 2's unconditional switch. The pod-image SBOM fetch is the only edge source; an opt-in without `includePodImageSbom` would be dead config that silently emits nothing.
- **Target-side `SUBJECT` resolves to the canonical `docker-image:{digestRef}` identity and always drops.** Kubernetes yields no image component, so every `package → SUBJECT` edge resolves to an externalId no asset in the run carries and drops under same-run scope (ADR-133 §2). The resolution is kept (rather than dropping the sentinel early) for parity with carrier 3's `resolveSubjectTargets` shape and so a future image-component surface picks the edges up unchanged.
- **Partial image coverage is authoritative for the resolved set.** A workload's `bomEntries` is already the union of only the images whose SBOMs resolved (marker stays `OK` when ≥1 resolved); `relationships` mirrors that — the workload's declared set is authoritative for exactly the resolved images. An image that resolved last run but fails this run retires both its `bomEntries` rows (today's behavior) and its importer edges — one completeness doctrine, not two.

Also recorded:

- **`relationships` presence mirrors `bomEntries` presence on carriers**: under opt-in a workload asset carries `relationships` (possibly `[]` — authoritative-empty) exactly when it received `bom.entries`; a marker-only/bomless workload (no resolved digest, registry failure, `sourceKey` mode with no endpoint) omits the field entirely so the run stays non-authoritative for that asset and retires nothing (ADR-057 A1 doctrine, spec 077 T021, spec 078).
- **Zero shared-code change**: spec 078 already populated `ImageBomResult.edges` on the referrers parse path kubernetes uses; this spec only stops discarding it inside `importer-kubernetes` (config, manifest, `k8s-pods.ts` edge plumbing, `importer.ts` emission). No core, backend, or frontend changes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Editor opts a Kubernetes config into declared-edge import (Priority: P1)

An Editor editing a Kubernetes importer config that already imports pod image SBOMs sees a declared-edge opt-in switch (default OFF) with the review-bypass copy, turns it on, and the next completed run turns each pod image's dependency graph into catalog truth: workload components carrying that image's SBOM gain `DEPENDS_ON` edges to `LIBRARY` components for the image's declared dependencies, libraries gain edges for their own declared dependencies, and every edge is marked **Added by importer** — no manual step.

**Why this priority**: This is the entire feature — the fourth carrier exercising the ADR-133 contract. Everything else is inherited machinery this story merely verifies.

**Independent Test**: create a Kubernetes importer config with `includePodImageSbom` + `importDeclaredEdges` enabled and an `endpoint`, run it against a cluster whose pods run images carrying CycloneDX or SPDX attestations with a dependency graph (mocked API server + referrers), and verify the workload component's Relationships tab shows importer-added edges to LIBRARY components, library-to-library edges exist, and a second identical run adds zero duplicates.

**Acceptance Scenarios**:

1. **Given** an Editor editing a Kubernetes importer config with `includePodImageSbom` enabled, **When** the form renders, **Then** a declared-edge opt-in switch appears, defaults OFF, and shows the copy "Imported dependencies are added to the catalog without review. You can hide any edge later." — identical to the existing carriers' switch (UX-EDGE-03).
2. **Given** the opt-in switched ON while `includePodImageSbom` is OFF, **When** the config is saved, **Then** validation rejects it — declared-edge import requires the SBOM inventory it reads.
3. **Given** an opted-in config and a completed run whose pod-image SBOMs declare `subject → package` edges, **When** the run's edge pass executes, **Then** every workload component carrying that image's SBOM gains one `DEPENDS_ON` edge per resolvable declared dependency, marked importer-added with Source and run.
4. **Given** an opted-in run, **When** a pod image's SBOM declares `package A → package B` edges, **Then** `LIBRARY`-category components are yielded for each purl-identified package and the declared edges materialize between them — merging with curated libraries and other carriers' libraries on the standard dedup triple.
5. **Given** a CycloneDX attestation and an SPDX attestation describing the same dependency graph for a pod image, **When** each serves that image's SBOM, **Then** both produce equivalent declared-edge sets — format parity on the referrers path.
6. **Given** an opted-in run whose pod-image SBOMs have no dependency graph (no `dependencies[]`/dependency relationships), **When** it completes, **Then** `LIBRARY` components are still yielded for the purl-identified packages, carrier workloads carry an authoritatively-empty `relationships` set, and zero edges are written — no error.
7. **Given** a workload whose pod images have no resolvable SBOMs (no referrers attestation, undigestable image refs, or a `sourceKey` config with no `endpoint`), **When** an opted-in run completes, **Then** the carrier yields exactly as today — `bomInventory` marker, no `bomEntries`, no `relationships` field, no `LIBRARY` contribution from that workload — and prior importer edges are untouched (non-authoritative yield).
8. **Given** a second identical completed run, **When** it finishes, **Then** zero duplicate components or edges exist.
9. **Given** the opt-in OFF (default), **When** a run completes, **Then** the output is identical to today's: the same workload assets with `bomEntries`, no `relationships[]`, no `LIBRARY` assets.
10. **Given** a pod image whose SBOM declares `package → subject` edges, **When** the run completes, **Then** those edges drop silently — kubernetes yields no `docker-image:*` component, so the resolved target is absent from the run (same-run scope).

---

### User Story 2 - Imported edges behave like every importer-added edge (Priority: P1)

A user browsing a Kubernetes-imported workload component sees **Added by importer** provenance on its dependency edges with one-click Source/run resolution, an Editor can **Hide** a wrong edge with durable suppression, and a later run whose pod-image SBOMs drop a previously declared dependency removes only that Source's edge — all through the Phase-3 machinery with no kubernetes-specific backend or UI work.

**Why this priority**: The research's ship gate — review-free import is only trustworthy with provenance, suppression, and honest retirement. These behaviors are inherited from the generic edge pass, but the spec must prove the inheritance works end-to-end for the fourth carrier rather than assume it.

**Independent Test**: hide a kubernetes-imported edge, re-run against the same SBOMs, verify the edge does not return; remove a dependency from a pod image's SBOM, re-run, and verify that edge alone retires while curated edges and other Sources' edges survive.

**Acceptance Scenarios**:

1. **Given** an importer-added edge from a Kubernetes run, **When** it renders in a relationships read surface, **Then** it shows **Added by importer** with a working link to the reporting Source and run.
2. **Given** an Editor choosing **Hide edge** on a kubernetes-imported edge, **When** a later completed run re-declares the same pair, **Then** the edge is not recreated (pair-scoped suppression).
3. **Given** a completed run whose pod-image SBOMs no longer declare a dependency the Source previously added, **When** the run finishes, **Then** only that Source's absent importer-added edges are removed; curated edges and other Sources' edges are untouched (source-scoped diff).
4. **Given** a human-created edge on a pair a Kubernetes run also declares, **When** the run completes, **Then** the edge remains **Curated** — never relabelled, overwritten, or duplicated.
5. **Given** a `FAILED`, `CANCELLED`, or `INTERRUPTED` run — including a partially degraded yield (one workload's images failing while another's succeed), **When** it ends, **Then** the failed portions declare nothing: a marker-only workload omits the `relationships` field so the run only writes/retires the authoritative declared set, and non-completed runs write and retire nothing at all.
6. **Given** an Editor turns the opt-in OFF after edges exist, **When** later runs complete, **Then** `relationships[]` is no longer emitted or processed; existing importer-added edges persist (disabling never silently deletes graph data).

---

### User Story 3 - Importer setup guide documents the opt-in (Priority: P2)

A user reading `docs/importers/kubernetes.md` sees the new opt-in field in the config table and a prose section explaining what it imports (pod-image dependency-graph edges as catalog `DEPENDS_ON` edges on LIBRARY components), the `includePodImageSbom` requirement, the review-bypass semantics, and that hidden edges stay hidden.

**Why this priority**: The importer contract makes the guide part of the deliverable — a config field shipped without documentation leaves the work incomplete. It carries no user-facing behavior of its own, so it is P2.

**Independent Test**: read the published guide and confirm the field appears in the generated contract table and the review-bypass/`includePodImageSbom` semantics are explained in prose.

**Acceptance Scenarios**:

1. **Given** the shipped change, **When** `docs/importers/kubernetes.md` renders, **Then** the config-field table includes the opt-in row and a prose section covers edge import, the `includePodImageSbom` requirement, LIBRARY component creation, and Hide-later semantics.
2. **Given** the generated contract region, **When** `docs:importers` regeneration runs, **Then** the produced output matches the committed file (no drift — `docs:importers:check` passes).

---

### Edge Cases

- **Degraded yield**: missing referrers, undigestable image refs, registry errors, and `sourceKey` mode (no `endpoint`) degrade the carrier exactly as today — `bomInventory` marker only, no `bomEntries`, and no `relationships` field regardless of opt-in (non-authoritative for the edge pass).
- **`includePodImageSbom` OFF + opt-in ON**: rejected at config save by schema validation — the two fields are dependent toggles, not an ignorable combination.
- **Partial image coverage**: a workload whose pod images resolve only partially (`resolved ≥ 1` keeps the marker `OK`) emits `bomEntries`/`relationships` for the resolved set only — authoritative for it; an image that resolved last run but fails this run retires both its entries (today's behavior) and its edges. A workload with zero resolved images emits neither field and is non-authoritative.
- **Dependency edge to a purl-less package**: SBOM components without purls cannot be resolved to identities (parser skips them) — edges touching them are silently dropped, consistent with `skipped` counting.
- **Declared target absent from the run**: an edge endpoint that resolves to no yielded asset's externalId is silently dropped (same-run scope, ADR-133 §2) — including every `→ SUBJECT` edge, since kubernetes yields no image components.
- **One image across several pods/workloads**: the `bomByDigest` cache keeps the referrers fetch singular; each workload carrying the image declares its `subject → package` edges on itself, and identical pairs collapse under edge-pass dedup.
- **Same package in several images' SBOMs**: a `LIBRARY` asset is yielded at most once per run per normalized purl identity; its `relationships[]` carries the run-wide union of `package → package` edges declared by any image's SBOM.
- **Self-edge or duplicate declaration**: parser-level dedup already collapses them; at most one edge per `(declaring, target)` pair.
- **Carrier component is `RETIRED`**: edges still materialize — dedup resolved the target; default reads already exclude `RETIRED` records.
- **LIBRARY identity collision with curated catalog data**: yielded `LIBRARY` assets deduplicate on `(LIBRARY, provider, normalized version-free purl)` — they merge into Phase-2 curated libraries and github/sbom-file/docker-carrier libraries, never duplicate (ADR-133, spec 075–078).
- **The `bomImporterEdges` flag OFF**: the opt-in switch is hidden on the form (never disabled); a pre-existing opted-in config still honors the server-side config value — the flag gates the switch's visibility, not the run behavior, matching specs 076–078 semantics.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Kubernetes importer config MUST expose an `importDeclaredEdges` boolean, default OFF, described with the review-bypass copy "Import declared dependencies as catalog edges. Imported dependencies are added to the catalog without review. You can hide any edge later." — the exact field shape and describe string of the existing carriers — and the importer manifest MUST declare `declaredEdgesConfigKey: "importDeclaredEdges"` so the backend edge pass and the flagged form switch activate for it.
- **FR-002**: The config MUST reject `importDeclaredEdges: true` when `includePodImageSbom` is not also `true` — a validation constraint on the scope, mirroring carriers 1 and 3's dependent-toggle rule, because the pod-image SBOM fetch is the only edge source.
- **FR-003**: The pod-image SBOM collection MUST surface the parsed dependency graphs it already receives: each workload's `PodImageBom` gains the union of its resolved images' document edges — version-free purl-identity pairs with `SUBJECT` intact in source position and target-position `SUBJECT` resolved to `docker-image:{digestRef}` — present exactly when that workload's `entries` is present.
- **FR-004**: When the opt-in is ON and a workload asset receives `bomEntries`, the importer MUST attach `relationships[]` of `{ type: "DEPENDS_ON", targetExternalId }` resolving each carried document's `SUBJECT → package` edges onto that workload's own externalId. The `relationships` field MUST be present (possibly empty) exactly when `bomEntries` is present; a workload with no SBOM inventory MUST omit it entirely.
- **FR-005**: When the opt-in is ON, the importer MUST yield at most one `LIBRARY`-category `DiscoveredAsset` per unique normalized version-free purl identity per run via the shared `buildLibraryAsset`/`indexBomEntries`/`dependsOnRels` helpers — `externalId` = the purl identity, `provider` from the purl ecosystem mapping, slug following `pkg-{type}-{name}` — carrying the run-wide union of `package → package` edges plus `package → SUBJECT` edges resolved to `docker-image:{digestRef}`.
- **FR-006**: When the opt-in is OFF, the importer's output MUST be identical in shape to today: no `relationships[]` field, no `LIBRARY` assets, `bomEntries` presence semantics unchanged.
- **FR-007**: Server-side gating MUST apply unchanged — the backend collects `relationships[]` only when the run's manifest declares `declaredEdgesConfigKey` and the config's value is `true`, and the edge pass runs only when ≥1 yielded asset carried the `relationships` field; this feature adds no migrations, no endpoints, and no core/backend/frontend code — spec 078's `ImageBomResult.edges` population is consumed as-is.
- **FR-008**: `FAILED`, `CANCELLED`, `INTERRUPTED`, and degraded-yield runs MUST NOT write or remove edges (inherited run-status gating + field-presence authority).
- **FR-009**: Every importer unit test exercising the opt-in MUST run the emitted assets through `validateDiscoveredAsset` (the enforceable importer contract).
- **FR-010**: `docs/importers/kubernetes.md` MUST document the opt-in field (generated contract table regenerated via `docs:importers`), what it imports, the `includePodImageSbom` requirement, and the review-bypass/hide-later semantics — per the importer contract's guide requirement.
- **FR-011**: The change MUST ship Playwright coverage for the surface it touches — the Kubernetes importer config form's declared-edge switch (visible under flag `bomImporterEdges`, hidden when OFF) — consistent with the repo's e2e-coverage rule.
- **FR-012**: No API endpoint changes and no contract changes are expected; if implementation surfaces one, `docs/openapi.yaml` updates in the same change (ADR-104). No new ADR is required — ADR-133 already covers additional carriers; its carrier note SHOULD be updated to record kubernetes as the fourth carrier.

### Key Entities *(include if feature involves data)*

- **DiscoveredAssetRelationship** (existing contract type): `{ type: "DEPENDS_ON", targetExternalId }` declarations on yielded assets — the carrier emits them; the generic edge pass resolves them within the run.
- **Pod-image subject carriers**: the workload `CONTAINER_ORCHESTRATION` assets that aggregate each pod image's `bomEntries`. `SUBJECT` in source position expands onto the workload carrying that image's document; target-position `SUBJECT` resolves to `docker-image:{digestRef}` (never present in a kubernetes run — drops under same-run scope).
- **LIBRARY component** (existing): first-class catalog component deduplicated on `(LIBRARY, provider, normalized version-free purl)` — yielded as edge endpoints and merge targets for curated/other-carrier libraries.
- **No new persisted entities**: provenance columns, the suppression table, and junction rows all exist from spec 076.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An opted-in Kubernetes config plus one completed run materializes 100% of each pod image SBOM's resolvable dependency edges as importer-provenance `DEPENDS_ON` edges — subject edges on every workload carrying that SBOM, package→package edges between libraries — with zero manual review actions, for both CycloneDX and SPDX attestations.
- **SC-002**: A repeated run over unchanged SBOMs produces 0 duplicate components and 0 duplicate edges; a pod-image SBOM with one dependency removed retires exactly that one edge on the next completed run.
- **SC-003**: A hidden kubernetes-imported edge stays hidden across ≥2 subsequent completed runs, and a curated edge on the same pair remains possible and labelled **Curated**.
- **SC-004**: With the opt-in OFF, importer output is unchanged from the current release — 0 `LIBRARY` assets and 0 `relationships[]` entries across any cluster inventory.
- **SC-005**: The change adds no migration, API surface, or shared-code change beyond the importer package itself (verified by the importer's test suite) — `importer-docker` and core output are byte-identical before and after.

## Assumptions

- Specs 076, 077, and 078 are shipped and stable: the edge pass, provenance columns, suppression table, field-presence authority gate, flagged UI surfaces, shared `bom-library` helpers, populated `ImageBomResult.edges`, and `bomImporterEdges` flag (ON, gap G39 resolved) exist unchanged.
- The shared parsers' `BomParseResult.edges` projection is authoritative — kubernetes consumes `edges` as-is; parser bugs are out of scope.
- The opt-in's dependency on `includePodImageSbom` is a schema-level requirement (same shape as carriers 1 and 3): the pod-image SBOM fetch is the edge source, so the dependent-toggle rule applies even though the parse itself is free.
- Source-side `SUBJECT` expands onto the workload carrying each document (kubernetes has a single carrier kind); target-side `SUBJECT` resolves to the canonical `docker-image:{digestRef}` identity and always drops under same-run scope — recorded in Clarifications as a deliberate carrier-level choice kept for parity with carrier 3.
- Partial pod-image coverage treats the resolved subset as authoritative — the same completeness doctrine `bomEntries` already applies on the aggregated workload, extended to `relationships` unchanged.
- Whether libraries are collected during the workload loop or after is an implementation detail for the plan — the *behavioral* contract (identity, provider mapping, slug shape, once-per-run dedup, run-wide edge union) is fixed by FR-005.
- No new ADR, no migration, no openapi.yaml change, no roadmap-visible capability beyond "fourth carrier" — the roadmap entry updates at ship time per done-criteria.
- The flag governs the *form switch's visibility*; a config already opted in continues to emit edges while the flag is OFF — consistent with specs 076–078 flag semantics (surface hiding, not behavior gating).
