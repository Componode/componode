### ADR-133 — Importer-declared component edges (v2 `relationships[]` contract)

> **Status:** Ratified (spec 076)
> **Supersedes**: none
> **Amends**: ADR-057 (Amendment 2 — `relationships[]` joins the contract
> under opt-in gating), ADR-019 (component-edge authoring gains an
> importer path; product edges stay human-only), ADR-013 (LIBRARY
> category gains importer-native producers)

**Context**: Phase 3 of the SBOM programme. Phases 1–2 validated the data
model and curation UX on factual `bom_entries` + human-written
`DEPENDS_ON` edges. The remaining gap: the *dependency graph itself* —
importers like GitHub's dependency-graph API already know which packages
a repository depends on, and forcing humans to re-declare those edges
through the suggestions queue duplicates what the source of truth already
states. The v1 contract removed `relationships[]` entirely (ADR-057)
precisely because this surface was undecided; the decisions are now made.

The tensions: graph writes have been human-only (Principle V, ADR-019);
importer data is authoritative for *facts* but an edge is *meaning*; a
wrong or stale declaration must not damage the catalog permanently; and
per-importer rollout must be opt-in rather than a contract-wide change.

**Decision**:

1. **Component edges only, opt-in per importer config.** Importers may
   yield `relationships[]` on `DiscoveredAsset` only when the importer
   manifest declares `declaredEdgesConfigKey` and that config key is
   `true` for the run. Supported kinds are the three existing
   component-to-component junctions: `DEPENDS_ON`, `SOURCES_FROM`,
   `EXPOSES`. Product edges (`COMPOSES`, `CONSUMES_FROM`, `OWNS`,
   `BELONGS_TO`) are **never** declarable — Principle V's human-curation
   boundary is unchanged.
2. **Targets resolve within the same run only.** Each declaration is
   `(type, targetExternalId)`; the target must be an asset yielded by the
   same run. Unresolvable targets, self-edges, and duplicate declarations
   are dropped silently — never an error, never a suggestion. This keeps
   the declared set self-consistent and prevents edges pointing at
   catalog rows the source did not itself report.
3. **Provenance is stored on the junction row**, not in a generic edge
   table (ADR-048 stands): each of the three junction tables gains
   `provenance` (`CURATED` default, `IMPORTER`), `importerSourceId`, and
   `importRunId` — answering "why does this edge exist?" with a Source
   and a run. `ON CONFLICT DO NOTHING` on insert: an existing row —
   curated or importer — keeps its first writer's provenance
   (single-writer model; a known, documented limitation).
4. **Source-scoped diff retirement on completed runs.** A completed run
   from an opted-in config replaces its Source's importer-declared set:
   `IMPORTER`-provenance rows absent from the new declared set are
   deleted; `CURATED` rows and other Sources' rows are untouched —
   mirroring the ADR-119 membership contract and the ADR-131 BOM
   completeness semantics. The comparison set is the run's **resolved**
   desired set: an edge still declared but unresolvable this run (its
   target was not yielded) is removed and re-created on a later run that
   yields the target — the deliverable set is authoritative.
   Authority is signalled by **`relationships` field presence** on a
   yielded asset (mirroring the `bomEntries` completeness doctrine):
   the pass runs only when at least one asset carried the field —
   carriers emit `[]` on declaring positions for an authoritative
   empty graph and omit the field on degraded/non-graph yields, so a
   degraded run writes and retires nothing (spec 077).
   Failed/cancelled/interrupted runs neither write nor retire.
5. **The pass is failure-isolated.** `runImporterEdgePass` runs after
   the BOM matching pass on the completed path, wrapped like the
   suggestion passes — a pass failure logs and never flips a completed
   run back to failed.
6. **`component_edge_suppressions` is a separate, durable pair table.**
   Editor-only `POST /component-edge-suppressions` (`component:edge:remove`)
   records `(edgeKind, fromComponentId, toComponentId)` and deletes the
   junction row. Future runs subtract suppressed pairs before writing —
   hidden edges are never recreated. The table survives junction deletion
   so the veto outlives retirement. `409` when the pair is curated — hide
   is an importer-edge escape hatch, not a backdoor delete for curated
   edges.
7. **Importer-native `LIBRARY` assets are permitted.** An opted-in
   importer may yield `LIBRARY`-category assets (identity = normalized
   version-free purl in `externalId`, `pkg-{type}-{name}` slug family,
   ADR-132 dedupe rules unchanged) so `package → package` dependency
   edges have a same-run target. First carrier: `importer-github`
   (`importDeclaredEdges`, requires `includeDependencyGraph`). Second
   carrier: `importer-sbom-file` (spec 077 — `importDeclaredEdges`, no
   precondition; substitutes `SUBJECT` in both edge endpoint positions
   with the configured component's externalId).
8. **Reads carry provenance; suppression is RBAC'd.** The six
   component-edge lanes of `GET /components/{id}/relationships` return
   `edgeProvenance`/`edgeImporterSourceId`/`edgeImporterConfigId`/
   `edgeImportRunId` as additional columns on the existing bounded
   queries — no extra graph traversal. The Used-by surface joins the
   consumer→library edge so its badge answers the same question.

**Consequences**: Opted-in runs write catalog graph rows — the factual/
meaning line moves to "importers may declare *component* meaning with
provenance and a human veto"; product hierarchy remains human-only.
Suppressions accumulate as small durable rows per hidden pair. Stale
importer edges self-correct on the next completed run; suppressed ones
never reappear.
