# Data Model: SBOM File Declared-Edge Carrier

**No new persisted entities.** Provenance columns (`provenance`,
`importerSourceId`, `importRunId`), `component_edge_suppressions`, and the
three component-edge junctions all exist from spec 076 / migration 038.
This document fixes the **emitted** shapes the carrier produces.

## Emitted `DiscoveredAsset` shapes

### Configured-component asset (unchanged identity, gains `relationships[]`)

The single asset sbom-file always yields — identity comes from
`resolvedComponent` injected at dispatch:

| Field | Value |
|---|---|
| `category`, `provider`, `externalId`, `name`, `slug` | `resolvedComponent.*` (unchanged) |
| `resourceType` | `"sbom:document"` (unchanged) |
| `instances` | `[]` (unchanged) |
| `bomEntries` | `result.entries` — present including `[]` (unchanged presence semantics, ADR-131) |
| `details` | `capabilities.bomInventory` marker + `bomDocument` (unchanged) |
| `relationships` | **opt-in only** — `{ type: "DEPENDS_ON", targetExternalId }` for each edge with `from === SPDX_EDGE_SUBJECT`; `targetExternalId` = `edge.to` (a purl identity, or `resolvedComponent.externalId` substituted for a `to === SPDX_EDGE_SUBJECT` endpoint). Absent when the set is empty — matches carrier 1's omit-if-empty convention |

### `LIBRARY` asset (new yield for this importer, shared shape via core helper)

One per unique normalized version-free purl identity across the flattened
`result.entries` (including `children[]`):

| Field | Value |
|---|---|
| `category` | `"LIBRARY"` |
| `provider` | `mapEcosystemToProvider(purlType(entry.purl), entry.purl)` |
| `resourceType` | purl type segment (`npm`, `golang`, `maven`, …) |
| `externalId` | `normalizePurlIdentity(entry.purl)` — version-free; dedup-merges with curated + GitHub-carrier libraries on `(LIBRARY, provider, externalId)` |
| `name` | `entry.name` |
| `slug` | `pkg-{slug(type)}-{slug(entry.name)}` (numeric collision suffixes handled by existing dedup) |
| `instances` | `[]` |
| `details` | `{ purl, version? }` |
| `relationships` | `{ type: "DEPENDS_ON", targetExternalId }` for each edge with `from === identity`; `to === SPDX_EDGE_SUBJECT` substitutes `resolvedComponent.externalId`; absent when empty |

### Degraded asset (unchanged)

Fetch/parse/format failures still yield the base asset with a degraded
`capabilities.bomInventory` marker — no `bomEntries`, no `relationships[]`,
no `LIBRARY` yields, regardless of opt-in.

## Edge projection rules (consumed, not changed)

`BomParseResult.edges` is `{ from, to }[]` in **declaring→target**
direction (target = the dependency), endpoints already projected to
normalized version-free purl identities with `SPDX_EDGE_SUBJECT` for the
document-described element:

- SPDX: `A DEPENDS_ON B` → `[A, B]`; `A *_DEPENDENCY_OF B` → `[B, A]`;
  `DYNAMIC_LINK`/`STATIC_LINK` → `[from, to]`; subject per
  `documentDescribes`/`DESCRIBES`.
- CycloneDX: `dependencies[].ref → dependsOn[]` → `[ref, dep]`; subject
  per `metadata.component.bom-ref`, else the single root dependency
  entry.

Carrier substitution map: `SPDX_EDGE_SUBJECT` → `resolvedComponent.externalId`
in **both** positions (research D2).

## Config schema delta

```text
sbomFileConfigSchema
├── sbomUrl            (unchanged)
├── componentSlug      (unchanged)
├── resolvedComponent  (unchanged, backend-injected)
└── importDeclaredEdges: z.boolean().default(false)   # NEW — UX-EDGE-03 copy
```

Manifest delta: `declaredEdgesConfigKey: "importDeclaredEdges"` — this is
the entire server-side + form-switch activation; both run paths compute
`declaredEdgesEnabled` from it generically.
