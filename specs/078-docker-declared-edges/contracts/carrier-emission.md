# Contract: carrier emission — `importer-docker` under `importDeclaredEdges`

Emitted `DiscoveredAsset` contract for spec `078-docker-declared-edges`. Invariants are stated as test-assertable rules; the emission is verbatim — unresolved targets rely on the edge pass's same-run silent-drop rule (spec edge case), not on importer-side resolution.

## Invariants

1. **Presence doctrine**: under opt-in, a carrier asset carries `relationships` — `[]` is the authoritative-empty marker — iff it received `bomEntries`. A bomless yield (no digest, no attestation, registry error, missing Syft) omits `relationships` entirely, marking the run non-authoritative for that carrier so prior edges are never retired by it (ADR-057 A1 doctrine applied to edges, spec 077 T021). The image path additionally requires the digest-form ref (`parseRepoDigest`) — identical to today's `bomEntries` gate.
2. **Subject substitution**: `from === SPDX_EDGE_SUBJECT` → the carrier asset's own externalId (`workload:`/`compose:`/`{source}::{name}` for workloads; `docker-image:{ref}` for image assets). `to === SPDX_EDGE_SUBJECT` → `docker-image:{digestRef}` — the canonical image identity — on every emission site.
3. **LIBRARY yield dedup**: at most one `LIBRARY` asset per normalized purl identity per run, emitted at the first opted-in bom that contains it; `relationships` present only when non-empty.
4. **`DEPENDS_ON` only**: no `SOURCES_FROM`/`EXPOSES` emissions.
5. **Opt-out parity**: `importDeclaredEdges` off (or `includeSbom` off) produces output identical in shape to the pre-feature yield — no `relationships`, no `LIBRARY` assets.
6. **Every asset validates**: `validateDiscoveredAsset` before yield (also enforced in tests, FR-009).

## Emission table

| Where | Condition | `relationships` | Extra yields |
|---|---|---|---|
| Workload asset | `includeSbom && imageRef && bom.entries && importDeclaredEdges` | `dependsOnRels(edges', workloadExternalId)` — `[]` allowed | unseen `LIBRARY` assets from `indexBomEntries` |
| Image asset | `includeImages && includeSbom && digest-form ref && bom.entries && importDeclaredEdges` | `dependsOnRels(edges', dockerImageExternalId)` — `[]` allowed | same |
| Any carrier | `bom.entries` absent or opt-in off | field omitted | none |

`edges'` = `bom.edges` with substitutions: `from === SUBJECT → <that carrier's externalId>`; `to === SUBJECT → docker-image:{digestRef}`.

## Field shape (assert in unit tests)

```ts
// carrier asset (workload or image)
{
  bomEntries: DiscoveredBomEntry[],        // as today
  relationships: { type: "DEPENDS_ON", targetExternalId: string }[],
  details: { capabilities: { bomInventory: BomCapabilityMarker }, ... },
}

// LIBRARY asset
{
  category: "LIBRARY",
  provider: string,                        // mapEcosystemToProvider
  resourceType: string,                    // purl type segment
  name: string,
  externalId: string,                      // normalized version-free purl identity
  slug: `pkg-${string}-${string}`,
  instances: [],
  details: { purl: string, version?: string },
  relationships?: { type: "DEPENDS_ON", targetExternalId: string }[],  // omitted when empty
}
```
