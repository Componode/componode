# Feature Specification: SBOM File Declared-Edge Carrier

**Feature Branch**: `077-sbom-declared-edges`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User request — "Extend declared-edge carriers — `importer-sbom-file` is the natural second carrier: SPDX/CycloneDX `DEPENDS_ON` edges already parse into the shared `BomParseResult.edges`; it just needs the opt-in switch + `relationships[]` emission. Smallest incremental spec." This is a follow-on to spec `076-bom-importer-native` (Phase 3 of the SBOM programme, `researches/sbom_research.md`), which ratified ADR-133 — the v2 `relationships[]` contract — and shipped `importer-github` as the first declared-edge carrier. ADR-133 explicitly anticipated additional carriers ("sbom-file ingest can be added later under the same contract"). This spec makes `importer-sbom-file` the second carrier: the shared SPDX and CycloneDX parsers in `packages/core` already project document dependency graphs into `BomParseResult.edges` (version-free purl identities, `SUBJECT` sentinel for the document-described element); the importer only needs the per-config opt-in switch, the manifest declaration, and emission of `relationships[]` — subject→component edges on the configured component, library→library edges on yielded `LIBRARY` assets. Governing docs: ADR-133 (the contract being exercised — unchanged), ADR-057 A2, ADR-119 (source-scoped retirement — inherited), ADR-065 (importer↔core dependency boundary), spec 076 `spec.md` (carrier-1 precedent), `docs/ux.md` flag `bomImporterEdges` / gap G39 (already ON, generic gating).

## Clarifications

### Session 2026-11-23 — inherited decisions normative (no open markers)

Spec 076 and the research grill settled the contract; this spec records how the settled rules apply to the second carrier. It MUST NOT reopen them:

- **Same contract, same safety model**: per-config opt-in with review-bypass copy, importer-added edges bypass the suggestion queue, provenance on every edge, pair-scoped Hide suppression, `ON CONFLICT DO NOTHING` preserving curated edges, source-scoped diff retirement on `COMPLETED` runs — all already implemented generically in the backend edge pass, keyed on `manifest.declaredEdgesConfigKey` + the config's scope value (ADR-133).
- **The document subject is the configured component**: where the GitHub carrier substituted `SUBJECT` with the repository asset, sbom-file substitutes it with the component named by `componentSlug`/`resolvedComponent` — the component the document describes. `SUBJECT` is substituted in **both** edge endpoint positions (see below).
- **`DEPENDS_ON` only**: the BOM parsers project dependency-graph edges only; sbom-file emits no `SOURCES_FROM`/`EXPOSES` declarations.
- **Flag `bomImporterEdges` / G39** already governs the opt-in switch generically (the schema-driven form hides the manifest's `declaredEdgesConfigKey` field while the flag is OFF). No new flag, no new gap entry.

Two scope decisions specific to this carrier, recorded here and in Assumptions:

- **`SUBJECT`-as-target substitution**: a document edge whose *target* is the subject element (e.g. `X DEPENDS_ON <subject>`) resolves to the configured component — the sentinel is substituted with the component's externalId in both positions, matching the sentinel's documented purpose ("the caller substitutes its own externalId"). Carrier 1 (GitHub) substituted only the source position, leaving target-position `SUBJECT` literals to drop silently; substituting both is a deliberate, cheap improvement for this carrier, not a contract change.
- **No precondition field**: GitHub's `importDeclaredEdges` requires `includeDependencyGraph` because the graph costs an extra API call. For sbom-file the document *is* the graph source — parsing already produces edges at no extra cost — so the opt-in stands alone with no dependent toggle.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Editor opts an SBOM File config into declared-edge import (Priority: P1)

An Editor editing an SBOM File importer config sees a declared-edge opt-in switch (default OFF) with the review-bypass copy, turns it on, and the next completed run turns the document's dependency graph into catalog truth: the configured component gains `DEPENDS_ON` edges to `LIBRARY` components for its direct dependencies, libraries gain edges for their own declared dependencies, and every edge is marked **Added by importer** — no manual step.

**Why this priority**: This is the entire feature — the second carrier exercising the ADR-133 contract. Everything else is inherited machinery this story merely verifies.

**Independent Test**: create an SBOM File config with the opt-in enabled pointing at a CycloneDX document with a `dependencies[]` graph, run it, and verify the configured component's Relationships tab shows importer-added edges to LIBRARY components, library-to-library edges exist, and a second identical run adds zero duplicates.

**Acceptance Scenarios**:

1. **Given** an Editor editing an SBOM File importer config, **When** the form renders, **Then** a declared-edge opt-in switch appears, defaults OFF, and shows the copy "Imported dependencies are added to the catalog without review. You can hide any edge later." — identical to the GitHub carrier's switch (UX-EDGE-03).
2. **Given** an opted-in config and a completed run whose document declares `subject → dependency` edges, **When** the run's edge pass executes, **Then** the configured component gains one `DEPENDS_ON` edge per resolvable dependency, marked importer-added with Source and run.
3. **Given** an opted-in run, **When** the document declares `library A → library B` edges, **Then** `LIBRARY`-category components are yielded for each purl-identified package and the declared edges materialize between them.
4. **Given** an edge whose *target* is the document subject, **When** the run completes, **Then** the edge materializes onto the configured component (`X DEPENDS_ON configured-component`).
5. **Given** an SPDX document and a CycloneDX document describing the same dependency graph, **When** each is ingested under opted-in configs, **Then** both produce equivalent declared-edge sets — format parity.
6. **Given** an opted-in run whose document has no dependency graph (SPDX without dependency relationships, CycloneDX without `dependencies[]`), **When** it completes, **Then** `LIBRARY` components are still yielded for the purl-identified packages and zero edges are written — no error.
7. **Given** a second identical completed run, **When** it finishes, **Then** zero duplicate components or edges exist.
8. **Given** the opt-in OFF (default), **When** a run completes, **Then** the output is identical to today's: exactly one component asset with `bomEntries`, no `relationships[]`, no `LIBRARY` assets.

---

### User Story 2 - Imported edges behave like every importer-added edge (Priority: P1)

A user browsing a component fed by an SBOM File import sees **Added by importer** provenance on its dependency edges with one-click Source/run resolution, an Editor can **Hide** a wrong edge with durable suppression, and a later run whose document drops a previously declared dependency removes only that Source's edge — all through the Phase-3 machinery with no sbom-file-specific backend or UI work.

**Why this priority**: The research's ship gate — review-free import is only trustworthy with provenance, suppression, and honest retirement. These behaviors are inherited from the generic edge pass, but the spec must prove the inheritance works end-to-end for the second carrier rather than assume it.

**Independent Test**: hide an sbom-file-imported edge, re-run the same document, verify the edge does not return; remove a dependency from the document, re-run, and verify that edge alone retires while curated edges survive.

**Acceptance Scenarios**:

1. **Given** an importer-added edge from an SBOM File run, **When** it renders in a relationships read surface, **Then** it shows **Added by importer** with a working link to the reporting Source and run.
2. **Given** an Editor choosing **Hide edge** on an sbom-file-imported edge, **When** a later completed run re-declares the same pair, **Then** the edge is not recreated (pair-scoped suppression).
3. **Given** a completed run whose document no longer declares a dependency the Source previously added, **When** the run finishes, **Then** only that Source's absent importer-added edges are removed; curated edges and other Sources' edges are untouched (source-scoped diff).
4. **Given** a human-created edge on a pair an SBOM File run also declares, **When** the run completes, **Then** the edge remains **Curated** — never relabelled, overwritten, or duplicated.
5. **Given** a `FAILED`, `CANCELLED`, or `INTERRUPTED` run — including a degraded yield (fetch/parse failure), **When** it ends, **Then** no edges are written or removed by it.
6. **Given** an Editor turns the opt-in OFF after edges exist, **When** later runs complete, **Then** `relationships[]` is no longer emitted or processed; existing importer-added edges persist (disabling never silently deletes graph data).

---

### User Story 3 - Importer setup guide documents the opt-in (Priority: P2)

A user reading `docs/importers/sbom-file.md` sees the new opt-in field in the config table and a prose section explaining what it imports (dependency-graph edges as catalog `DEPENDS_ON` edges on LIBRARY components), the review-bypass semantics, and that hidden edges stay hidden.

**Why this priority**: The importer contract makes the guide part of the deliverable — a config field shipped without documentation leaves the work incomplete. It carries no user-facing behavior of its own, so it is P2.

**Independent Test**: read the published guide and confirm the field appears in the generated contract table and the review-bypass semantics are explained in prose.

**Acceptance Scenarios**:

1. **Given** the shipped change, **When** `docs/importers/sbom-file.md` renders, **Then** the config-field table includes the opt-in row and a prose section covers edge import, LIBRARY component creation, and Hide-later semantics.
2. **Given** the generated contract region, **When** `docs:importers` regeneration runs, **Then** the produced output matches the committed file (no drift — `docs:importers:check` passes).

---

### Edge Cases

- **Degraded yield**: fetch/parse/format failures yield the component degraded exactly as today — no `relationships[]`, no `LIBRARY` assets — regardless of opt-in.
- **Dependency edge to a purl-less package**: SPDX elements / CycloneDX components without purls cannot be resolved to identities (parser skips them) — edges touching them are silently dropped, consistent with `skipped` counting.
- **Declared target absent from the run**: an edge endpoint that resolves to no yielded asset's externalId is silently dropped (same-run scope, ADR-133 §2).
- **Self-edge or duplicate declaration**: parser-level dedup already collapses them; at most one edge per `(declaring, target)` pair.
- **Configured component is `RETIRED`**: subject edges still materialize — dedup resolved the target; default reads already exclude `RETIRED` records.
- **LIBRARY identity collision with curated catalog data**: yielded `LIBRARY` assets deduplicate on `(LIBRARY, provider, externalId)` where `externalId` is the normalized version-free purl — they merge into Phase-2 curated libraries and GitHub-carrier libraries, never duplicate (ADR-133, spec 075/076).
- **`componentSlug` unresolved at dispatch**: unchanged behavior — the run fails before any edge work (the importer never invents an identity).
- **Document subject also appears as a dependency target** (a package declaring a dependency on the described app): resolves to the configured component via both-position `SUBJECT` substitution.
- **The `bomImporterEdges` flag OFF**: the opt-in switch is hidden on the form (never disabled); a pre-existing opted-in config still honors the server-side config value — the flag gates the switch's visibility, not the run behavior, matching spec 076 semantics.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The SBOM File importer config MUST expose an `importDeclaredEdges` boolean, default OFF, described with the review-bypass copy "Imported dependencies are added to the catalog without review. You can hide any edge later." — and the importer manifest MUST declare `declaredEdgesConfigKey: "importDeclaredEdges"` so the backend edge pass and the flagged form switch activate for it.
- **FR-002**: When the opt-in is ON and a document parses successfully, the importer MUST attach `relationships[]` entries of `{ type: "DEPENDS_ON", targetExternalId }` to each asset it yields: edges declared by the document subject attach to the configured-component asset; edges declared by a library attach to that library's asset. The `SUBJECT` sentinel MUST be substituted with the configured component's externalId in either endpoint position.
- **FR-003**: When the opt-in is ON, the importer MUST yield one `LIBRARY`-category `DiscoveredAsset` per unique normalized version-free purl identity in the document's packages — `externalId` = the purl identity, `provider` from the purl ecosystem mapping, slug following `pkg-{type}-{name}` — so declared-edge targets resolve within the same run and libraries merge on the standard `(category, provider, externalId)` dedup triple.
- **FR-004**: When the opt-in is OFF, the importer's output MUST be byte-identical in shape to today: no `relationships[]` field, no `LIBRARY` assets, `bomEntries` presence semantics unchanged.
- **FR-005**: Server-side gating MUST apply unchanged — the backend collects `relationships[]` only when the run's manifest declares `declaredEdgesConfigKey` and the config's value is `true`; a `relationships[]` yield on a non-opted config is ignored.
- **FR-006**: Importer-added edges, provenance, Hide suppression, and source-scoped retirement for this carrier MUST be entirely the existing ADR-133 backend machinery — this feature adds no migrations and no new endpoints. *Deviation (code-review round 2)*: one minimal backend change was required — `runImporterEdgePass` is now gated on `≥1` yielded asset carrying the `relationships` field (field-presence authority, mirroring `bomEntries` in ADR-057 A1). Without it, a degraded yield would have collected an empty declared set and retired every prior importer edge, violating FR-007.
- **FR-007**: `FAILED`, `CANCELLED`, `INTERRUPTED`, and degraded-yield runs MUST NOT write or remove edges (inherited run-status gating).
- **FR-008**: Every importer unit test exercising the opt-in MUST run the emitted assets through `validateDiscoveredAsset` (the enforceable importer contract).
- **FR-009**: `docs/importers/sbom-file.md` MUST document the opt-in field (generated contract table regenerated via `docs:importers`), what it imports, and the review-bypass/hide-later semantics — per the importer contract's guide requirement.
- **FR-010**: The change MUST ship Playwright coverage for the surface it touches — creating/editing an SBOM File importer config with the declared-edge switch (visible under flag `bomImporterEdges`, hidden when OFF) — consistent with the repo's e2e-coverage rule.
- **FR-011**: No API endpoint changes and no contract changes are expected; if implementation surfaces one, `docs/openapi.yaml` updates in the same change (ADR-104). No new ADR is required — ADR-133 already covers additional carriers; its carrier note SHOULD be updated to record sbom-file as the second carrier.

### Key Entities *(include if feature involves data)*

- **DiscoveredAssetRelationship** (existing contract type): `{ type: "DEPENDS_ON", targetExternalId }` declarations on yielded assets — the carrier emits them; the generic edge pass resolves them within the run.
- **Document subject → configured component binding**: sbom-file's analogue of GitHub's repo subject — the `SUBJECT` sentinel substitutes the `resolvedComponent.externalId` injected at dispatch, so subject-declared edges land on the component the document describes.
- **LIBRARY component** (existing): first-class catalog component deduplicated on `(LIBRARY, provider, normalized version-free purl)` — yielded as edge endpoints and merge targets for curated/GitHub-carrier libraries.
- **No new persisted entities**: provenance columns, the suppression table, and junction rows all exist from spec 076.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An opted-in SBOM File config plus one completed run materializes 100% of the document's resolvable dependency edges as importer-provenance `DEPENDS_ON` edges with zero manual review actions, for both SPDX and CycloneDX documents.
- **SC-002**: A repeated run over an unchanged document produces 0 duplicate components and 0 duplicate edges; a document with one dependency removed retires exactly that one edge on the next completed run.
- **SC-003**: A hidden sbom-file-imported edge stays hidden across ≥2 subsequent completed runs, and a curated edge on the same pair remains possible and labelled **Curated**.
- **SC-004**: With the opt-in OFF, importer output is unchanged from the current release — 0 `LIBRARY` assets and 0 `relationships[]` entries across any document.
- **SC-005**: The change adds no migration or API surface; the only backend change is the authorized FR-006 deviation — the `relationships` field-presence authority gate in the two run services (verified by the backend edge-pass test suite) — plus the importer package's tests and the e2e form coverage.

## Assumptions

- Spec 076 is shipped and stable: the edge pass, provenance columns, suppression table, flagged UI surfaces, and `bomImporterEdges` flag (ON, gap G39 resolved) exist unchanged.
- The shared parsers' `BomParseResult.edges` projection is authoritative — sbom-file consumes `edges` as-is; parser bugs are out of scope.
- The opt-in needs no precondition toggle — unlike GitHub (where the graph costs a separate API call), the SBOM document parse always produces the edge set at no extra cost.
- `SUBJECT` substitution in both endpoint positions is a deliberate carrier-level choice (the sentinel exists for caller substitution); carrier 1's source-only substitution is not being retrofitted in this spec.
- Whether the LIBRARY-asset shaping helpers are shared via `packages/core` or duplicated locally is an implementation detail for the plan — the *behavioral* contract (identity, provider mapping, slug shape) is fixed by FR-003.
- No new ADR, no migration, no openapi.yaml change, no roadmap-visible capability beyond "second carrier" — the roadmap entry updates at ship time per done-criteria.
- The flag governs the *form switch's visibility*; a config already opted in continues to emit edges while the flag is OFF — consistent with spec 076 flag semantics (surface hiding, not behavior gating).
