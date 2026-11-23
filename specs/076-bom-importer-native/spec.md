# Feature Specification: BOM Importer-Native Declared Edges (Phase 3)

**Feature Branch**: `076-bom-importer-native`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User request — drive `Phase 3 (bom-importer-native)` end-to-end through the spec-kit pipeline. This is **Phase 3 of the SBOM / Bill of Materials programme** defined in `researches/sbom_research.md` (normative input; all decisions settled in the research grill, 2026-11-20). Phase 1 (spec 073) landed `bom_entries` and the BOM read/export APIs; Phase 1b (spec 074) shipped `/packages`; Phase 2 (spec 075) shipped catalog promotion, `LIBRARY` components, and human-decided dependency suggestions. Phase 3 lifts the v1 prohibition on importer-declared edges: an **opted-in** importer may yield `LIBRARY`-category `DiscoveredAsset` objects and `relationships[]` within the same run, and the system writes `component_depends_on_component` (and the sibling `SOURCES_FROM`/`EXPOSES` junctions) **without human review** — guarded by per-config opt-in, edge provenance, and edge suppression so the act stays reversible and explainable. Governing docs: `researches/sbom_research.md` § Phase 3 / UX-EDGE / Vocabulary (normative), ADR-057 + Constitution Principle V (the prohibition being lifted — ADR-133 amends), ADR-113 (suggestion pattern Phase 3 deliberately bypasses), ADR-119 (source-scoped reconciliation applied to edges), ADR-104 (openapi.yaml in the same change), ADR-094/095/097 (route contract), `docs/ux.md` §4–§7 (flag `bomImporterEdges`, gap G39).

## Clarifications

### Session 2026-11-23 — research decisions normative for Phase 3 (all resolved, no open markers)

All decisions settled in the research phase are normative for this spec; the spec MUST NOT reopen them without a recorded reason.

- **v2 contract shape**: `DiscoveredAsset` gains `relationships?: DiscoveredAssetRelationship[]` where each entry is `{ type: "DEPENDS_ON" | "SOURCES_FROM" | "EXPOSES", targetExternalId: string }` (ADR-133). `targetExternalId` resolves against the externalIds of assets in the **same run**; targets that resolve outside the run are silently dropped.
- **No human review, but reversible and explainable**: importer-added edges bypass the suggestion queue entirely. Safety comes from three mechanisms — per-config opt-in with explicit review-bypass copy (UX-EDGE-03), a provenance record on every edge answering "why does this edge exist?" in one click (UX-EDGE-01/04), and **Hide edge** suppression that survives re-imports (UX-EDGE-02).
- **`ON CONFLICT DO NOTHING` preserves curated edges**: a human-created edge on the same pair is never overwritten, relabelled, or deleted by an import; a re-reported pair creates no duplicate (Phase 3 verification steps 3–4).
- **Importers may yield `LIBRARY`-category assets**: these are first-class Components deduplicated on the normal `(category, provider, externalId)` triple — so they merge into curated Library components from Phase 2 whose `externalId` is the same normalized version-free purl, never create duplicates (Phase 3 verification step 1).
- **Provenance + suppression are schema, not convention**: a new migration adds an edge-provenance column set and an edge-suppression table for `component_depends_on_component` (research grill amendment; originally migration 035 — actual numbering follows the current sequence, ≥ 038).
- **Flag `bomImporterEdges`** with gap-registry entry **G39** governs the new UI surfaces (provenance badge, Hide edge, opt-in switch). Consistent with the Phase 2 pattern, it ships ON because backend and UI land together; while OFF every Phase 3 surface is hidden, never disabled.

Two points the research left open ("new importer (or capability on existing)") or did not explicitly settle were confirmed in this session:

- Q: Which importer should be the first carrier of the v2 `relationships[]` contract in this change? → A: capability on `importer-github`. The GitHub importer already fetches the dependency-graph SPDX document for `bomEntries` (Phase 1); the same document carries the package relationships. A new `importer-github-dependencies` package or extending `importer-sbom-file` are rejected for this change — a new package duplicates credential/source management for the same API surface, and sbom-file ingest can be added later under the same contract.
- Q: When a completed run no longer declares edges the same Source added before, what happens to those importer-added edges? → A: source-scoped diff retire. Importer-added edges behave like every other source-scoped membership (ADR-119): on a `COMPLETED` run, edges the Source previously added that are absent from the new declared set are removed; curated edges are never touched; suppressed pairs are not recreated. Append-only was rejected — it would leave stale edges a user cannot remove except one-by-one via Hide.

The remaining defaults below are recorded here and in Assumptions — they are scope decisions the implementer must not silently change:

- **Suppression granularity → the edge pair**. A suppression is keyed on `(parentId, childId, type)` — Hide means "this edge is unwanted", regardless of which Source reports it in a later run. Hiding writes a suppression record and removes the visible edge; a subsequent run that re-declares the pair does not recreate it.
- **Uniform treatment of the three declared types**: `DEPENDS_ON`, `SOURCES_FROM`, and `EXPOSES` all have junction tables and read lanes already (spec 060/061); the v2 contract declares all three and the provenance/suppression model applies to every importer-writable component edge, not only `DEPENDS_ON`.
- **Opt-in enforcement is server-side**: the backend's edge pass only processes `relationships[]` when the run's ImporterConfig enabled declared-edge import; a yield without opt-in is ignored. The switch is Editor+ to change, like every importer config field.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Importer declares dependency edges end-to-end (Priority: P1)

An Editor opts a GitHub importer config into declared-edge import — the form shows the explicit review-bypass copy — and the next completed run yields `LIBRARY` Components and dependency edges with no manual step. The Relationships tab and Library "Used by" sections show the imported graph immediately, each edge marked **Added by importer**.

**Why this priority**: This is the feature's reason to exist — turning importer knowledge into catalog graph truth. Every other story assumes it works.

**Independent Test**: enable declared-edge import on a GitHub ImporterConfig, run it against a repository with a dependency graph, and verify LIBRARY components, `component_depends_on_component` edges, provenance badges, and a clean second run with zero duplicates.

**Acceptance Scenarios**:

1. **Given** an Editor editing an eligible importer config, **When** the form renders, **Then** a declared-edge opt-in switch appears, defaults OFF, and shows the copy "Imported dependencies are added to the catalog without review. You can hide any edge later." (UX-EDGE-03)
2. **Given** an opted-in config and a completed run whose assets declare `relationships[]`, **When** the run's edge pass executes, **Then** each `targetExternalId` that resolves to an asset in the same run produces one junction edge of the declared type, marked importer-added with the Source and run recorded.
3. **Given** the same run's assets, **When** a `targetExternalId` matches nothing yielded in that run, **Then** that relationship is silently dropped — no edge, no suggestion, no error surfaced to the user.
4. **Given** a `FAILED`, `CANCELLED`, or `INTERRUPTED` run, **When** it ends, **Then** no edges are written or removed by it.
5. **Given** an opted-in run, **When** the importer yields `LIBRARY`-category assets, **Then** they are deduplicated on `(category, provider, externalId)` and merge into any existing curated Library component with the same purl identity — never duplicating it.
6. **Given** a completed opted-in run, **When** a later completed run omits edges the Source previously added, **Then** only that Source's absent importer-added edges are removed; curated edges and other Sources' edges are untouched (source-scoped diff).

---

### User Story 2 - Answer "why does this edge exist?" in one click (Priority: P1)

A user browsing a component's Relationships tab (or a Library's Used by list) sees provenance on every dependency edge: **Curated** for human-created edges, **Added by importer** for imported ones, with a link to the reporting Source and the run that added it.

**Why this priority**: UX-EDGE-04 exit criteria — provenance is what makes review-free import trustworthy. Without it Phase 3 must not ship (research: "it MUST NOT ship until all of the following exist in the UI and API").

**Independent Test**: open the Relationships view for a component with both curated and importer-added edges; verify badges distinguish them and the importer badge resolves to its Source and run.

**Acceptance Scenarios**:

1. **Given** any dependency edge in a read surface, **When** it renders, **Then** it shows **Curated** (human) or **Added by importer** (UX-EDGE-01).
2. **Given** an importer-added edge, **When** the user activates its provenance affordance, **Then** they reach the reporting Source and the specific run — one click from the badge.
3. **Given** a human creates an edge for a pair an importer also reports, **When** the next run completes, **Then** the edge remains labelled **Curated** and is never relabelled or overwritten.

---

### User Story 3 - Editor hides an importer-added edge (Priority: P1)

An Editor sees an importer-added edge that is wrong for this catalog and chooses **Hide edge**. The edge disappears and a suppression record ensures later runs that re-declare the same pair do not recreate it — while an identical human-created edge stays possible.

**Why this priority**: UX-EDGE-02 is the compensating control for bypassing review; without durable suppression, `ON CONFLICT DO NOTHING` alone would resurrect every user-deleted importer edge on the next run.

**Independent Test**: hide an importer-added edge, re-run the importer still declaring it, and verify the edge does not return; verify a curated edge offers no Hide action (or cannot be suppressed).

**Acceptance Scenarios**:

1. **Given** an Editor viewing an importer-added edge, **When** they choose **Hide edge** and confirm, **Then** the edge is removed from read surfaces and a suppression record is written for that `(parent, child, type)` pair.
2. **Given** a suppressed pair, **When** a later completed run re-declares it, **Then** no edge is created and the suppression persists.
3. **Given** a hidden edge's pair, **When** a human creates the same edge deliberately, **Then** the curated edge is allowed and displays **Curated** — suppression blocks importer recreation, not human curation.
4. **Given** a Viewer, **When** an importer-added edge renders, **Then** no **Hide edge** action is offered; a direct API call is rejected with the standard role error.

---

### Edge Cases

- **Cross-run target**: a relationship names an `externalId` that exists in the catalog but was not in this run → dropped (same-run scope is strict).
- **Self-edge or duplicate declarations**: an asset declaring an edge to itself, or the same `(target, type)` twice → one edge at most; self-edges are dropped.
- **Target resolves to a RETIRED component**: the edge is still written (dedup resolved it); default reads already exclude RETIRED records.
- **Suppressed pair re-declared by a *different* Source**: still suppressed — Hide is pair-scoped, not reporter-scoped.
- **Opt-in turned off after edges exist**: future runs ignore `relationships[]`; existing importer-added edges persist until the user hides them or a later opted-in run retires them — disabling the switch never silently deletes graph data.
- **Run interrupted mid-edge-pass**: edge writes are part of run completion; a run that never reaches `COMPLETED` leaves the prior edge set untouched.
- **Importer yields `relationships[]` without opt-in**: the backend ignores them entirely — no edges, no suggestions, no error.
- **Malformed relationship entry** (unknown type, missing `targetExternalId`): fails `validateDiscoveredAsset` per the importer contract — the whole asset is rejected like any other contract violation; partial imports of one valid edge among invalid ones are not attempted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The importer contract MUST allow a `DiscoveredAsset` to carry `relationships[]` entries of `{ type, targetExternalId }` with `type ∈ {DEPENDS_ON, SOURCES_FROM, EXPOSES}` (ADR-133), validated by `validateDiscoveredAsset` like every other contract field.
- **FR-002**: Each ImporterConfig for an edge-capable importer MUST expose an **opt-in** declared-edge switch, default OFF, displaying the review-bypass copy (UX-EDGE-03). The opt-in MUST be honoured server-side: `relationships[]` on a run whose config did not opt in are ignored.
- **FR-003**: On `COMPLETED` runs for opted-in configs, the system MUST resolve each `targetExternalId` against the externalIds of assets yielded in the same run and write the corresponding junction edge with importer provenance (Source + run). Unresolvable targets MUST be silently dropped.
- **FR-004**: Edge writes MUST be idempotent — re-declaring an existing `(parent, child, type)` pair creates no duplicate, and an existing curated edge for the pair is preserved untouched and keeps its **Curated** provenance.
- **FR-005**: Importer-added edges MUST follow source-scoped reconciliation: on a completed run, importer-added edges previously recorded for that Source and absent from the newly declared set MUST be removed; curated edges and other Sources' edges MUST NOT be touched.
- **FR-006**: `FAILED`, `CANCELLED`, and `INTERRUPTED` runs MUST NOT write or remove edges.
- **FR-007**: Every component dependency edge MUST carry provenance distinguishing **Curated** (human) from **Added by importer** (with Source and run reference), exposed through the relationships read contract so the UI can render it (UX-EDGE-01/04). This MUST cover every importer-writable component edge type.
- **FR-008**: Editors MUST be able to **Hide** an importer-added edge via an explicit action; the system MUST write a durable suppression record keyed on the edge pair and remove the edge from reads. Suppressed pairs MUST NOT be recreated by any later run or Source (UX-EDGE-02). Curated edges MUST NOT be suppressible, and human creation of a suppressed pair MUST remain possible.
- **FR-009**: Importers MUST be able to yield `LIBRARY`-category `DiscoveredAsset` objects; they MUST deduplicate on the standard `(category, provider, externalId)` triple so they merge into — never duplicate — curated Library components from Phase 2.
- **FR-010**: Hide edge and the opt-in switch MUST be Editor+ and API-enforced; Viewers see provenance but no write affordances.
- **FR-011**: The feature MUST ship behind flag `bomImporterEdges` with gap-registry entry G39; while OFF, the provenance badge additions, Hide edge, and the opt-in switch are hidden (never disabled). The flag ships ON with backend and UI landing together.
- **FR-012**: Any endpoint additions or response-field changes (edge hide/suppression route, provenance fields on the relationships read) MUST update `docs/openapi.yaml` in the same change (ADR-104).
- **FR-013**: The change MUST include the new **ADR-133** (v2 importer relationship contract — lifts the `relationships[]` prohibition, same-run scope, auto-reconciliation, provenance + suppression), registered in `researches/architecture-decisions.md` with back-pointers from ADR-057 and the Constitution Principle V note so the lifted prohibition is traceable.
- **FR-014**: The user-facing setup guide for every importer that gains declared-edge capability MUST document the opt-in switch, what it imports, and the review-bypass semantics (`docs/importers/<name>.md`, per the importer contract).

### Key Entities *(include if feature involves data)*

- **DiscoveredAssetRelationship**: a contract-level declaration on a yielded asset — `type` (`DEPENDS_ON`/`SOURCES_FROM`/`EXPOSES`) and `targetExternalId` scoped to the same run. Never persisted directly; resolved into junction edges at run completion.
- **Edge provenance** (on `component_depends_on_component` and the sibling component-edge junctions): distinguishes `CURATED` (human-written) from `IMPORTER` and, for imported edges, records which `ImporterSource` and import run wrote it — powering the badge, the one-click "why does this edge exist?" answer, and source-scoped retirement.
- **Edge suppression record**: a durable record keyed on the `(parent, child, type)` pair that prevents any later importer run from recreating a hidden edge; it does not block human creation.
- **Importer-added edge retirement scope**: the set of edges carrying a given Source's provenance — the unit of the source-scoped diff on completed runs (ADR-119 parity).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of component dependency edges display a provenance label, and a user can reach the responsible Source and run for any importer-added edge in one click (UX-EDGE-04).
- **SC-002**: An importer opt-in plus one completed run materializes every resolvable declared edge with zero manual review actions; 0 curated edges are created, relabelled, or deleted by the pass.
- **SC-003**: A hidden edge stays hidden across an arbitrary number of subsequent completed runs (verified over ≥2 re-runs, including a run by a different Source).
- **SC-004**: Repeated completed runs produce 0 duplicate edges for any declared pair.
- **SC-005**: A user cannot distinguish a stale import from truth — edges a Source stops declaring disappear on the next completed run; 0 importer-added edges survive their declaring Source's silence.

## Assumptions

- Phases 1, 1b, and 2 are shipped and stable; `bom_entries`, Library components, `bom_component_suggestions`, and the relationships read surface exist unchanged in behavior.
- The GitHub importer is the confirmed carrier of the v2 contract in this change (clarification Q1); other importers adopt it later under the same contract without further spec work.
- `component_sources_from` and `component_exposes` junctions participate identically — they exist, have read lanes, and the v2 contract declares all three types.
- Opt-in state lives on the importer config (like `includeDependencyGraph`), not globally per workspace.
- Suppression is pair-scoped and has no un-hide UI in v1; a suppressed pair can still be created manually, which is the escape hatch.
- Edge provenance on pre-existing rows defaults to `CURATED` (all current writers are human paths: Phase 2 link-all, suggestion accept, manual creation).
- Product-level edges remain out of scope — `relationships[]` in this contract targets components only; `COMPOSES`/`CONSUMES_FROM` stay human-curated per ADR-019/ADR-109.
- No performance SLO changes are needed; the edge pass is per-run bounded by the number of yielded assets.
