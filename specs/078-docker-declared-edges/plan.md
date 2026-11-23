# Implementation Plan: Docker Importer Declared-Edge Carrier

**Branch**: `078-docker-declared-edges` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/078-docker-declared-edges/spec.md` (carrier precedents: spec `076-bom-importer-native` github, spec `077-sbom-declared-edges` sbom-file; normative contract: ADR-133)

## Summary

Make `importer-docker` the third declared-edge carrier under ADR-133. Docker's image-SBOM pipeline already parses full `BomParseResult`s — the referrers client discards `.edges` inside `parseDoc`, the Syft fallback discards it at the call site — so the increment is: (1) **core surfacing** — `ImageBomResult` gains `edges` and the referrers path (`parseDoc` → `fetchReferrersBom` → `fetchImageBom`) propagates it for CycloneDX *and* SPDX attestations, with `SPDX_EDGE_SUBJECT` sentinels intact for caller substitution; `importer-kubernetes` consumes the same type and ignores the field (zero behavior change); (2) **config + manifest** — `importDeclaredEdges` boolean (default `false`, UX-EDGE-03 review-bypass copy) gated by `.refine` on `includeSbom` (dependent-toggle, clarification-confirmed; the schema splits an unrefined base so `testSecrets`' `.partial()` keeps working, github precedent) plus `declaredEdgesConfigKey` on the manifest; (3) **emission** — under opt-in, every asset receiving `bomEntries` (workload `CONTAINER` assets + `docker-image:{digest}` `PACKAGE_REGISTRY` assets) carries `relationships` (possibly `[]`) with `from===SUBJECT` resolved to its own externalId; `LIBRARY` assets yield once per unique purl identity per run via the shared `buildLibraryAsset`/`indexBomEntries`/`dependsOnRels` helpers, carrying `package→package` edges and `package→SUBJECT` edges resolved to `docker-image:{digest}`; (4) **docs + e2e + ADR note** — docker guide gains the field (generated table via `docs:importers`), the mock engine serves OCI `/v2/` referrers/manifests/blobs on its existing TLS port, and a journey verifies an opted-in run materializes edges. No backend service, migration, endpoint, frontend, or openapi changes.

## Technical Context

**Language/Version**: TypeScript 6 across `core`/`importer-docker`/`importer-kubernetes`, Zod 4 schemas

**Primary Dependencies**: existing stack only — `parseCycloneDxDocument`/`parseSpdxDocument` (already emit `BomParseResult.edges`), `SPDX_EDGE_SUBJECT`, `buildLibraryAsset`/`indexBomEntries`/`dependsOnRels` (core `bom-library`, spec 077), `validateDiscoveredAsset`; no new packages.

**Storage**: N/A — no schema changes; provenance columns and `component_edge_suppressions` exist from migration 038 (spec 076).

**Testing**: Vitest — `core` (`ImageBomResult.edges` on referrers parse paths, CycloneDX + SPDX); `importer-docker` (opt-in emission contract: subject edges on workload + image carriers, `relationships` presence semantics, LIBRARY yields dedup per run, `docker-image:{digest}` target substitution, off-state parity, all through `validateDiscoveredAsset`; config refine); `importer-kubernetes` (existing suite pins unchanged output). Playwright — mock docker-engine serves OCI `/v2/` routes (backend already trusts test CA via `NODE_EXTRA_CA_CERTS`); journey: opted-in docker config run → workload Relationships shows **Added by importer** edges + LIBRARY components + hide persists; form switch visible under `bomImporterEdges`, hidden when OFF.

**Target Platform**: monorepo — `packages/core` (referrers edge surfacing), `packages/importer-docker` (config field, refine, manifest key, emission), `packages/importer-kubernetes` (parity check only — no changes expected), `playwright/` (mock OCI routes + journey), `docs/importers/docker.md`, ADR-133 carrier note.

**Performance Goals**: none new — emission is O(entries + edges) per image on already-parsed, already-cached (`bomByDigest`) data; edge pass unchanged.

**Constraints**: importer packages depend only on `core` (ADR-065 — the referrers client correctly stays in core); no `sql.raw`/`sql.fragment` (ADR-084 — no DB work anyway); Zod at config boundary (ADR-095 — `.strict()` + refine preserved); review-bypass copy must match UX-EDGE-03 verbatim across all three carriers; `validateDiscoveredAsset` exercised in every importer test (constitution VI); flag `bomImporterEdges` hides — never disables — the switch; `docs:importers` regeneration required for the manifest-driven contract table; `testSecrets`' `.partial()` requires an unrefined base schema (github precedent).

**Scale/Scope**: ~10 lines of core surfacing (type field + parseDoc/fetchReferrersBom return shape), 1 config field + 1 refine + 1 manifest key, ~60 lines of emission logic in importer.ts/docker-sbom.ts, 1 doc page + regenerated table, mock `/v2/` routes + 1 journey spec, ADR-133 carrier note. No backend/frontend/openapi/migration changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-org | PASS | No tenancy surface. |
| II. Importer-first | PASS | Extends an importer's yield within the existing contract; importers still only depend on `core` (ADR-065) — surfacing `edges` through the shared `ImageBomResult` is exactly why the referrers client lives in core. |
| III. Two-level taxonomy | PASS | `LIBRARY` category + ecosystem providers exist; `CONTAINER`/`PACKAGE_REGISTRY` carriers unchanged; no taxonomy change. |
| IV. Environment-as-instance | PASS | `LIBRARY` assets yield `instances: []`; component-level edges only. |
| V. Factual vs. meaning | PASS | Exercises the already-ratified ADR-133 v2 exception (opt-in component edges); no product edges, no new amendment. |
| VI. Test-first | PASS | tasks.md sequences failing core/importer unit tests before surfacing/emission code, Playwright journey for the changed surface. |
| VII. Observability | PASS | Emission adds no new paths beyond existing `reportPhase`/`yield`; pass-level metrics inherited from spec 076. |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/078-docker-declared-edges/
├── plan.md                              # This file
├── research.md                          # Phase 0 output — decisions D1–D6
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
└── utils/oci-referrers.ts               # ImageBomResult + edges?: SpdxEdge[];
                                        # parseDoc → BomParseResult; fetchReferrersBom →
                                        # {entries, edges} | null; fetchImageBom propagates

packages/core/test/utils/
└── oci-referrers.test.ts                # + edge-surfacing cases (CDX + SPDX attestations)

packages/importer-docker/src/
├── config.ts                            # + importDeclaredEdges (default false, UX-EDGE-03 copy)
│                                        # + unrefined base + .refine(importDeclaredEdges → includeSbom)
├── manifest.ts                          # + declaredEdgesConfigKey: "importDeclaredEdges"
├── docker-sbom.ts                       # fetchSyftBom keeps .edges; ImageBomResult flows through
└── importer.ts                          # opt-in: SUBJECT→carrier externalId (workloads + image
                                        # assets), relationships[] presence semantics, LIBRARY
                                        # yields once per identity/run, to===SUBJECT → docker-image:{digest}

packages/importer-docker/test/
└── declared-edges.test.ts               # NEW — opt-in/opt-out/refine/emission contract

playwright/
├── mocks/docker-engine/server.ts        # + /v2/{repo}/referrers|manifests|blobs routes + an
│                                        #   SBOM scenario (RepoDigests → mock-docker-engine:2376/…)
└── tests/importers/docker-declared-edges.spec.ts  # NEW — journey + form switch

docs/importers/docker.md                 # opt-in prose + regenerated GENERATED:contract table
docs/roadmap.md                          # third-carrier shipped note at ship time
researches/adrs/ADR-133-*.md             # carrier note: docker is carrier 3 (back-pointer only)
```

**Structure Decision**: the only cross-package design choice is where edge surfacing happens — inside the existing core referrers client (`parseDoc` already parses full `BomParseResult`s and throws `.edges` away), not a new function or a docker-local re-parse. This keeps `importer-kubernetes` on the identical contract and honors ADR-065 (importers share only through core). The backend and frontend need zero changes: `declaredEdgesEnabled` computes from `manifest.declaredEdgesConfigKey` + scope value on both run paths, the field-presence authority gate already exists, and the form switch activates generically on flag + manifest key.
