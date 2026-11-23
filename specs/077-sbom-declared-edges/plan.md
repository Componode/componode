# Implementation Plan: SBOM File Declared-Edge Carrier

**Branch**: `077-sbom-declared-edges` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/077-sbom-declared-edges/spec.md` (carrier-1 precedent: spec `076-bom-importer-native`; normative contract: ADR-133)

## Summary

Make `importer-sbom-file` the second declared-edge carrier under ADR-133 — the smallest possible increment since the contract, edge pass, provenance, suppression, flagged UI, and backend gating all shipped generic in spec 076. Four changes: (1) **config + manifest** — `importDeclaredEdges` boolean (default `false`, UX-EDGE-03 review-bypass copy, no precondition field — the document *is* the graph source) on `sbomFileConfigSchema`, plus `declaredEdgesConfigKey: "importDeclaredEdges"` on the manifest so the server-side gate and flagged form switch activate automatically; (2) **shared LIBRARY-asset shaping hoisted to `core`** — the GitHub carrier's private `purlType`/`generateComponentSlug`/`buildLibraryAsset`/`indexBomEntries` move into `packages/core/src/utils/` (the same place the shared BOM parsers live — ADR-065 means importers cannot share code except through core), with `importer-github` refactored to consume the shared helpers so both carriers emit the identical `LIBRARY` asset contract; (3) **emission** — when opted in, the sbom-file importer substitutes `SPDX_EDGE_SUBJECT` with `resolvedComponent.externalId` in both edge endpoint positions, attaches `DEPENDS_ON` `relationships[]` to the configured-component asset and to each declaring `LIBRARY` asset, and yields one `LIBRARY` asset per unique normalized purl identity so targets resolve in-run; (4) **docs + e2e** — the sbom-file setup guide gains the opt-in field (generated table regenerated via `docs:importers`) plus review-bypass prose, the Playwright CycloneDX fixture gains a `dependencies[]` graph, and a journey patches the seeded sbom-file config opted-in and verifies edges + libraries materialize. No backend service, migration, endpoint, or ADR changes.

## Technical Context

**Language/Version**: TypeScript 6 across `core`/`importer-sbom-file`/`importer-github`, Zod 4 schemas

**Primary Dependencies**: existing stack only — `parseSpdxDocument`/`parseCycloneDxDocument` (already emit `BomParseResult.edges`), `SPDX_EDGE_SUBJECT`, `normalizePurlIdentity`, `mapEcosystemToProvider`, `validateDiscoveredAsset` (all core, shipped in 073–076); no new packages.

**Storage**: N/A — no schema changes; provenance columns and `component_edge_suppressions` exist from migration 038 (spec 076).

**Testing**: Vitest unit (`importer-sbom-file` — opt-in config parse, SPDX + CycloneDX → `relationships[]` emission, `LIBRARY` asset shape, `SUBJECT` both-position substitution, off-state byte-parity, all through `validateDiscoveredAsset`; `core` — hoisted helper units; `importer-github` — existing tests pin behavior through the refactor); Playwright under `playwright/tests/` — opt-in switch on the sbom-file form + a real seeded run materializing importer edges from the mock CycloneDX document.

**Target Platform**: monorepo — `packages/core` (shared LIBRARY-asset helpers), `packages/importer-sbom-file` (config field, manifest key, emission), `packages/importer-github` (consume hoisted helpers — behavior-neutral refactor), `playwright/` (fixture `dependencies[]` + journey), `docs/` (importer guide).

**Performance Goals**: none new — emission is O(entries + edges) on already-parsed data; edge pass unchanged (per-run bounded by yielded assets).

**Constraints**: importer packages depend only on `core` (ADR-065); no `sql.raw`/`sql.fragment` (ADR-084 — no DB work anyway); Zod at config boundary (ADR-095); review-bypass copy must match UX-EDGE-03 verbatim across both carriers; `validateDiscoveredAsset` exercised in every importer test (constitution VI); flag `bomImporterEdges` hides — never disables — the switch (docs/ux.md §7); `docs:importers` regeneration required for the manifest-driven contract table.

**Scale/Scope**: 1 config field + 1 manifest key, ~60 lines of helpers hoisted github→core, ~80 lines of emission logic in sbom-file, 1 doc page + regenerated table, 1 Playwright fixture delta + journey additions. No backend/frontend/openapi/migration/ADR changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-org | PASS | No tenancy surface. |
| II. Importer-first | PASS | Extends an importer's yield within the existing contract; importers still only depend on `core` (ADR-065) — the helper hoist is why this stays true for a second carrier. |
| III. Two-level taxonomy | PASS | `LIBRARY` category + ecosystem providers exist; no taxonomy change. |
| IV. Environment-as-instance | PASS | `LIBRARY` assets yield `instances: []` like carrier 1; component-level edges only. |
| V. Factual vs. meaning | PASS | Exercises the already-ratified ADR-133 v2 exception (opt-in component edges); no product edges, no new amendment. |
| VI. Test-first | PASS | tasks.md sequences failing importer/core unit tests before emission code, Playwright journeys for the changed surface. |
| VII. Observability | PASS | Emission adds no new paths beyond existing `reportPhase`/`yield`; pass-level metrics inherited from spec 076. |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/077-sbom-declared-edges/
├── plan.md                              # This file
├── research.md                          # Phase 0 output — decisions D1–D5
├── data-model.md                        # Phase 1 output — emitted shapes + edge projection rules
├── contracts/
│   └── carrier-emission.md              # Phase 1 output — emitted DiscoveredAsset contract
├── quickstart.md                        # Phase 1 output — end-to-end validation
├── checklists/
│   └── requirements.md                  # Spec quality checklist (all passing)
└── tasks.md                             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/core/src/
├── utils/bom-library.ts                 # NEW: purlType, generateComponentSlug (hoisted),
│                                        #      buildLibraryAsset, indexBomEntries (hoisted)
└── index.ts                             # export the helpers for importer consumption

packages/importer-github/src/
└── importer.ts                          # refactor: consume hoisted helpers (behavior-neutral)

packages/importer-sbom-file/src/
├── config.ts                            # + importDeclaredEdges (default false, UX-EDGE-03 copy)
├── manifest.ts                          # + declaredEdgesConfigKey: "importDeclaredEdges"
└── importer.ts                          # opt-in: SUBJECT→resolved.externalId substitution,
                                       # relationships[] on component + LIBRARY assets,
                                       # yield LIBRARY assets per purl identity

packages/importer-sbom-file/test/
├── spdx.test.ts                         # + opt-in emission cases (validateDiscoveredAsset)
└── cyclonedx.test.ts                    # + opt-in emission cases (validateDiscoveredAsset)

playwright/
├── mocks/github/server.ts               # /sbom/cyclonedx.json gains bom-refs + dependencies[]
└── tests/journeys/bom-importer-edges.spec.ts  # + sbom-file carrier journey (or sibling spec)

docs/importers/sbom-file.md              # opt-in prose + regenerated GENERATED:contract table
docs/roadmap.md                          # second-carrier shipped note at ship time
researches/adrs/ADR-133-*.md             # carrier note: sbom-file is carrier 2 (back-pointer only)
```

**Structure Decision**: the only cross-package design choice is where LIBRARY-asset shaping lives. Hoisting to `core` (research D3) follows the codebase's own precedent — `spdx.ts`'s header comment already names `importer-sbom-file` as a parser consumer — and prevents drift on the shared emitted contract. The backend and frontend need zero changes: `declaredEdgesEnabled` is computed from `manifest.declaredEdgesConfigKey` + scope value on both run paths, and the form switch is hidden/shown generically by flag + manifest key.
