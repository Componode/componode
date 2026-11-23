# Implementation Plan: Kubernetes Declared-Edge Carrier

**Branch**: `079-kubernetes-declared-edges` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/079-kubernetes-declared-edges/spec.md` (carrier precedents: spec `076-bom-importer-native` github, spec `077-sbom-declared-edges` sbom-file, spec `078-docker-declared-edges` docker; normative contract: ADR-133)

## Summary

Make `importer-kubernetes` the fourth declared-edge carrier under ADR-133. Its pod-image SBOM pipeline (`collectPodImageBoms` → `fetchImageBom`) already receives `ImageBomResult.edges` since spec 078 — the parsed dependency graph arrives per pod image and is discarded at the collection site today. The increment is entirely inside `packages/importer-kubernetes`: (1) **config + manifest** — `importDeclaredEdges` boolean (default `false`, UX-EDGE-03 review-bypass copy) gated by a schema refinement on `includePodImageSbom` (dependent-toggle, carriers 1/3 shape — the SBOM fetch is the only edge source) plus `declaredEdgesConfigKey` on the manifest; (2) **collection plumbing** — `PodImageBom` gains `edges`, the union across the workload's resolved pod images of each document's graph with target-position `SUBJECT` already resolved to `docker-image:{digestRef}` (the digest context only exists inside the collector); (3) **emission** — under opt-in, a workload asset receiving `bomEntries` carries `relationships` (possibly `[]`) with `from === SUBJECT` resolved to its own externalId; `LIBRARY` assets yield once per unique purl identity per run via the shared `buildLibraryAsset`/`indexBomEntries`/`dependsOnRels` helpers, carrying the run-wide union of `package→package` edges plus `package→SUBJECT` edges resolved to `docker-image:{digestRef}` (which always drop — kubernetes yields no image component; same-run scope); (4) **docs + e2e + ADR note** — the kubernetes guide gains the field (generated table via `docs:importers`), a new `mock-kubernetes` HTTP service serves pod/replicaset fixtures whose image digests point at the existing `mock-docker-engine` OCI registry listener, and a journey verifies an opted-in run materializes edges. No core, backend, frontend, migration, or openapi changes — spec 078's `ImageBomResult.edges` is consumed as-is.

## Technical Context

**Language/Version**: TypeScript 6 across `importer-kubernetes`, Zod 4 schemas

**Primary Dependencies**: existing stack only — `fetchImageBom`/`ImageBomResult.edges` (spec 078, already populated on the referrers path kubernetes uses), `SPDX_EDGE_SUBJECT`, `buildLibraryAsset`/`indexBomEntries`/`dependsOnRels` (core `bom-library`, spec 077), `validateDiscoveredAsset`; no new packages.

**Storage**: N/A — no schema changes; provenance columns and `component_edge_suppressions` exist from migration 038 (spec 076).

**Testing**: Vitest — `importer-kubernetes` (new `declared-edges.test.ts` reusing the `mockApi` fetch-stub pattern from `pod-image-sbom.test.ts`: opt-in emission contract — subject edges on workload carriers, `relationships` presence semantics, LIBRARY yields deduped per run with run-wide edge union, `docker-image:{digest}` target substitution, partial-coverage authority, off-state parity, all through `validateDiscoveredAsset`; config refine). `core`/`importer-docker`/`backend` suites must stay green unchanged (SC-005). Playwright — new `mock-kubernetes` service (plain-HTTP fixture server via `mocks/lib` helpers; pod `image`/RS fixtures point at `mock-docker-engine:5000` OCI listener, driven by its existing `sbom`/`sbom-reduced` scenarios) + journey: opted-in kubernetes config run → workload Relationships shows **Added by importer** edges + LIBRARY components + hide persists + `pw-lib → root` drops (no image carrier); form switch visible under `bomImporterEdges`, hidden when OFF.

**Target Platform**: monorepo — `packages/importer-kubernetes` (config field, refine, manifest key, `k8s-pods.ts` edge plumbing, `importer.ts` emission), `playwright/` (new mock + compose service + control target + journey), `docs/importers/kubernetes.md`, ADR-133 carrier note.

**Performance Goals**: none new — edge collection rides the same `bomByDigest` cache already deduping referrers fetches; emission is O(entries + edges) per workload on already-parsed data; edge pass unchanged.

**Constraints**: importer packages depend only on `core` (ADR-065 — all helpers already live in core); no `sql.raw`/`sql.fragment` (ADR-084 — no DB work anyway); Zod at config boundary (ADR-095 — existing `.refine` for `endpoint|sourceKey` preserved); review-bypass copy must match UX-EDGE-03 verbatim across all four carriers; `validateDiscoveredAsset` exercised in every importer test (constitution VI); flag `bomImporterEdges` hides — never disables — the switch; `docs:importers` regeneration required for the manifest-driven contract table; `kubernetes` declares no secrets — no `testSecrets` `.partial()` constraint applies to its schema.

**Scale/Scope**: 1 config field + 1 refinement + 1 manifest key, ~15 lines of edge plumbing in `k8s-pods.ts`, ~40 lines of emission logic in `importer.ts`, 1 new vitest file, 1 new playwright mock (~80 lines) + compose/control wiring + 1 journey spec, 1 doc page + regenerated table, ADR-133 carrier note. No core/backend/frontend/openapi/migration changes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-org | PASS | No tenancy surface. |
| II. Importer-first | PASS | Extends an importer's yield within the existing contract; importers still only depend on `core` (ADR-065) — every helper consumed already lives there. |
| III. Two-level taxonomy | PASS | `LIBRARY` category + ecosystem providers exist; `CONTAINER_ORCHESTRATION` carriers unchanged; no taxonomy change. |
| IV. Environment-as-instance | PASS | `LIBRARY` assets yield `instances: []`; component-level edges only; workload instance shape unchanged. |
| V. Factual vs. meaning | PASS | Exercises the already-ratified ADR-133 v2 exception (opt-in component edges); no product edges, no new amendment. |
| VI. Test-first | PASS | tasks.md sequences failing importer unit tests before plumbing/emission code, Playwright journey for the changed surface. |
| VII. Observability | PASS | Emission adds no new paths beyond existing `reportPhase`/`yield`; pass-level metrics inherited from spec 076. |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/079-kubernetes-declared-edges/
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
packages/importer-kubernetes/src/
├── config.ts                            # + importDeclaredEdges (default false, UX-EDGE-03 copy)
│                                        # + refine(importDeclaredEdges → includePodImageSbom)
├── manifest.ts                          # + declaredEdgesConfigKey: "importDeclaredEdges"
├── k8s-pods.ts                          # PodImageBom + edges (per-workload union of resolved
│                                        #   documents; to===SUBJECT → docker-image:{digestRef})
└── importer.ts                          # opt-in: SUBJECT→workload externalId, relationships[]
                                        #   presence semantics, LIBRARY drain once per identity/run

packages/importer-kubernetes/test/
└── declared-edges.test.ts               # NEW — opt-in/opt-out/refine/emission contract

playwright/
├── mocks/kubernetes/server.ts           # NEW — pods + replicasets fixtures (plain HTTP);
│                                        #   image digests → mock-docker-engine OCI listener
├── mocks/control/server.ts              # + mock-kubernetes target
├── compose.test.yml                     # + mock-kubernetes service
└── tests/importers/kubernetes-declared-edges.spec.ts  # NEW — journey + form switch

docs/importers/kubernetes.md             # opt-in prose + regenerated GENERATED:contract table
docs/roadmap.md                          # fourth-carrier shipped note at ship time
researches/adrs/ADR-133-*.md             # carrier note: kubernetes is carrier 4 (back-pointer only)
```

**Structure Decision**: the only design choice is where per-image `SUBJECT` resolution happens — inside `collectPodImageBoms` (`k8s-pods.ts`), where each resolved image's `digestRef` is still in scope, not in `importer.ts` where the per-workload union has already erased which document produced which edge. Target-position `SUBJECT` therefore arrives pre-resolved to `docker-image:{digestRef}` on `PodImageBom.edges`; source-position `SUBJECT` stays a sentinel for `importer.ts` to substitute with the workload's externalId at emission. The backend and frontend need zero changes: `declaredEdgesEnabled` computes from `manifest.declaredEdgesConfigKey` + scope value on both run paths, the field-presence authority gate already exists, and the form switch activates generically on flag + manifest key.
