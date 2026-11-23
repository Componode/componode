# Feature Specification: Docker Importer Declared-Edge Carrier

**Feature Branch**: `078-docker-declared-edges`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User request — "Third declared-edge carrier: `importer-docker`. It's the natural continuation of the ADR-133 series and is already 90% wired: `docker-sbom.ts` already calls `parseCycloneDxDocument` — but discards `.edges`, keeping only `.entries`. The dependency graph is parsed today and thrown away. Same incremental shape as 077: `importDeclaredEdges` config switch (no precondition — Syft/referrers SBOMs always parse), `declaredEdgesConfigKey` manifest entry, `relationships[]` emission via the shared core helpers (`buildLibraryAsset`, `indexBomEntries`, `dependsOnRels`), zero backend work — the field-presence gate already covers it. Emission: image→package + package→package `DEPENDS_ON` edges onto LIBRARY assets, `IMPORTER` provenance, suppression/retirement inherited." This is a follow-on to spec `077-sbom-declared-edges` (second carrier) and `076-bom-importer-native` (ADR-133 contract + first carrier `importer-github`). Docker's SBOM path is shared: OCI Registry **referrers** attestations (CycloneDX *or* SPDX, via `fetchImageBom` in `@componode/core` — also used by `importer-kubernetes`) with a **Syft** subprocess fallback (`importer-docker` only, CycloneDX output). Both paths parse full `BomParseResult`s today and keep only `.entries` — the referrers client discards `.edges` inside `parseDoc`, the Syft fallback discards it at the call site. Surfacing the already-parsed graph is the only core change; the rest is carrier-2 shape. Governing docs: ADR-133 (the contract being exercised — carrier note only), ADR-057 A1/A2 (field-presence completeness doctrine), ADR-131 (image-SBOM referrers/Syft semantics), ADR-119 (source-scoped retirement — inherited), ADR-121 (Docker workload/image identity), ADR-065 (importer↔core boundary — the referrers client stays in core), spec 076/077 `spec.md` (carrier precedents), `docs/ux.md` flag `bomImporterEdges` / gap G39 (already ON, generic gating).

## Clarifications

### Session 2026-11-23 — inherited decisions normative (no open markers)

Specs 076/077 and the research grill settled the contract; this spec records how the settled rules apply to the third carrier. It MUST NOT reopen them:

- **Same contract, same safety model**: per-config opt-in with the verbatim review-bypass copy, importer-added edges bypass the suggestion queue, `IMPORTER` provenance with Source/run attribution on every edge, pair-scoped Hide suppression, `ON CONFLICT DO NOTHING` preserving curated edges, source-scoped diff retirement on `COMPLETED` runs, and the `relationships` field-presence authority gate — all already implemented generically in the backend edge pass, keyed on `manifest.declaredEdgesConfigKey` + the config's scope value (ADR-133).
- **`DEPENDS_ON` only**: the BOM parsers project dependency-graph edges only; docker emits no `SOURCES_FROM`/`EXPOSES` declarations.
- **Flag `bomImporterEdges` / G39** already governs the opt-in switch generically (the schema-driven form hides the manifest's `declaredEdgesConfigKey` field while the flag is OFF). No new flag, no new gap entry.
- **LIBRARY-asset emission** uses the shared `core` helpers (`buildLibraryAsset`, `indexBomEntries`, `dependsOnRels`) verbatim — identical identity (`externalId` = normalized version-free purl), provider mapping, and `pkg-{type}-{name}` slug family to carriers 1–2 (ADR-133 §7).

Four scope decisions specific to this carrier, recorded here and in Assumptions:

- **The document subject is the image; `SUBJECT` expands to every asset that carries the document this run.** A docker SBOM is fetched per image digest and its `bomEntries` attach to every catalog asset bearing that image's content: each workload (`CONTAINER`) component running the image, and — when `includeImages` is on — the `docker-image:{repo@digest}` `PACKAGE_REGISTRY` asset. Every such carrier declares the document's `SUBJECT → package` edges as its own (`workload → pkg`, `image → pkg`), so subject edges materialize in the default config (`includeImages` OFF) where workload assets are the only carriers. A package declaring a dependency *on* the subject (`X → SUBJECT`, rare) resolves to the canonical image identity `docker-image:{digest}` — it materializes when the image asset is in the same run and drops silently otherwise (same-run scope, ADR-133 §2). Rationale: source-side `SUBJECT` means "everything carrying this image's content"; target-side `SUBJECT` means "the image artifact itself," whose canonical catalog face is the image component — exploding it onto every workload of that image would multiply a rare edge onto unrelated workloads.
- **`importDeclaredEdges` requires `includeSbom`** — the dependent-toggle shape of carrier 1 (`importDeclaredEdges → includeDependencyGraph`), not carrier 2's fully unconditional switch. The SBOM fetch is the only edge source; an opt-in without `includeSbom` would be dead config that silently emits nothing. "No precondition" in the request means no *new* precondition field beyond the existing `includeSbom` requirement — the parse always produces the graph at no extra fetch cost, which is what made a separate gate unnecessary.
- Q: Should `importDeclaredEdges` require `includeSbom` at save time or be fully unconditional? → A: Require `includeSbom` (schema-level dependent toggle, confirmed 2026-11-23).
- Q: Which catalog assets gain the document's `SUBJECT → package` edges? → A: Every SBOM-bearing asset — each workload component running the image plus the `docker-image:*` component when `includeImages` is on (confirmed 2026-11-23).
- **Shared core change is additive-only**: `ImageBomResult` gains an `edges` field so the referrers client stops discarding the graph it already parses. `importer-kubernetes` consumes the same result type and ignores the new field — zero behavior change there; making kubernetes a carrier is a future spec.
- **`relationships` presence mirrors `bomEntries` presence on carriers**: under opt-in a carrier asset carries `relationships` (possibly `[]` — authoritative-empty) exactly when it received `bom.entries`; a bomless/degraded yield (no attestation, registry error, local-only image) omits the field entirely so the run stays non-authoritative and retires nothing (ADR-057 A1 doctrine, spec 077 T021).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Editor opts a Docker config into declared-edge import (Priority: P1)

An Editor editing a Docker importer config that already imports SBOMs sees a declared-edge opt-in switch (default OFF) with the review-bypass copy, turns it on, and the next completed run turns each image's dependency graph into catalog truth: workload and image components carrying that image's SBOM gain `DEPENDS_ON` edges to `LIBRARY` components for the image's declared dependencies, libraries gain edges for their own declared dependencies, and every edge is marked **Added by importer** — no manual step.

**Why this priority**: This is the entire feature — the third carrier exercising the ADR-133 contract. Everything else is inherited machinery this story merely verifies.

**Independent Test**: create a Docker importer config with `includeSbom` + `importDeclaredEdges` enabled, run it against an engine whose images carry a CycloneDX document with a `dependencies[]` graph (mocked referrers or stubbed Syft), and verify the workload component's Relationships tab shows importer-added edges to LIBRARY components, library-to-library edges exist, and a second identical run adds zero duplicates.

**Acceptance Scenarios**:

1. **Given** an Editor editing a Docker importer config with `includeSbom` enabled, **When** the form renders, **Then** a declared-edge opt-in switch appears, defaults OFF, and shows the copy "Imported dependencies are added to the catalog without review. You can hide any edge later." — identical to the existing carriers' switch (UX-EDGE-03).
2. **Given** the opt-in switched ON while `includeSbom` is OFF, **When** the config is saved, **Then** validation rejects it — declared-edge import requires the SBOM inventory it reads.
3. **Given** an opted-in config and a completed run whose image SBOMs declare `subject → package` edges, **When** the run's edge pass executes, **Then** every asset carrying that SBOM (each workload component running the image, and the image's PACKAGE_REGISTRY component when `includeImages` is on) gains one `DEPENDS_ON` edge per resolvable declared dependency, marked importer-added with Source and run.
4. **Given** an opted-in run, **When** an image SBOM declares `package A → package B` edges, **Then** `LIBRARY`-category components are yielded for each purl-identified package and the declared edges materialize between them — merging with curated libraries and other carriers' libraries on the standard dedup triple.
5. **Given** a CycloneDX referrers attestation, an SPDX referrers attestation, and a Syft-generated CycloneDX document describing the same dependency graph for an image, **When** each path serves that image's SBOM, **Then** all produce equivalent declared-edge sets — collection-path parity.
6. **Given** an opted-in run whose image SBOM has no dependency graph (no `dependencies[]`/dependency relationships), **When** it completes, **Then** `LIBRARY` components are still yielded for the purl-identified packages, carrier assets carry an authoritatively-empty `relationships` set, and zero edges are written — no error.
7. **Given** an image with no resolvable SBOM (no referrers attestation, no Syft on PATH, or a local-only image with no registry digest), **When** an opted-in run completes, **Then** the carrier yields exactly as today — `bomInventory` marker, no `bomEntries`, no `relationships` field, no `LIBRARY` contribution from that image — and prior importer edges are untouched (non-authoritative yield).
8. **Given** a second identical completed run, **When** it finishes, **Then** zero duplicate components or edges exist.
9. **Given** the opt-in OFF (default), **When** a run completes, **Then** the output is identical to today's: the same component/image assets with `bomEntries`, no `relationships[]`, no `LIBRARY` assets.
10. **Given** `includeImages` ON and an image whose SBOM declares `package → subject` edges, **When** the run completes, **Then** those edges materialize onto the image component (`X DEPENDS_ON docker-image:{digest}`); with `includeImages` OFF the same declarations drop silently.

---

### User Story 2 - Imported edges behave like every importer-added edge (Priority: P1)

A user browsing a Docker-imported workload component sees **Added by importer** provenance on its dependency edges with one-click Source/run resolution, an Editor can **Hide** a wrong edge with durable suppression, and a later run whose image SBOM drops a previously declared dependency removes only that Source's edge — all through the Phase-3 machinery with no docker-specific backend or UI work.

**Why this priority**: The research's ship gate — review-free import is only trustworthy with provenance, suppression, and honest retirement. These behaviors are inherited from the generic edge pass, but the spec must prove the inheritance works end-to-end for the third carrier rather than assume it.

**Independent Test**: hide a docker-imported edge, re-run against the same SBOM, verify the edge does not return; remove a dependency from the SBOM, re-run, and verify that edge alone retires while curated edges and other Sources' edges survive.

**Acceptance Scenarios**:

1. **Given** an importer-added edge from a Docker run, **When** it renders in a relationships read surface, **Then** it shows **Added by importer** with a working link to the reporting Source and run.
2. **Given** an Editor choosing **Hide edge** on a docker-imported edge, **When** a later completed run re-declares the same pair, **Then** the edge is not recreated (pair-scoped suppression).
3. **Given** a completed run whose image SBOM no longer declares a dependency the Source previously added, **When** the run finishes, **Then** only that Source's absent importer-added edges are removed; curated edges and other Sources' edges are untouched (source-scoped diff).
4. **Given** a human-created edge on a pair a Docker run also declares, **When** the run completes, **Then** the edge remains **Curated** — never relabelled, overwritten, or duplicated.
5. **Given** a `FAILED`, `CANCELLED`, or `INTERRUPTED` run — including a partially degraded yield (one image's SBOM failing while others succeed), **When** it ends, **Then** the failed portions declare nothing: a bomless carrier omits the `relationships` field so the run only writes/retires the authoritative declared set, and non-completed runs write and retire nothing at all.
6. **Given** an Editor turns the opt-in OFF after edges exist, **When** later runs complete, **Then** `relationships[]` is no longer emitted or processed; existing importer-added edges persist (disabling never silently deletes graph data).

---

### User Story 3 - Importer setup guide documents the opt-in (Priority: P2)

A user reading `docs/importers/docker.md` sees the new opt-in field in the config table and a prose section explaining what it imports (image dependency-graph edges as catalog `DEPENDS_ON` edges on LIBRARY components), the `includeSbom` requirement, the review-bypass semantics, and that hidden edges stay hidden.

**Why this priority**: The importer contract makes the guide part of the deliverable — a config field shipped without documentation leaves the work incomplete. It carries no user-facing behavior of its own, so it is P2.

**Independent Test**: read the published guide and confirm the field appears in the generated contract table and the review-bypass/`includeSbom` semantics are explained in prose.

**Acceptance Scenarios**:

1. **Given** the shipped change, **When** `docs/importers/docker.md` renders, **Then** the config-field table includes the opt-in row and a prose section covers edge import, the `includeSbom` requirement, LIBRARY component creation, and Hide-later semantics.
2. **Given** the generated contract region, **When** `docs:importers` regeneration runs, **Then** the produced output matches the committed file (no drift — `docs:importers:check` passes).

---

### Edge Cases

- **Degraded yield**: registry errors, missing referrers, absent Syft, and digest-less (local-only) images degrade the carrier exactly as today — `bomInventory` marker only, no `bomEntries`, and no `relationships` field regardless of opt-in (non-authoritative for the edge pass).
- **`includeSbom` OFF + opt-in ON**: rejected at config save by schema validation — the two fields are dependent toggles, not an ignorable combination.
- **Dependency edge to a purl-less package**: SBOM components without purls cannot be resolved to identities (parser skips them) — edges touching them are silently dropped, consistent with `skipped` counting.
- **Declared target absent from the run**: an edge endpoint that resolves to no yielded asset's externalId is silently dropped (same-run scope, ADR-133 §2) — including `→ SUBJECT` edges when `includeImages` is off.
- **One digest, several workloads**: multiple workload components running the same image each declare the subject edges on themselves (each is a carrier); identical pairs collapse under edge-pass dedup and the `bomByDigest` cache keeps the registry fetch singular.
- **Same package in several images' SBOMs**: a `LIBRARY` asset is yielded at most once per run per normalized purl identity (first digest wins); all `package → package` edges still declare on that single yield.
- **Self-edge or duplicate declaration**: parser-level dedup already collapses them; at most one edge per `(declaring, target)` pair.
- **Carrier component is `RETIRED`**: edges still materialize — dedup resolved the target; default reads already exclude `RETIRED` records.
- **LIBRARY identity collision with curated catalog data**: yielded `LIBRARY` assets deduplicate on `(LIBRARY, provider, normalized version-free purl)` — they merge into Phase-2 curated libraries and github/sbom-file-carrier libraries, never duplicate (ADR-133, spec 075/076/077).
- **The `bomImporterEdges` flag OFF**: the opt-in switch is hidden on the form (never disabled); a pre-existing opted-in config still honors the server-side config value — the flag gates the switch's visibility, not the run behavior, matching specs 076/077 semantics.
- **Kubernetes parity**: `importer-kubernetes` shares `fetchImageBom` but does not declare `declaredEdgesConfigKey` and reads no `edges` — its output is unchanged; it does not become a carrier under this spec.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Docker importer config MUST expose an `importDeclaredEdges` boolean, default OFF, described with the review-bypass copy "Import declared dependencies as catalog edges. Imported dependencies are added to the catalog without review. You can hide any edge later." — the exact field shape and describe string of the existing carriers — and the importer manifest MUST declare `declaredEdgesConfigKey: "importDeclaredEdges"` so the backend edge pass and the flagged form switch activate for it.
- **FR-002**: The config MUST reject `importDeclaredEdges: true` when `includeSbom` is not also `true` — a validation constraint on the scope, mirroring carrier 1's dependent-toggle rule, because the SBOM fetch is the only edge source.
- **FR-003**: The shared image-SBOM resolution MUST surface the parsed dependency graph: `ImageBomResult` gains an `edges` field carrying the parser's normalized version-free purl-identity pairs with the `SUBJECT` sentinel intact — populated on both the OCI-referrers path (CycloneDX and SPDX attestations) and the Syft fallback — instead of being discarded as today.
- **FR-004**: When the opt-in is ON and a carrier asset receives `bomEntries`, the importer MUST attach `relationships[]` of `{ type: "DEPENDS_ON", targetExternalId }` resolving the document's `SUBJECT → package` edges onto that carrier's own externalId — workload `CONTAINER` assets and `docker-image:{digest}` `PACKAGE_REGISTRY` assets alike. The `relationships` field MUST be present (possibly empty) exactly when `bomEntries` is present; a carrier with no SBOM inventory MUST omit it entirely.
- **FR-005**: When the opt-in is ON, the importer MUST yield at most one `LIBRARY`-category `DiscoveredAsset` per unique normalized version-free purl identity per run via the shared `buildLibraryAsset`/`indexBomEntries`/`dependsOnRels` helpers — `externalId` = the purl identity, `provider` from the purl ecosystem mapping, slug following `pkg-{type}-{name}` — carrying its declared `package → package` edges plus any `package → SUBJECT` edges resolved to `docker-image:{digest}`.
- **FR-006**: When the opt-in is OFF, the importer's output MUST be identical in shape to today: no `relationships[]` field, no `LIBRARY` assets, `bomEntries` presence semantics unchanged.
- **FR-007**: Server-side gating MUST apply unchanged — the backend collects `relationships[]` only when the run's manifest declares `declaredEdgesConfigKey` and the config's value is `true`, and the edge pass runs only when ≥1 yielded asset carried the `relationships` field; this feature adds no migrations, no endpoints, and no backend/frontend code.
- **FR-008**: `FAILED`, `CANCELLED`, `INTERRUPTED`, and degraded-yield runs MUST NOT write or remove edges (inherited run-status gating + field-presence authority).
- **FR-009**: Every importer unit test exercising the opt-in MUST run the emitted assets through `validateDiscoveredAsset` (the enforceable importer contract).
- **FR-010**: `docs/importers/docker.md` MUST document the opt-in field (generated contract table regenerated via `docs:importers`), what it imports, the `includeSbom` requirement, and the review-bypass/hide-later semantics — per the importer contract's guide requirement.
- **FR-011**: The change MUST ship Playwright coverage for the surface it touches — the Docker importer config form's declared-edge switch (visible under flag `bomImporterEdges`, hidden when OFF) and, where mock infrastructure permits, an opted-in run's importer-added edges — consistent with the repo's e2e-coverage rule.
- **FR-012**: No API endpoint changes and no contract changes are expected; if implementation surfaces one, `docs/openapi.yaml` updates in the same change (ADR-104). No new ADR is required — ADR-133 already covers additional carriers; its carrier note SHOULD be updated to record docker as the third carrier.

### Key Entities *(include if feature involves data)*

- **DiscoveredAssetRelationship** (existing contract type): `{ type: "DEPENDS_ON", targetExternalId }` declarations on yielded assets — the carrier emits them; the generic edge pass resolves them within the run.
- **Image-SBOM subject carriers**: the set of catalog assets a document's `bomEntries` attach to — workload `CONTAINER` components running the image and the `docker-image:{digest}` `PACKAGE_REGISTRY` component (when `includeImages` is on). `SUBJECT` source-position expands to every carrier; target-position resolves to `docker-image:{digest}`.
- **LIBRARY component** (existing): first-class catalog component deduplicated on `(LIBRARY, provider, normalized version-free purl)` — yielded as edge endpoints and merge targets for curated/other-carrier libraries.
- **No new persisted entities**: provenance columns, the suppression table, and junction rows all exist from spec 076.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An opted-in Docker config plus one completed run materializes 100% of each image SBOM's resolvable dependency edges as importer-provenance `DEPENDS_ON` edges — subject edges on every carrier of that SBOM, package→package edges between libraries — with zero manual review actions, across referrers-CycloneDX, referrers-SPDX, and Syft collection paths.
- **SC-002**: A repeated run over unchanged SBOMs produces 0 duplicate components and 0 duplicate edges; an image SBOM with one dependency removed retires exactly that one edge on the next completed run.
- **SC-003**: A hidden docker-imported edge stays hidden across ≥2 subsequent completed runs, and a curated edge on the same pair remains possible and labelled **Curated**.
- **SC-004**: With the opt-in OFF, importer output is unchanged from the current release — 0 `LIBRARY` assets and 0 `relationships[]` entries across any engine inventory.
- **SC-005**: The change adds no migration, API surface, or backend/frontend code; the only shared-code change is the additive `edges` field on `ImageBomResult` and its population on the referrers/Syft parse paths (verified by core and importer test suites), and `importer-kubernetes` output is byte-identical before and after.

## Assumptions

- Specs 076 and 077 are shipped and stable: the edge pass, provenance columns, suppression table, field-presence authority gate, flagged UI surfaces, shared `bom-library` helpers, and `bomImporterEdges` flag (ON, gap G39 resolved) exist unchanged.
- The shared parsers' `BomParseResult.edges` projection is authoritative — docker consumes `edges` as-is; parser bugs are out of scope.
- The opt-in's dependency on `includeSbom` is a schema-level requirement (same shape as carrier 1's `includeDependencyGraph` requirement): the SBOM inventory is the edge source, so the dependent-toggle rule applies even though the parse itself is free. "No precondition" means no *additional* field gates the switch beyond that.
- Source-side `SUBJECT` expands to every asset carrying the document (workloads + image component); target-side `SUBJECT` resolves to the canonical `docker-image:{digest}` identity only — recorded in Clarifications as a deliberate carrier-level choice for a document feature carriers 1–2 treated differently by circumstance (single-subject assets).
- `importer-kubernetes` is deliberately out of scope as a carrier — it gains the shared `edges` field on the result type for free but reads nothing from it; a future spec decides its carrier story.
- Whether libraries are emitted inline during carrier iteration or collected and emitted once at the end is an implementation detail for the plan — the *behavioral* contract (identity, provider mapping, slug shape, once-per-run dedup) is fixed by FR-005.
- No new ADR, no migration, no openapi.yaml change, no roadmap-visible capability beyond "third carrier" — the roadmap entry updates at ship time per done-criteria.
- The flag governs the *form switch's visibility*; a config already opted in continues to emit edges while the flag is OFF — consistent with specs 076/077 flag semantics (surface hiding, not behavior gating).
