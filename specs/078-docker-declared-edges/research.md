# Research: Docker Importer Declared-Edge Carrier

Phase 0 output for spec `078-docker-declared-edges`. The contract is ratified (ADR-133); this file records only carrier-3 mechanics — every inherited decision is normative from specs 076/077 and is not re-litigated here.

## D1 — Edge surfacing point: extend `ImageBomResult`, not a new API

**Decision**: `ImageBomResult` gains an optional `edges?: SpdxEdge[]` field; the referrers chain propagates the already-parsed `BomParseResult.edges` (`parseDoc` returns the full `BomParseResult`, `fetchReferrersBom` returns `{ entries, edges } | null` — or the parse result — `fetchImageBom` copies it onto the result on the OK path). The Syft fallback in `docker-sbom.ts` keeps the full parse result and wraps `{ entries, edges }` in the same `ImageBomResult` shape.

**Rationale**: `parseCycloneDxDocument`/`parseSpdxDocument` already produce `.edges` at zero extra cost inside `parseDoc` — it is destructured away today. Surfacing it on the existing result type is the minimal additive change; no second fetch, no second parse, no signature churn for callers that ignore it.

**Alternatives considered**: (a) a separate `fetchImageBomEdges` — rejected, would double the registry round-trips or force callers to parse twice; (b) returning `BomParseResult` verbatim — rejected, `ImageBomResult`'s `marker` shape is the established contract and `skipped` is already absorbed into entry-level reporting.

## D2 — `SUBJECT` binding: every SBOM-bearing asset is a carrier

**Decision** (clarification-confirmed 2026-11-23): source-side `SUBJECT` expands to every asset the document's `bomEntries` attach to in this run — each workload `CONTAINER` component running the image, and the `docker-image:{digest}` `PACKAGE_REGISTRY` asset when `includeImages` is on. Each such carrier emits `relationships[]` resolving `from === SUBJECT` to its own externalId. Target-side `SUBJECT` (`package → subject`, rare) resolves to the canonical image identity `docker-image:{digest}` — materializing only when the image asset is in the same run (`includeImages` on + the digest ref is emitted), else dropping silently per same-run scope (ADR-133 §2).

**Rationale**: `includeImages` defaults OFF — the workload is the only SBOM carrier in the default config, and the catalog's primary object users compose into products. Edges on every carrier are faithful: each asset bears the image's content. Target-side `SUBJECT` means "the image artifact itself" — the `PACKAGE_REGISTRY` component is its canonical face; expanding it onto every workload would multiply a rare edge onto unrelated workloads.

**Alternatives considered**: (a) image asset only — rejected, zero subject edges in the default config (feature is dead for most users); (b) workloads only — rejected, inconsistent: the image asset bears the same bomEntries and is the more literal document subject; (c) `to === SUBJECT` expanding to all carriers — rejected, same multiplication concern for an edge type that occurs in ~0 documents.

## D3 — Config gating: `importDeclaredEdges → includeSbom` refine + unrefined base

**Decision** (clarification-confirmed 2026-11-23): `dockerConfigSchema` splits into `dockerConfigBase` (unrefined, for `testSecrets`' `.partial()`) and the exported refined schema `.refine(c => !c.importDeclaredEdges || c.includeSbom, { path: ["importDeclaredEdges"] })` — the exact github carrier pattern (`importDeclaredEdges → includeDependencyGraph`).

**Rationale**: the SBOM fetch is the only edge source; `importDeclaredEdges: true` with `includeSbom: false` is dead config that silently emits nothing. "No precondition" in the request means no *new* precondition field — the parse always yields the graph at no extra fetch cost, which is what made carrier-2-style unconditional opt-in plausible on sbom-file (whose whole job is the document). Zod refinement breaks `.partial()` in Zod 4, hence the exported base — identical to `githubConfigBase`/`githubConfigSchema`.

**Alternatives considered**: (a) unconditional switch — rejected by clarification (dead-config footgun); (b) refine without the base split — rejected, `testSecrets` would fail on Zod 4 `.partial()` unavailability on refined schemas.

## D4 — `bomForRef` must expose the digest ref

**Decision**: the per-image SBOM cache helper's lookup result carries `digestRef` alongside the `ImageBomResult` (restructure to `{ bom, digestRef } | { bom: markerOnly, digestRef: null }`), so `to === SUBJECT → docker-image:{digestRef}` substitution and the image-asset externalId are computable wherever a bom was resolved.

**Rationale**: the workload path resolves the digest inside `bomForRef` (`getImage(imageRef).inspect().RepoDigests`) and currently discards it; both substitution targets — `docker-image:{digestRef}` for `package → SUBJECT` edges and the carrier's own externalId on the image path — derive from it.

**Alternatives considered**: recomputing `docker-image:{digest}` at emission time — rejected, the digest is resolved once and cached per run; recomputing duplicates inspect calls and can disagree with the cached key.

## D5 — LIBRARY emission: once per identity per run, inline at each carrier point

**Decision**: maintain a run-level `yieldedLibraries: Set<string>`; whenever an opted-in `bom.entries` attaches to a carrier, iterate `indexBomEntries(bom.entries)` and yield `buildLibraryAsset(identity, entry, rels)` for each not-yet-yielded identity. `rels` = `dependsOnRels(edges', identity)` where `edges'` substitutes `to === SPDX_EDGE_SUBJECT → docker-image:{digestRef}` (`from === SUBJECT` can never match a library identity — identities are normalized purls). Emission happens inline in both carrier loops (workload + image) — no end-of-run collection pass.

**Rationale**: `bomByDigest` already dedups fetches; a `Set` dedups yields across digests sharing a package. Inline emission keeps each bom's edge context (`digestRef`) local — no secondary map of digest→carriers. First-digest-wins on a shared purl identity is the documented tie-break (an edge case; `to === SUBJECT` targets would name the first-seen digest's image).

**Alternatives considered**: (a) collect-then-emit at run end — rejected, needs a digest→carrier map solely for the rare `to === SUBJECT` case and separates yield from its context for no contract gain; (b) yield libraries per carrier without a dedup set — rejected, duplicate externalIds inside one run would double-declare (harmless but noisy `duplicates` counts in the edge-pass report).

## D6 — e2e: mock OCI registry routes on the existing TLS mock

**Decision**: extend `playwright/mocks/docker-engine/server.ts` with `/v2/{repo}/referrers/{digest}` → OCI index, `/v2/{repo}/manifests/{digest}` → manifest with a blob layer, `/v2/{repo}/blobs/{digest}` → a CycloneDX document carrying `dependencies[]` — served on the same TLS port the engine mock already uses (or gated behind a `__control` scenario so existing specs are untouched). A scenario/scoped image `RepoDigests` entry points at `mock-docker-engine:2376/<repo>@sha256:<64-hex>` so `parseRepoDigest` resolves `registry = mock-docker-engine:2376`; the backend fetches `https://mock-docker-engine:2376/v2/…` and trusts it via the already-configured `NODE_EXTRA_CA_CERTS=/pw-private/ca.crt`. The journey patches/creates a docker config with `includeSbom: true, importDeclaredEdges: true`, triggers a run, and asserts importer-added `DEPENDS_ON` edges + `LIBRARY` components + hide-durable behavior; a second test covers the form switch's flag gating.

**Rationale**: the mock already terminates mTLS with the test CA the backend trusts — the only missing piece is the OCI route surface; no new services, no env plumbing, and it exercises the primary (referrers) collection path rather than the fallback.

**Alternatives considered**: (a) `COMPONODE_SYFT_PATH` stub binary — viable but requires the backend image to carry a stub executable and only exercises the fallback path; kept as fallback if mock TLS proves brittle; (b) skipping the run journey (form-only coverage) — rejected, spec FR-011 requires the opted-in run surface where infrastructure permits, and it does.
