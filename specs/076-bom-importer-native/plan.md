# Implementation Plan: BOM Importer-Native Declared Edges (Phase 3)

**Branch**: `076-bom-importer-native` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/076-bom-importer-native/spec.md` (research basis: `researches/sbom_research.md` — § Phase 3, § UX-EDGE, § Vocabulary are normative; Phases 1/1b/2 shipped in specs 073/074/075; clarify session 2026-11-23 confirmed carrier = `importer-github` capability, retirement = source-scoped diff)

## Summary

Phase 3 lifts the v1 prohibition on importer-declared edges (ADR-057 / Constitution Principle V → new **ADR-133**). Five mechanisms land together: (1) the **v2 contract** — `DiscoveredAsset.relationships?: { type: DEPENDS_ON|SOURCES_FROM|EXPOSES, targetExternalId }[]` added in `core`, validated by `validateDiscoveredAsset`, serialized across hub and agent run paths unchanged; (2) **edge provenance + suppression schema** — migration `038` adds `provenance`/`importerSourceId`/`importRunId` columns to all three component-edge junctions (existing rows backfill `CURATED`) and creates `component_edge_suppressions` keyed on `(edgeKind, fromComponentId, toComponentId)`; (3) an **importer-edge pass** — declared edges collected during asset processing, resolved against the run's own externalIds at `COMPLETED`, written `ON CONFLICT DO NOTHING` with `IMPORTER` provenance (suppressed pairs skipped, curated pairs preserved), then **source-scoped diff-retired**; runs only when the config's declared-edge opt-in is on (server-side, manifest-declared config key); (4) **carrier capability** — `importer-github` gains `importDeclaredEdges` (default OFF, UX-EDGE-03 copy) and, when on, yields `LIBRARY` assets (externalId = normalized version-free purl via `normalizePurlIdentity`, dedup-merged into Phase-2 libraries) plus `relationships[]` derived from the same dependency-graph SPDX document; and (5) **UX-EDGE surfaces** — provenance badge (**Curated** / **Added by importer** with one-click Source+run link) on every edge row in Relationships and Library *Used by*, **Hide edge** (Editor) writing a suppression + deleting the junction row via `POST /component-edge-suppressions`, the opt-in switch in the schema-driven importer form, flag `bomImporterEdges` shipping ON with gap registry **G39**.

## Technical Context

**Language/Version**: TypeScript 6 across `core`/`backend`/`frontend`/`importer-github`, Zod 4 schemas, Kysely migrations (next free: `038`)

**Primary Dependencies**: existing stack only — `normalizePurlIdentity` + `mapEcosystemToProvider` + `parseSpdxDocument` (core, shipped in 073/074/075) are the identity and parse primitives; no new packages.

**Storage**: PostgreSQL — migration `038` alters `component_depends_on_component`, `component_sources_from`, `component_exposes` (+ `provenance` CHECK `CURATED|IMPORTER` default `CURATED`, `importerSourceId` uuid NULL → `importer_sources` SET NULL, `importRunId` uuid NULL → `import_runs` SET NULL) and creates `component_edge_suppressions` (uuid PK, `edgeKind` CHECK, `fromComponentId`/`toComponentId` FK→components CASCADE, `suppressedBy` FK→persons SET NULL, `createdAt`, UNIQUE `(edgeKind, fromComponentId, toComponentId)`).

**Testing**: Vitest unit + integration (`core` contract/Zod for `relationships[]`; `backend` services — edge pass resolution/scope/suppression/diff-retire/opt-in gating on both run paths, hide route, provenance in relationships read, migration; `importer-github` — config field, SPDX→relationships mapping, LIBRARY asset shape + `validateDiscoveredAsset`); backend route tests + ADR-104 openapi contract test; Playwright under `playwright/tests/` for the UX-EDGE journeys (opt-in form, provenance badge + link, hide-persists-across-reruns) with seed fixtures.

**Target Platform**: monorepo — `packages/core` (contract + validation + SPDX edge output + enums), `packages/backend` (migration 038, importer-edge pass, hide route, relationships read extension, openapi), `packages/importer-github` (config field, SPDX edge mapping, LIBRARY assets), `packages/frontend` (badges, hide action, opt-in switch, flag).

**Performance Goals**: edge pass per-run bounded by yielded-asset count; same-run resolution via one in-memory externalId→componentId map built during processing (no per-edge lookups); suppression check batched; relationships read stays bounded — provenance is extra columns on already-selected junction rows (ADR-128 bounded read preserved).

**Constraints**: GETs side-effect-free (ADR-094); session-gated, `component:edge:remove` = `EDITOR` for hide (ADR-097, `product:edge:remove` precedent); Zod `.strict()` (ADR-095); `{code,message,details?}` envelope (ADR-071); Kysely parameterized only (ADR-084); `writeEdgeChange` audit on every edge write/remove via `runActor` (importer passes) and session actor (hide); openapi.yaml + contract test in the same change (ADR-104); hidden-not-disabled flag governance (docs/ux.md §7); importer packages depend only on `core` (ADR-065); `pnpm audit` clean.

**Scale/Scope**: 1 migration altering 3 junctions + 1 new table, ~2 new/changed endpoints, 1 new backend service/pass wired into both run paths, 1 importer capability, ~4 frontend surfaces, ADR-133 + ADR-057/constitution back-pointers + gap G39 + importer guide + roadmap deltas, unit + integration + route + Playwright coverage. Product edges (`COMPOSES`/`CONSUMES_FROM`), un-hide UI, and other carriers are out of scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-org | PASS | Workspace-wide surfaces; no tenancy. |
| II. Importer-first | PASS | This feature *is* the importer contract v2 — importers gain a declaration capability; all curation semantics (opt-in, provenance, suppression) live core-side. |
| III. Two-level taxonomy | PASS | `LIBRARY` category + ecosystem providers already exist; yielded library assets reuse them unchanged. |
| IV. Environment-as-instance | PASS | Edges are component-level; no instance semantics touched. |
| V. Factual vs. meaning | AMENDMENT | `relationships[]` is exactly the declaration v1 prohibited — **ADR-133** formally lifts it with guardrails (opt-in, same-run scope, provenance, suppression, human-edge preservation). ADR-057 + the Principle V note get back-pointers in the same change. |
| VI. Test-first | PASS | tasks.md sequences failing tests first per surface: contract validation, migration, edge pass (resolution/scope/suppression/retire/opt-in), hide route, provenance read, importer mapping, frontend units, Playwright journeys. |
| VII. Observability | PASS | Pass emits the `runSuggestionPass`-family log/metric pattern (resolved/dropped/suppressed/created/removed counters); all writes audited via `writeEdgeChange`. |

No unjustified violations → Complexity Tracking not required. Principle V is satisfied through the ADR amendment mechanism the constitution itself prescribes.

## Project Structure

### Documentation (this feature)

```text
specs/076-bom-importer-native/
├── plan.md                              # This file
├── research.md                          # Phase 0 output — decisions D1–D10
├── data-model.md                        # Phase 1 output — schema + pass algorithm + direction mapping
├── contracts/
│   └── importer-edges-api.md            # relationships read extension + POST /component-edge-suppressions + contract shape
├── quickstart.md                        # Phase 1 output — end-to-end validation scenarios
├── checklists/
│   └── requirements.md                  # Spec quality checklist
└── tasks.md                             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/core/src/
├── contracts/discovered-asset.ts        # + DiscoveredAssetRelationship, relationships?
├── contracts/component-relationships.ts # + edge provenance fields on RelatedComponent
├── constants/importer-edge.ts           # NEW: DISCOVERED_RELATIONSHIP_TYPES, EdgeProvenance, EdgeKind
├── validation/discovered-asset.ts       # + relationships[] item schema
├── utils/spdx.ts                        # BomParseResult + dependency edges (SPDXID→purl-identity keyed)
└── index.ts                             # exports

packages/importer-github/src/
├── config.ts                            # + importDeclaredEdges (default false, UX-EDGE-03 copy)
├── github-dependency-graph.ts           # + dependency edges from SPDX doc; returns edges with entries
└── importer.ts                          # opt-in: yield LIBRARY assets (purl-identity externalId) + relationships[]

packages/backend/src/
├── db/migrations/038_bom_edge_provenance.ts  # junction provenance cols + component_edge_suppressions
├── db/types.ts                          # new cols + suppression table rows
├── services/importer-edge-service.ts    # NEW: collect + runImporterEdgePass (resolve, suppress, write, diff-retire)
├── services/import-run-service.ts       # collect declared edges during processAsset; invoke pass on COMPLETED
├── services/remote-run-service.ts       # same hooks on the agent path (parity required)
├── services/component-relationship-service.ts # + provenance cols on the 3 junction families
├── services/importer-edge-suppression-service.ts # NEW: hide (suppression + junction delete)
├── plugins/rbac.ts                      # + "component:edge:remove": "EDITOR"
└── routes/components.ts                 # + POST /component-edge-suppressions (or small new route module)

packages/frontend/src/
├── api/                                 # relationships provenance types + suppression client
├── ux/components/catalog/
│   ├── component-relationships.tsx      # provenance badge + Source/run link + Hide edge menu item
│   └── package-consumers.tsx            # provenance badge on Used-by rows
├── ux/components/importers/importer-form.tsx # opt-in switch renders review-bypass helper copy
└── ux/lib/flags.ts                      # + bomImporterEdges (G39)

researches/adrs/ADR-133-v2-importer-relationship-contract.md  # NEW
researches/adrs/ADR-057-*.md             # Amendment note — back-pointer to ADR-133
.specify/memory/constitution.md          # Principle V clarification back-pointer
researches/architecture-decisions.md     # register ADR-133
researches/ux-rewrite-gaps.md            # register G39 (RESOLVED by spec 076)
docs/openapi.yaml                        # new/changed endpoints + response fields (ADR-104)
docs/importers/github.md                 # opt-in switch + review-bypass semantics
docs/roadmap.md                          # Phase 3 shipped entry
```

**Structure Decision**: the edge pass follows the `bom-match-service` decomposition — a dedicated service invoked from both run services after `runBomMatchPass`, failure-isolated so an edge bug never flips a completed run. Provenance lives on the junction rows (no separate edges table per ADR-048); suppression is its own keyed table so it survives edge deletion.
