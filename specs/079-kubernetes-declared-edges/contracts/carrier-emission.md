# Contract: carrier emission — `importer-kubernetes` under `importDeclaredEdges`

Emitted `DiscoveredAsset` contract for spec `079-kubernetes-declared-edges`. Invariants are stated as test-assertable rules; the emission is verbatim — unresolved targets rely on the edge pass's same-run silent-drop rule (spec edge case), not on importer-side resolution.

## Invariants

1. **Presence doctrine**: under opt-in, a workload asset carries `relationships` — `[]` is the authoritative-empty marker — iff it received `bomEntries`. A marker-only yield (no pods, undigestable refs, registry failure, `sourceKey` mode without `endpoint`, pod listing 4xx) omits `relationships` entirely, marking the run non-authoritative for that carrier so prior edges are never retired by it (ADR-057 A1 doctrine applied to edges, spec 077 T021, spec 078).
2. **Subject substitution**: `from === SPDX_EDGE_SUBJECT` → the workload asset's own externalId (every carried document substitutes the same carrier). `to === SPDX_EDGE_SUBJECT` → `docker-image:{digestRef}` of the pod image whose document declared it — resolved inside `collectPodImageBoms` where the digest context exists; always absent from a kubernetes run → drops at the pass.
3. **LIBRARY yield dedup**: at most one `LIBRARY` asset per normalized purl identity per run, drained after the workload loop carrying the run-wide union of `package → package` (+ `→ docker-image:{digest}`) edges; `relationships` present only when non-empty.
4. **`DEPENDS_ON` only**: no `SOURCES_FROM`/`EXPOSES` emissions.
5. **Opt-out parity**: `importDeclaredEdges` off (or `includePodImageSbom` off) produces output identical in shape to the pre-feature yield — no `relationships`, no `LIBRARY` assets.
6. **Every asset validates**: `validateDiscoveredAsset` before yield (also enforced in tests, FR-009).

## Emission table

| Where | Condition | `relationships` | Extra yields |
|---|---|---|---|
| Workload asset | `includePodImageSbom && endpoint && bom.entries && importDeclaredEdges` | `dependsOnRels(edges', workloadExternalId)` — `[]` allowed | feeds run-level `LIBRARY` drain |
| `LIBRARY` asset | opt-in && ≥1 bom resolved run-wide | `dependsOnRels(allEdges, purlIdentity)` — omitted when empty | — |
| Any carrier | `bom.entries` absent or opt-in off | field omitted | none |

`edges'` = the workload's `PodImageBom.edges` with `from === SUBJECT → <workload externalId>` (target-side `SUBJECT` is already `docker-image:{digestRef}` from collection).
`allEdges` = the run-level union of every resolved workload's `edges`.

## Field shape (assert in unit tests)

```ts
// carrier asset (workload)
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
