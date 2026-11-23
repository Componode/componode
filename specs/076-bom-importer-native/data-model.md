# Data Model: BOM Importer-Native Declared Edges (Phase 3)

## Contract entities (core)

### `DiscoveredAssetRelationship` (new, contract-only)

```ts
interface DiscoveredAssetRelationship {
  type: "DEPENDS_ON" | "SOURCES_FROM" | "EXPOSES";
  targetExternalId: string; // externalId of an asset yielded in the SAME run
}
```

- `DISCOVERED_RELATIONSHIP_TYPES` enum in `core/constants/importer-edge.ts`.
- `DiscoveredAsset.relationships?: DiscoveredAssetRelationship[]` — optional; presence on a yielded asset declares edges **from that asset**. Zod schema: item `.strict()`, `type` enum, `targetExternalId` non-empty string; array itself optional. A malformed entry fails `validateDiscoveredAsset` for the whole asset (existing contract behavior).
- `EdgeProvenance = "CURATED" | "IMPORTER"`; `EdgeKind = "DEPENDS_ON" | "SOURCES_FROM" | "EXPOSES"` — same enum, two consumers (junction column CHECK + suppression table CHECK + request schema).

### Direction mapping (declaring asset → junction columns)

| `type` | Junction | Declaring side | Target side |
|---|---|---|---|
| `DEPENDS_ON` | `component_depends_on_component` | `parentId` | `childId` |
| `SOURCES_FROM` | `component_sources_from` | `serviceId` | `repositoryId` |
| `EXPOSES` | `component_exposes` | `serviceId` | `apiId` |

### SPDX parse extension (core)

`BomParseResult` gains `edges: { from: string | SUBJECT, to: string }[]` where `from`/`to` are version-free purl identities of parsed packages and `SUBJECT` marks the document-described element. `DEPENDS_ON`/`DEPENDENCY_OF`-family relationships only (the same `SPDX_SCOPE_MAP` family already walked for scope); `CONTAINS`/`DESCRIBES` do not produce edges. The caller substitutes `SUBJECT` with the yielding asset's own `externalId`.

## Persistence (migration `038_bom_edge_provenance`)

### Junction columns (all three tables)

```sql
provenance        text NOT NULL DEFAULT 'CURATED'
                  CHECK (provenance IN ('CURATED','IMPORTER')),
importerSourceId  uuid NULL REFERENCES importer_sources(id) ON DELETE SET NULL,
importRunId       uuid NULL REFERENCES import_runs(id)      ON DELETE SET NULL
```

- `provenance='IMPORTER'` requires non-null `importerSourceId` (CHECK `provenance<>'IMPORTER' OR importerSourceId IS NOT NULL`).
- Existing rows → `CURATED` via the column default (all current writers are human paths).

### `component_edge_suppressions` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | UUID v7, SQL param (ADR-045) |
| `edgeKind` | text | CHECK IN (`DEPENDS_ON`,`SOURCES_FROM`,`EXPOSES`) |
| `fromComponentId` | uuid FK→components CASCADE | declaring side |
| `toComponentId` | uuid FK→components CASCADE | target side |
| `suppressedBy` | uuid FK→persons SET NULL | the Editor who hid it |
| `createdAt` | timestamptz | |

- `UNIQUE(edgeKind, fromComponentId, toComponentId)` — re-hide is idempotent.

## The edge pass (algorithm)

Runs at `COMPLETED` on both run paths (`import-run-service`, `remote-run-service`), after `runBomMatchPass`, failure-isolated. Collect phase (during `processAsset`, gated on manifest `declaredEdgesConfigKey` + `config[key]===true`):

```
declared: { declaringComponentId, edgeKind, targetExternalId }
extToComponent: Map<externalId, componentId>   // already built for dedup
```

Complete phase:

```
resolved = declared.filter(d => extToComponent.has(d.targetExternalId))
                    .map(d => (d.declaringComponentId, d.edgeKind, extToComponent.get(...)))
                    .dropSelfEdges().dedup()
dropped  = declared.size - resolved.size            // logged, never an error
suppressed = SELECT component_edge_suppressions WHERE pairs ∈ resolved
writeSet = resolved - suppressed
for each (kind, from, to) in writeSet:
    INSERT INTO <junction> (…, provenance='IMPORTER', importerSourceId=sourceId, importRunId=runId)
    ON CONFLICT (pk cols) DO NOTHING
    // a pre-existing CURATED row conflicts → untouched, keeps CURATED
retireSet = junction rows WHERE provenance='IMPORTER' AND importerSourceId=sourceId
            AND (kind, from, to) ∉ resolved
DELETE retireSet
audit writeEdgeChange("added"|"removed", runActor(importerName)) per write/delete
```

Rules that must hold (each is a spec acceptance scenario → a test):

1. `targetExternalId` outside the run's yielded set → dropped, counted, silent.
2. `FAILED`/`CANCELLED`/`INTERRUPTED` → pass never runs (placed on the completed path only, like `deleteAbsentBomEntries`).
3. Existing curated row on the pair → `ON CONFLICT DO NOTHING`, provenance stays `CURATED`.
4. Suppressed pair → never inserted, regardless of which source declares it.
5. Human write on a suppressed pair (link-all / suggestion accept) → succeeds (those paths do not consult suppressions).
6. Off switch → collect phase records nothing; `relationships[]` in the yield is inert.

## Read-side extension

`RelatedComponent` (component-relationships contract) gains optional fields, populated from the junction row already being selected in each family query:

```ts
edgeProvenance?: "CURATED" | "IMPORTER";
edgeImporterSourceId?: string | null;
edgeImporterConfigId?: string | null; // join importer_sources → config id, for run deep-link
edgeImportRunId?: string | null;
```

`dependsOn`, `dependedOnBy`, `sourcesFrom`, `sourcedBy`, `exposes`, `exposedBy` families only; `libraryCounts` and product lanes unchanged.

## Lifecycle/state notes

- Importer-added edges have no independent lifecycle — they live and die by the source-scoped diff (D4) and cascade with component deletion.
- Suppression records are append-only in v1; they cascade with component deletion (a deleted component can't re-form the pair anyway).
- `bom_component_suggestions` interplay: an importer-added edge that also covers a `PENDING` suggestion pair does not auto-decide the suggestion — the suggestion queue stays human-decided (ADR-113); the covered row will land `SUPERSEDED`/`ACCEPTED` on the next human decision or matching pass, same as a human-created edge would cause today.
