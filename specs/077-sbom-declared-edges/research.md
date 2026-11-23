# Research: SBOM File Declared-Edge Carrier

Phase 0 output for `077-sbom-declared-edges`. No NEEDS CLARIFICATION items
remained after spec + clarify; this file records the implementation
decisions the plan depends on, each verified against the shipped spec-076
machinery.

## D1 — Emission shape: subject→component + library→library, `DEPENDS_ON` only

**Decision**: when `importDeclaredEdges` is true and the document parses,
emit (a) `relationships[]` on the configured-component asset for every
`BomParseResult.edges` entry whose `from` is `SPDX_EDGE_SUBJECT`, with
`targetExternalId = edge.to`; (b) one `LIBRARY` `DiscoveredAsset` per
unique normalized purl identity across `result.entries` (flattened via
`indexBomEntries`), each carrying `relationships[]` for edges where
`e.from === identity` — substituting `resolvedComponent.externalId` for a
`to === SPDX_EDGE_SUBJECT` target; (c) `type: "DEPENDS_ON"` for every
emitted entry — the BOM parsers project dependency semantics only.

**Rationale**: identical to carrier 1's emission pattern
(`importer-github` lines 549–563) — SUBJECT-endpoint edges attach to the
run's "owning" asset; library↔library edges attach to each declaring
LIBRARY asset. Yielding every indexed entry as a LIBRARY asset (not only
edge sources) is what makes `to` targets resolvable within the same run —
ADR-133 §2 resolves `targetExternalId` strictly against same-run assets.

**Alternatives considered**: emitting edges only (no LIBRARY assets)
rejected — targets would resolve to nothing and every edge would drop
silently, producing a plausible-looking but empty graph. Emitting
`SOURCES_FROM` rejected — parsers only project dependency edges.

## D2 — `SUBJECT` substitution in both endpoint positions

**Decision**: substitute `resolvedComponent.externalId` wherever
`SPDX_EDGE_SUBJECT` appears — as `from` (D1a) and as `to` (a library
asset's `targetExternalId`).

**Rationale**: the sentinel's contract is literally "the caller
substitutes its own externalId when attaching `relationships[]`"
(`core/utils/spdx.ts` docstring). sbom-file *knows* the subject identity
at config resolution — unlike GitHub, where the subject repo asset's
externalId is also known but carrier 1 chose to filter `from === SUBJECT`
only, letting `to === SUBJECT` literals drop silently at resolution.
Substituting both positions is strictly more complete: an SPDX
`X DEPENDS_ON <subject>` edge materializes instead of dropping. This is a
carrier-level choice, not a contract change — the edge pass sees only
resolved externalIds either way.

**Alternatives considered**: mirroring carrier 1 (from-only) rejected —
it would silently lose real declarations for zero benefit. Retrofitting
carrier 1 deferred — out of this spec's scope.

## D3 — Hoist LIBRARY-asset shaping into `packages/core`

**Decision**: move `purlType`, `generateComponentSlug`,
`buildLibraryAsset`, and `indexBomEntries` from
`packages/importer-github/src/importer.ts` into a new
`packages/core/src/utils/bom-library.ts`, exported via `core/index.ts`;
refactor `importer-github` to consume them.

**Rationale**: ADR-065 forbids importer→importer imports, so sharing is
only possible through `core`. `core` already hosts every shared
importer-side BOM primitive for exactly this reason — the `spdx.ts`
header comment names `importer-sbom-file` as an intended consumer. The
emitted `LIBRARY` asset contract (`externalId` = normalized version-free
purl, `provider` = `mapEcosystemToProvider`, `resourceType` = purl type,
slug `pkg-{type}-{name}`, `details.purl`/`details.version`, `instances: []`)
is fixed by FR-003 and must not drift between carriers. The refactor is
behavior-neutral: the functions move verbatim; github's unit tests pin
the shape.

**Alternatives considered**: duplicating ~60 lines into sbom-file
rejected — two copies of a shared emitted contract drift on the next
carrier or slug fix, and this spec exists precisely because a second
carrier arrived.

## D4 — No precondition refinement on `importDeclaredEdges`

**Decision**: `sbomFileConfigSchema` gains a plain
`importDeclaredEdges: z.boolean().default(false)` with the UX-EDGE-03
`.describe()` copy; no `.refine()` coupling it to another field, unlike
github's `!importDeclaredEdges || includeDependencyGraph` rule.

**Rationale**: github's refinement exists because the dependency graph
costs a separate API call — `includeDependencyGraph` decides whether the
SPDX document is fetched at all. For sbom-file the document *is* the
whole point of the run; parsing always produces `edges` (possibly `[]`)
at zero marginal cost. There is nothing the opt-in could depend on.

**Alternatives considered**: gating emission on a hypothetical
"include graph" toggle rejected — a second toggle for data already
parsed adds config complexity with no resource saving.

## D5 — E2E via existing seeded sbom-file config + fixture `dependencies[]`

**Decision**: extend the Playwright mock's static `/sbom/cyclonedx.json`
fixture with `bom-ref`s on every component plus a `dependencies[]` graph
(subject root → top-level packages; express → accepts), then patch the
seeded `sbom-file` config to `importDeclaredEdges: true` in a journey
that asserts importer-added edges + LIBRARY components, reusing the
`triggerAndWait`/`findComponent` helpers from `bom-importer-edges.spec.ts`.

**Rationale**: the seeded config (`playwright/data/seed-app-flows.ts`,
`sbomConfigId`) already targets a catalog component (`bomSlug`) and the
mock already serves the document — only the fixture lacks a graph. The
CycloneDX parser resolves the subject as `metadata.component.bom-ref`
when present, else the single root dependency entry — the fixture's
`metadata.component` has no `bom-ref`, so `dependencies[]` must have
exactly one root (a ref nothing depends on) for subject substitution to
engage deterministically.

**Alternatives considered**: a second static SPDX fixture rejected —
unit tests already cover format parity; e2e needs one real carrier path,
not two. Seeding a second sbom-file config rejected — patching the
existing one is less seed surface.
