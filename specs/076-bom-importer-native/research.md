# Research: BOM Importer-Native Declared Edges (Phase 3)

All Phase-0 unknowns resolved. Normative inputs: `researches/sbom_research.md` (Phase 3 + UX-EDGE, settled 2026-11-20), spec.md Clarifications (carrier + retirement confirmed 2026-11-23), and the shipped Phase 1/1b/2 code.

## D1 — Provenance lives on the junction rows

**Decision**: add `provenance` (`CURATED`|`IMPORTER`, default `CURATED`), `importerSourceId` (FK `importer_sources`, `ON DELETE SET NULL`), `importRunId` (FK `import_runs`, `ON DELETE SET NULL`) to all three component-edge junctions: `component_depends_on_component`, `component_sources_from`, `component_exposes`. Existing rows backfill `CURATED` — every current writer (Phase-2 link-all, suggestion accept, manual paths) is a human action.

**Rationale**: ADR-048 forbids a polymorphic edges table; provenance is edge metadata, so it belongs on each typed junction. A single nullable column set is uniform across junctions and keeps the read bounded — the relationships read already selects junction rows, so provenance is extra selected columns, not a join.

**Alternatives considered**: a separate `edge_provenance` table keyed by (kind, from, to) — rejected: a second write target per edge and a join per read; provenance is intrinsic edge data, not a lifecycle entity. Provenance only on `depends_on` (research's literal text) — rejected: UX-EDGE-01 says "every dependency edge displays provenance" and all three junctions are importer-writable under the same contract; partial coverage would silently mislabel `SOURCES_FROM`/`EXPOSES` edges.

## D2 — Suppression is a dedicated pair-keyed table

**Decision**: `component_edge_suppressions` — `(id, edgeKind CHECK IN ('DEPENDS_ON','SOURCES_FROM','EXPOSES'), fromComponentId FK→components CASCADE, toComponentId FK→components CASCADE, suppressedBy FK→persons SET NULL, createdAt)` with `UNIQUE(edgeKind, fromComponentId, toComponentId)`. Hide = insert suppression + delete the junction row, in one transaction.

**Rationale**: the suppression must outlive the edge — deleting the junction row is the honest state ("edge is not in the catalog") and keeps every existing read unchanged; the pair-keyed record is what the edge pass consults on re-declare. Pair scope (not per-source) matches the UX-EDGE-03 copy "You can hide any edge later" — the edge is the unit, whoever reports it.

**Alternatives considered**: a `suppressedAt` flag on the junction row — rejected: every read would need a filter, and a suppressed-but-present row would resurrect on `ON CONFLICT DO NOTHING` semantics (conflict → no write → row still suppressed, but the flag now blurs "edge exists" vs "edge hidden"). Per-source suppression — rejected: an edge the user hid would reappear the moment any other Source reports it.

## D3 — Same-run resolution uses the processing-time identity map

**Decision**: during `processAsset`, when the asset carries `relationships[]` and the run's config opted in, the run service records `(declaringComponentId, type, targetExternalId)` alongside the per-run `externalId → componentId` map it already builds for dedup. At `COMPLETED`, the pass resolves each `targetExternalId` against that map only; misses are dropped silently (counted in pass telemetry).

**Rationale**: "same run's assets" is literally the yielded set — the map is already materialized for dedup/reconciliation, so resolution is O(1) per edge with zero extra queries and zero cross-run leakage. Declaring-side `componentId` is known at yield time (post-dedup), so only the target needs resolving.

**Alternatives considered**: resolving `targetExternalId` via catalog-wide `(category, provider, externalId)` lookups at pass time — rejected: it would wire cross-run edges (explicitly prohibited) whenever the target happens to exist from an older run.

## D4 — Retirement is a source-scoped diff at COMPLETED

**Decision** (confirmed by clarify): after writing the newly resolved set, the pass deletes junction rows where `provenance='IMPORTER' AND importerSourceId=<this source>` and `(edgeKind, from, to)` is absent from the just-declared set — across all three junctions. `CURATED` rows and other sources' rows are never in the delete set. Runs ending `FAILED`/`CANCELLED`/`INTERRUPTED` skip the pass entirely (parity with `deleteAbsentBomEntries`).

**Rationale**: ADR-119's source-scoped reconciliation, applied to edges — a completed run is the Source's truth for its own contributions. Append-only was rejected in clarify: stale edges would accumulate with no removal path but per-edge Hide.

**Known limitation** (recorded, accepted): provenance records a single writer. If Source A wrote the edge first and Source B also reports it, A's silence deletes the row even though B still declares it; B's next run recreates it (`ON CONFLICT DO NOTHING`). One-run flicker, self-healing — an acceptable v1 bound; multi-reporter provenance would need a reporters table and is not worth it now.

## D5 — Opt-in is manifest-declared and server-enforced

**Decision**: importer manifests gain an optional declared-edge descriptor (a config-key name, e.g. `declaredEdgesConfigKey: "importDeclaredEdges"` — the importer contract documents the convention). The edge pass runs only when the run's manifest declares the key **and** `config[key] === true` in the stored ImporterConfig. A yield of `relationships[]` without opt-in is ignored — collected-but-not-processed is impossible because collection itself is gated on the same check.

**Rationale**: FR-002 requires the opt-in to be honoured server-side, not just by importer self-restraint. The manifest-level descriptor keeps the mechanism importer-agnostic (sbom-file/k8s can adopt later without backend changes) while the config stays importer-specific JSON as today.

**Alternatives considered**: trusting the importer to not yield unless configured — rejected: a buggy or hostile importer would bypass user consent. A workspace-global switch — rejected: opt-in is per-config consent, like every other importer capability field (`includeDependencyGraph` precedent).

## D6 — Carrier: `importer-github`, same SPDX fetch

**Decision** (confirmed by clarify): `importDeclaredEdges` on the GitHub importer config. When ON, the importer still makes the same dependency-graph call (`GET /repos/{o}/{r}/dependency-graph/sbom`, SPDX 2.3); in addition to `bomEntries` it yields `LIBRARY` assets for each SPDX package and `relationships[]`. Requires `includeDependencyGraph` — the config schema refines `importDeclaredEdges ⇒ includeDependencyGraph` (invalid combination rejected at save).

**Rationale**: the document already carries the graph (`relationships[]` section, parsed for scope today); the only new work is emitting it under the v2 contract. `LIBRARY` asset identity = `normalizePurlIdentity(pkg purl)` in `externalId`, `category=LIBRARY`, `provider=mapEcosystemToProvider(purl type)`, `resourceType` = purl type — the exact Phase-2 curated-library identity triple, so dedup merges instead of duplicating.

**Alternatives considered**: new `importer-github-dependencies` package — rejected (clarify): duplicates credentials/source plumbing for the same API surface. `importer-sbom-file` as carrier — rejected (clarify): SPDX file ingest can adopt the same contract later; GitHub dep graph is the research's named verification path. Edges from lockfile fallback — out of scope: lockfiles give no relationship structure; when dep-graph is unavailable and lockfile fallback produced entries, no `relationships[]` is yielded (degraded-marker path unchanged).

## D7 — `parseSpdxDocument` emits the edge set, not the importer

**Decision**: extend `BomParseResult` with `edges`: dependency relationships already walked for scope/directness, keyed by SPDXID and projected to each package's version-free purl identity; the document-subject end is returned as a placeholder (`SUBJECT`) the caller substitutes with the repo's `externalId`. Importer-github composes: `SUBJECT → pkg` becomes a `relationships[]` entry on the repo asset; `pkg → pkg` becomes entries on the declaring package's LIBRARY asset.

**Rationale**: SPDX relationship semantics (`X DEPENDENCY_OF Y` vs `Y DEPENDS_ON X` direction, subject detection) already live in the parser; duplicating them in the importer invites drift. Other SPDX consumers (sbom-file, OCI attestations) inherit the same projection free.

## D8 — Hide route: `POST /component-edge-suppressions`

**Decision**: new endpoint `POST /component-edge-suppressions`, body `.strict()` `{ edgeKind, fromComponentId, toComponentId }`, `requireRole("component:edge:remove")` (new permission, `EDITOR` — symmetric with `product:edge:remove`). Transaction: insert suppression (`ON CONFLICT DO NOTHING` — re-hide is idempotent) + delete the matching junction row + `writeEdgeChange` (`removed`, actor = session user, reason `edge-suppressed`). Returns `204`/`200 {suppressed:true}`. No GET/DELETE surface in v1 — the escape hatch is human re-creation (Phase-2 link/accept paths bypass suppression, as intended).

**Rationale**: resource-oriented POST matches the suggestions decide endpoints; a dedicated suppression resource reads better than overloading `DELETE` on a pair-keyed junction that may not exist.

## D9 — Relationships read carries edge provenance per row

**Decision**: each lane row in `GET /components/:id/relationships` gains optional `edgeProvenance: "CURATED"|"IMPORTER"`, `edgeImporterSourceId`, `edgeImportRunId`, `edgeImporterConfigId` (source→config join, needed for the `/importers/{configId}/runs/{runId}` deep link — one click to the run per UX-EDGE-01). Columns come off the already-selected junction row; the `libraryCounts` contract and `LIBRARY` lane exclusion are unchanged.

**Rationale**: bounded-read contract preserved (ADR-128) — provenance adds columns, not rows. `edgeImporterConfigId` avoids a frontend second-hop just to build the run URL.

## D10 — Flag + docs surface

**Decision**: `bomImporterEdges` in `flags.ts` ships **ON** (backend + UI land together, per the Phase-2 pattern); gap registry gains **G39 — Importer-added edge provenance — RESOLVED by spec 076**. While OFF: provenance badges, Hide edge, and the opt-in switch are absent (never disabled). ADR-133 is written in this change with back-pointers in ADR-057 and the Principle V constitution note; `docs/importers/github.md` documents the switch; `docs/roadmap.md` marks Phase 3 shipped; `docs/openapi.yaml` updated (ADR-104).
