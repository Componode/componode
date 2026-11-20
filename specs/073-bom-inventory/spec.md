# Feature Specification: BOM Inventory (Phase 1)

**Feature Branch**: `073-bom-inventory`

**Created**: 2026-11-20

**Status**: Draft

**Input**: User request — drive `NNN-bom-inventory` end-to-end through the spec-kit pipeline. This is **Phase 1 of the SBOM / Bill of Materials programme** defined in `researches/sbom_research.md` (normative input; all eight UX questions resolved 2026-11-20 and all decisions accepted). Phase 1 lets importers report the package inventory of any component (npm, PyPI, OS packages, container layers, firmware, etc.), stores it in a typed, queryable `bom_entries` model with tree structure, surfaces it through paginated read APIs and a read-only **Bill of materials** tab on the component detail page, and imports/exports CycloneDX 1.5 and SPDX 2.3 documents. Governing docs: ADR-057 (importer contract — `bomEntries` is added by Amendment 1 as *factual inventory*, not a graph edge), ADR-035/036/037/038/047 (source-scoped reconciliation), ADR-104 (openapi.yaml in the same change), ADR-113 (no auto-wiring — BOM never writes graph edges in Phase 1), ADR-119/120 (ImporterSource identity), ADR-130 (server-paginated lists), ADR-131 (new — BomEntry entity, ratified in this spec run), `docs/ux.md` §4–§7 (routes, states, flag governance). Phase 1b (`UX-PKG` packages explorer), Phase 2 (`bom-catalog-promotion`) and Phase 3 (`bom-importer-native`) are **separate specs** and out of scope here.

## Clarifications

### Session 2026-11-20 — research grill outcomes (all resolved, no open markers)

All decisions were settled in the research phase and are normative for this spec; the spec MUST NOT reopen them without a recorded reason.

- **Write semantics → source-scoped, diff-based replace** (Q2/ADR-131): on a `COMPLETED` run, the set of entries a Source reports for a `(componentId, componentInstanceId)` pair **replaces** its previous set as a key-matched diff — upsert rows whose key is present, delete only rows whose key is absent. Never delete-all-then-recreate: `bom_component_suggestions.bomEntryId` (Phase 2) is `ON DELETE CASCADE` and `resolvedComponentId` lives on the row. `FAILED`, `CANCELLED` and `INTERRUPTED` runs never replace; there is no `PARTIAL` status.
- **Completeness → field presence per asset**: a yielded asset with `bomEntries` **present** (including `[]`) means "collection finished, this is the truth" and replaces; `bomEntries` **absent** means "not attempted / collection failed" — the Source's prior set for that asset is untouched and staleness accrues. An importer that cannot collect omits the field and reports `bomInventory` degraded rather than yielding `[]`.
- **Dedup keys → `NULLS NOT DISTINCT`**: component-level entries carry a NULL `componentInstanceId`; upsert indexes must treat NULLs as equal or component-scoped BOMs re-insert every run.
- **Stale threshold → 7-day workspace-level default** (Q1): `bom.staleThresholdDays` in `app_settings`; revisit per-Source derivation once schedules are exposed.
- **Export → always the full BOM for the selected instance** (Q3); filters are ignored and the menu says so.
- **`direct` is authoritative for directness** (Q4): filters and badges use `direct`; `TRANSITIVE` scope is kept for CycloneDX/SPDX round-trip fidelity, and `direct` wins when an importer reports a contradictory pair.
- **`importer-sbom-file` targeting → explicit `componentSlug`** (Q5): validated at save (component exists and is `ACTIVE`), resolved to the `(category, provider, externalId)` dedup triple at run dispatch; an unresolvable slug fails the run with a clear error — it never silently creates a component.
- **Licence filtering / roll-ups deferred** (Q6, Q7): licences are displayed and searchable only; product-level roll-up is unscheduled.
- **Dependency suggestions → `/suggestions` segment in Phase 2** (Q8); nothing in Phase 1 creates suggestions or edges.
- **PURL identity** (for Phase 2 groundwork): canonical package identity is the normalized, version-free purl; verbatim purl is stored on each entry for display and export. No Library components are created in Phase 1.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Importer-reported package inventory lands in the catalog (Priority: P1)

An administrator turns on dependency inventory for an importer (e.g. GitHub `includeDependencyGraph`, Docker `includeSbom`, Kubernetes `includePodImageSbom`). On the next completed run, every applicable component gains a bill of materials: packages with purl, name, version, scope, licences, supplier, and where each was found — including nested sub-assemblies such as container image layers. Re-running replaces the Source's set without duplicating; a failed or cancelled run never wipes previously reported inventory.

**Why this priority**: Nothing else in the feature exists without data. This is the importer-contract extension (ADR-057 Amendment 1) plus the storage/reconciliation model (ADR-131) — the foundation every other story reads from.

**Independent Test**: enable dependency inventory on one importer, run it against a repo/image with a lockfile or SBOM, then query the BOM read API — entries appear with correct purl/version/scope/evidence; run again and confirm keys are upserted not duplicated; disconnect the source mid-run (or yield an asset without `bomEntries`) and confirm the prior set survives.

**Acceptance Scenarios**:

1. **Given** an importer with dependency inventory enabled reporting a repository with a lockfile, **When** the run completes, **Then** each package is stored with purl, name, version, scope, evidence source and detail (e.g. lockfile path), licences and supplier where known.
2. **Given** the same component reported in two consecutive completed runs, **When** the second run completes, **Then** entries whose keys still match are updated in place (`lastReportedAt` bumped), entries no longer reported are deleted, and no duplicates exist.
3. **Given** a run that fails, is cancelled, or is interrupted, **When** it ends, **Then** the Source's previously stored entries are unchanged.
4. **Given** a yielded asset where `bomEntries` is absent, **When** the run completes, **Then** that component's prior entries are untouched; **Given** `bomEntries: []`, **Then** the component's prior entries are removed (collection finished, truth is empty).
5. **Given** nested inventory (a container image with OS layer → OS packages → language packages), **When** imported, **Then** the tree is stored with correct parent-child structure and arbitrary depth.
6. **Given** an importer that cannot collect inventory for an asset (permission denied, dependency graph disabled), **When** the run completes, **Then** the asset yields without `bomEntries`, the `bomInventory` capability reports non-OK, and the capability notice names the cause and count.

---

### User Story 2 - Operator reads a component's bill of materials (Priority: P1)

An operator opens a component's detail page and sees a third tab, **Bill of materials** (with the unfiltered package count). The tab shows a summary strip (packages, direct count, ecosystems, distinct licences, last-reported with Source link), a filter toolbar (search, ecosystem, scope, found-in, depth, catalog placeholder), an instance picker when more than one instance has inventory, a flat-or-tree table, server pagination, and an export menu — all state in the URL, all read-only, behind the `componentBom` flag.

**Why this priority**: The read surface is the user-visible value of Phase 1 and the contract every later phase builds on. It also proves the pagination/scale design (ADR-130) against real inventories of thousands of packages.

**Independent Test**: seed a component with a multi-thousand-entry BOM, open `?tab=bom`, exercise every filter/sort/page/instance/view combination, reload the URL, and confirm identical state; repeat with the flag off (tab absent), an empty BOM, a stale source, and a multi-source component.

**Acceptance Scenarios**:

1. **Given** `componentBom` ON and a component with entries, **When** the operator opens `?tab=bom`, **Then** the summary strip, toolbar, flat table and pagination render from real data; with the flag OFF the tab is not rendered at all.
2. **Given** a 5,000-entry BOM, **When** the tab loads, **Then** the first page renders from a single paginated request, no request returns more than one page, and the list stays interactive (UX verification #3).
3. **Given** filters/search/sort/page/instance/view set, **When** the URL is reloaded or shared, **Then** the identical view returns; changing any filter resets to page 1 (UX-BOM-02/03).
4. **Given** a component with two BOM-bearing instances, **When** the tab opens, **Then** the instance picker offers *All (merged)* plus each instance; merged view shows one row per package with "in N of M instances".
5. **Given** nested entries and `hasNesting`, **When** the user switches to tree view and expands a row, **Then** direct children load lazily; applying a filter switches back to flat with the announced notice (UX-BOM-11/12).
6. **Given** any state in the state matrix (loading, capability-off, awaiting-first-run, filtered-empty, refetching, partial-capability, stale, multi-source, error, forbidden, flag-off), **When** it occurs, **Then** the tab renders the specified treatment (UX-STATE-01…11).
7. **Given** any package row, **When** rendered, **Then** no warning/destructive tone or advisories column appears, and copy contains none of the forbidden words (D8, UX-BOM-16, G40).

---

### User Story 3 - Ingest an external SBOM document onto an existing component (Priority: P2)

An administrator has an SBOM file produced elsewhere (Syft, Trivy, a vendor) hosted at a URL. They configure the new `importer-sbom-file` importer with the URL and the slug of the catalog component it describes. The importer auto-detects CycloneDX JSON or SPDX JSON, parses it — including nested components and relationship-driven scope — and the inventory lands on that component's BOM, with the sbom-file Source as an additional reporter.

**Why this priority**: This is the canonical interoperability path — it proves both parsers, the tree model, and multi-Source reporting without depending on any cloud provider. It is also the only Phase 1 ingestion route for components whose native importer cannot collect inventory.

**Independent Test**: point `importer-sbom-file` at a CycloneDX document for a multi-layer container and an SPDX 2.3 document for a repository, each targeted at an existing component slug; verify format detection, tree depth > 1, scope mapping, and that re-running replaces rather than duplicates.

**Acceptance Scenarios**:

1. **Given** a config with `sbomUrl` serving CycloneDX JSON and a valid `componentSlug`, **When** the run completes, **Then** the document's components (including nested `components[]`) appear on that component's BOM with correct purl/scope/licences/supplier.
2. **Given** an SPDX 2.3 JSON document, **When** ingested, **Then** packages map per the SPDX mapping table — `relationshipType` drives scope, `CONTAINS`/`CONTAINED_BY` drive tree nesting, `DESCRIBES` identifies the subject.
3. **Given** a `componentSlug` that resolves at save but whose component is renamed or retired before dispatch, **When** the run is dispatched, **Then** it fails with a clear error and creates no component and no entries.
4. **Given** the same document ingested twice, **When** the second run completes, **Then** entries are replaced by key-match — no duplicates, pending curation references preserved.

---

### User Story 4 - Export a component's BOM for external tools (Priority: P2)

A viewer or auditor downloads the bill of materials in one of three formats — Componode JSON (all fields), CycloneDX 1.5 (scanners/compliance), SPDX 2.3 (licence/procurement) — as a streamed file download with a predictable filename, always covering the full BOM for the selected instance.

**Why this priority**: Export is the interoperability half of the contract (ingest is US3) and the product's first file download; it is required for CycloneDX/SPDX round-trip validation but blocks no other story.

**Independent Test**: export each format for a component with nested and multi-scope entries; validate CycloneDX output against the CycloneDX 1.5 schema and SPDX output against the SPDX 2.3 schema; ingest an SPDX doc, export as CycloneDX, re-ingest — no duplicates.

**Acceptance Scenarios**:

1. **Given** any component with a BOM, **When** exporting `format=cyclonedx`, **Then** the response is schema-valid CycloneDX 1.5 JSON with `Content-Disposition` filename `{component-slug}-bom.cdx.json` (or `…-{instance}-bom.cdx.json` when an instance is selected).
2. **Given** the same component, **When** exporting `format=spdx`, **Then** the response is schema-valid SPDX 2.3 JSON; `parentBomEntryId` nesting exports as `CONTAINS` relationships.
3. **Given** entries scoped BUILD/DEV/TEST, **When** exported, **Then** scopes map per the lossy table and the export menu's notice discloses the lossiness (UX-EXP-02).
4. **Given** a very large BOM, **When** exporting, **Then** the response streams without buffering the whole document or freezing the UI; a Viewer can export (D2, UX-EXP-05).
5. **Given** list filters applied, **When** exporting, **Then** the file still contains the full BOM for the selected instance (Q3, UX-EXP-03).

---

### User Story 5 - Inventory freshness and provenance are visible (Priority: P3)

An operator can tell who reported a component's inventory and how fresh it is: per-entry `lastReportedAt`, per-Source last-reported in the summary, a warning-tone stale indicator when the newest report is older than the workspace threshold (default 7 days), and a per-Source popover when several Sources reported the same component.

**Why this priority**: "Present" must not masquerade as "current" — this is the honest-freshness principle — but it is display-layer work on top of data the earlier stories already produce.

**Independent Test**: report a component's BOM from two Sources on different days, age one past the threshold, and verify the summary strip, stale tooltip and multi-source popover; run the importer again and confirm `lastReportedAt` bumps per entry.

**Acceptance Scenarios**:

1. **Given** entries reported by two Sources, **When** the summary loads, **Then** *Last reported* becomes a popover listing each Source and its time; row hover names the reporting Source (UX-FRESH-04).
2. **Given** a newest `lastReportedAt` older than `bom.staleThresholdDays`, **When** the tab renders, **Then** *Last reported* uses the warning tone with the stale tooltip; rows keep normal styling (UX-FRESH-03).
3. **Given** a re-reported entry, **When** the run completes, **Then** its `lastReportedAt` is bumped while `createdAt` is preserved.

---

### User Story 6 - BOM visibility in lists, runs, and importer configuration (Priority: P3)

Operators discover BOM coverage outside the detail tab: the Components list gains a **BOM** filter (Has BOM / No BOM), the dashboard coverage card gains a **Components with a BOM** line, run detail shows a **Packages** tile with created/unchanged/updated/removed counts (Changes tab stays component-only), and the new importer options appear in the schema-driven forms with helper text naming what is imported and its cost/prerequisite.

**Why this priority**: Discoverability and operator feedback — valuable, but each surface degrades gracefully without blocking the core read flow.

**Independent Test**: run a BOM-enabled import, then check the Components list filter, the dashboard line, the run detail tile, and each importer form's helper text.

**Acceptance Scenarios**:

1. **Given** components with and without BOM data, **When** the Components list BOM filter is set to "Has BOM", **Then** only BOM-bearing components list.
2. **Given** a completed BOM run, **When** run detail opens, **Then** the Packages tile shows created/unchanged/updated and removed counts; the Changes tab lists components only (UX-IMP-04).
3. **Given** the GitHub/Docker/Kubernetes/sbom-file forms, **When** rendered, **Then** the new toggles/fields come from the schema (no bespoke code) with the minimum helper text from UX-IMP-02.
4. **Given** an importer whose BOM collection is degraded (e.g. dependency graph disabled on private repos), **When** the config is viewed, **Then** `bomInventory` shows a non-OK capability notice with cause and affected count (UX-IMP-03).

---

### Edge Cases

- **Same package, multiple instances**: merged view collapses to one row per `(purl, version, scope)` with instance counts; per-instance view is exact.
- **Same package, multiple Sources**: the row remains single; `lastReportedAt` reflects the most recent report and provenance names the Source(s). A Source that stops *collecting* leaves its set in place (field-presence contract); a Source that completes a run no longer *reporting* an entry sees it removed.
- **Entry changes parent between runs** (e.g. a package moves layers in a rebuilt image): key-matched diff deletes the old-key row and inserts the new — child rows follow via `ON DELETE CASCADE` on `parentBomEntryId`.
- **Component-scoped vs instance-scoped entries** (`componentInstanceId` NULL vs set) coexist under one component and dedupe independently (`NULLS NOT DISTINCT`).
- **Contradictory `scope=TRANSITIVE` + `direct=true`**: `direct` wins; scope is retained for round-trip fidelity only (Q4).
- **Unresolvable `componentSlug` at dispatch** (renamed/retired component): run fails with a clear error; no component is created (Q5).
- **BOM larger than page bounds**: all list reads are server-paginated; exports stream. Tree children paginate at 50 per expand with a "Show 50 more" row (UX-BOM-12).
- **Ingest → export → re-ingest round-trip**: identical identity keys produce upserts, never duplicates.
- **Flag off mid-session** or component retired: tab hidden; direct GET on the BOM endpoints still obeys standard not-found/forbidden handling (UX-STATE-10/11).

## Requirements *(mandatory)*

### Functional Requirements

**Importer contract & storage**

- **FR-001**: The importer yield contract MUST let any importer report a package-inventory list per discovered asset — each entry carrying at minimum a purl, name, version, dependency scope, evidence source (and free-text detail), licences, supplier, CycloneDX type/bom-ref, optional nested children, and a details bag — as factual observational data, never as graph-edge declarations (ADR-057 Amendment 1).
- **FR-002**: Package inventory MUST persist in a typed store keyed to the component (and optionally to a component instance), supporting a self-referential parent link so nested assemblies (multi-layer containers, SPDX `CONTAINS`) store at arbitrary depth (ADR-131).
- **FR-003**: On a `COMPLETED` run the system MUST replace the reporting Source's prior entry set per `(component, instance)` as a key-matched diff — upsert present keys, delete absent keys — and MUST NOT delete-all-then-recreate. `FAILED`, `CANCELLED` and `INTERRUPTED` runs MUST NOT replace.
- **FR-004**: Completeness MUST be signalled per asset by field presence: `bomEntries` present (including empty) replaces; absent preserves the Source's prior set. An importer that cannot collect MUST omit the field and report `bomInventory` capability degraded.
- **FR-005**: Entry identity for dedup MUST be `(componentId, purl, scope, componentInstanceId, parentBomEntryId)` with NULL instance/parent treated as equal (`NULLS NOT DISTINCT`), so re-runs update in place.
- **FR-006**: Every entry MUST track `direct` (authoritative for directness) and `lastReportedAt` (bumped on every report, distinct from `updatedAt`).

**Read & export APIs**

- **FR-007**: A component-scoped BOM list endpoint MUST provide server-paginated reads (same envelope/bounds as other lists, ADR-130) with `q` (name/purl/licence, case-insensitive), multi-value `scope`/`ecosystem`/`found` filters, `direct`, `instanceId`, `view=flat|tree`, `parentId` (lazy children), and a sort whitelist (`name` default, `version`, `scope`, `ecosystem`, `lastReportedAt`); a `catalog` filter is accepted but ignored until Phase 2.
- **FR-008**: With no `instanceId`, the list MUST return a merged view — one row per package identity with `instanceCount`/`instanceTotal`; with `view=tree`, top-level rows carry `hasChildren`/`childCount`.
- **FR-009**: A summary endpoint MUST return totals (`total`, `direct`, `ecosystems`, `licenseCount`, `hasNesting`), newest `lastReportedAt`, per-Source freshness `{id, name, importerKind, lastReportedAt}`, and per-instance `{id, name, environment, entryCount}` — the single call the tab uses for the summary strip, instance picker, tree toggle and stale state.
- **FR-010**: An instance-scoped BOM endpoint MUST return exactly one instance's entries.
- **FR-011**: A streamed export endpoint MUST produce Componode JSON, CycloneDX 1.5 and SPDX 2.3 documents for the **full** BOM of the selected component/instance (filters never apply), with `Content-Disposition` filenames per UX-EXP-04, available to Viewers (D2).
- **FR-012**: CycloneDX and SPDX exports MUST be schema-valid; scope mapping MUST follow the research's lossy tables (BUILD/DEV/TEST collapse on export); nesting exports as CycloneDX `components[]` / SPDX `CONTAINS`.
- **FR-013**: All BOM endpoints are authenticated reads; `GET`s are side-effect-free on domain state (ADR-094/097); responses never leak internals (ADR-096); `docs/openapi.yaml` is updated in the same change (ADR-104).

**Importers**

- **FR-014**: The GitHub importer MUST gain `includeDependencyGraph` — fetching the repository dependency-graph SBOM (SPDX) and falling back to parsing supported lockfiles/manifests from the default branch when the graph is unavailable — populating `bomEntries` on each repository asset.
- **FR-015**: The Docker importer MUST gain `includeSbom` — reading image SBOM attestations via the OCI Referrers API (Syft fallback per research), evidence `IMAGE_LAYER`, nested layers preserved.
- **FR-016**: The Kubernetes importer MUST gain `includePodImageSbom` — resolving each pod's container image SBOM and attaching it to the workload asset with `evidenceDetail` naming the image ref.
- **FR-017**: A new `importer-sbom-file` package MUST ingest a CycloneDX JSON or SPDX JSON document from a configured `sbomUrl` (format auto-detected) onto the component named by configured `componentSlug` — slug validated at save, resolved to the `(category, provider, externalId)` triple at dispatch; an unresolvable slug fails the run and never creates a component.
- **FR-018**: Every BOM-capable importer MUST declare a `bomInventory` capability family that degrades honestly (non-OK surfaced through the existing capability mechanism with cause and affected count; "Dependency inventory" label added).
- **FR-019**: Run detail MUST report package counts (created/unchanged/updated, and removed given replace semantics) while the itemised Changes tab stays component-only (UX-IMP-04).
- **FR-020**: Every created/changed importer MUST ship/refresh its user-facing setup guide (`docs/importers/<name>.md`) covering external-tool setup, credentials, every config field, and common failures — including a new guide for `importer-sbom-file` naming the componentSlug rule.

**Bill of materials tab (flag `componentBom`, gap G36)**

- **FR-021**: The component detail page MUST gain a read-only **Bill of materials** tab (`?tab=bom`, count = unfiltered total for the current instance selection) rendered only when `componentBom` is ON — hidden, never disabled (UX-BOM-01, UX-STATE-11).
- **FR-022**: The tab MUST implement UX-BOM-02…14 and UX-A11Y-01…07: URL-driven state via `useListState`; Flat default view, `name asc` default sort; the specified columns, `BOM_SCOPE_META`/`BOM_EVIDENCE_META` badges (neutral/brand/info tones only), licence `+N` chips, row menu ("See where it's used" gated to Phase 1b, "Copy purl" now); instance picker only when >1 BOM-bearing instance; tree toggle only when `hasNesting`; lazy children at 50/page with retry row; filters auto-switch to flat with announcement; export menu; footer disclaimer line.
- **FR-023**: The tab MUST render every state in the state matrix UX-STATE-01…11 — including stale (warning-tone *Last reported* + tooltip, threshold from `bom.staleThresholdDays` default 7), multi-source popover, partial-capability alert, and the two empty variants with the Admin-only **Configure importer** action.
- **FR-024**: The export menu MUST offer the three formats with audience descriptions, the lossy-mapping notice, a note that export always covers the full BOM, live-region start/finish announcements, and toast error + retry on failure (UX-EXP-01…05).
- **FR-025**: No advisory/vulnerability UI of any kind is rendered — not even disabled (D8, UX-BOM-16, G40); package rows never use warning/destructive tones and copy contains none of the forbidden words (safe, secure, clean, vulnerable, risk, threat, compliant).
- **FR-026**: The Components list MUST gain a **BOM** filter (Has BOM / No BOM) and the dashboard coverage card a **Components with a BOM** line — both under the same flag.
- **FR-027**: Importer forms MUST expose the new toggles/fields through the existing schema-driven forms with helper text naming what is imported and its cost/prerequisite (UX-IMP-01/02), and non-OK `bomInventory` families MUST surface via the capability-notice pattern (UX-IMP-03).

**Governance & docs**

- **FR-028**: ADR-057 Amendment 1 (bomEntries as factual inventory), new ADR-131 (BomEntry entity + write semantics), the Constitution Principle V clarification, and the `architecture-decisions.md` registration MUST ship in the same change.
- **FR-029**: `docs/ux.md` (route map, tab, vocabulary) and `researches/ux-rewrite-gaps.md` (G36 entry with flag/surface/flip-condition; G40 deferred-no-flag entry) MUST be updated in the same change.
- **FR-030**: Playwright coverage MUST exercise the browsing flows the change touches — BOM tab flows (states, filters, tree, export), importer-form toggles, run tile, list filter — per the testing rule in AGENTS.md.

### Key Entities

- **BOM entry** — one reported package/library/firmware fact on a component (or a specific instance): purl identity, name, version, ecosystem (purl type), dependency scope, evidence source/detail, licences, supplier, CycloneDX type/ref, direct flag, reporting Source and run, parent entry for tree structure, `lastReportedAt`. Written exclusively by importers; never user-edited.
- **Discovered BOM entry** — the importer-contract shape of the above (recursive `children[]`), carried on `DiscoveredAsset.bomEntries`.
- **ImporterSource** — the reporter identity; BOM replace semantics and freshness are scoped to it.
- **`bom.staleThresholdDays`** — workspace `app_settings` key controlling the stale indicator (default 7).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Enabling dependency inventory on an importer and completing one run produces a component BOM whose entries carry correct purl, version, scope and evidence; a second identical run changes `lastReportedAt` only — zero duplicate entries.
- **SC-002**: A CycloneDX document and an SPDX document for the same multi-layer component both ingest via `importer-sbom-file` with tree depth > 1 and correct scope mapping; a failed/cancelled/interrupted run never deletes stored entries.
- **SC-003**: CycloneDX and SPDX exports validate against their respective official schemas; an ingest → export → re-ingest round-trip produces no duplicates.
- **SC-004**: A 5,000-entry BOM renders its first page from a single paginated request, stays interactive, and never returns more than one page per request (UX verification #3).
- **SC-005**: All Phase-1 UX verification items pass — URL round-trip, instance picker behaviour, tree keyboard walkthrough (UX-A11Y-01), export filenames/Viewer access/lossy notice, and every state-matrix row.
- **SC-006**: Viewers can read and export any BOM; no write path exists for BOM rows; zero warning/destructive tones or forbidden words appear on package surfaces.
- **SC-007**: A component whose inventory stops being collected (field absent) keeps its last-known entries and visibly accrues staleness; one whose source completes a run without the entry sees it removed.

## Assumptions

- `researches/sbom_research.md` is the authoritative design input; its Phase-1 sections, UX requirements (UX-BOM, UX-FRESH, UX-EXP, UX-IMP, UX-STATE, UX-A11Y), mapping tables and read contract are normative detail for this spec.
- purl is the canonical package identity; no new identity scheme is invented.
- Phase 1b (`/packages` explorer, `packagesExplorer` flag, G37), Phase 2 (catalog promotion, suggestions, `bomCuration`, G38) and Phase 3 (importer-native edges, `bomImporterEdges`, G39) are separate specs; this spec only delivers what they build on — including the `In catalog` column data (`resolvedComponent`, `pendingSuggestionId` always null in Phase 1) but not the column itself, which renders only under `bomCuration` (UX-BOM-08).
- SBOM file upload from the browser stays out (D3); ingestion is URL/importer-based only.
- The BOM tab is read-only in Phase 1 (D7); row-menu write items are Phase 2 only.
- Migration numbering follows the existing sequence (research proposes `032_bom_entries`); the plan confirms the next free number against `packages/backend/src/db/migrations/`.
- The four importer surfaces (GitHub, Docker, Kubernetes, sbom-file) are the Phase-1 set; other importers gain `bomInventory` capability only when they add a BOM toggle.
