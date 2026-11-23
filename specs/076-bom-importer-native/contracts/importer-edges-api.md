# API Contracts: Importer-Native Declared Edges (Phase 3)

All routes under `/api/v1` (ADR-070), session-authenticated (ADR-097), `{code,message,details?}` error envelope (ADR-071), Zod `.strict()` bodies (ADR-095), `docs/openapi.yaml` updated in the same change (ADR-104).

## Importer contract (core → importers; ADR-133)

```ts
// packages/core/src/contracts/discovered-asset.ts
export interface DiscoveredAssetRelationship {
  type: "DEPENDS_ON" | "SOURCES_FROM" | "EXPOSES";
  targetExternalId: string; // resolves only within the same run's yielded assets
}

export interface DiscoveredAsset {
  // ...existing fields, bomEntries, etc.
  relationships?: DiscoveredAssetRelationship[];
}
```

- Validated by `validateDiscoveredAsset` — malformed entry rejects the asset.
- Processed only when the run's manifest declares the opt-in config key and `config[key] === true`; otherwise ignored entirely (no edges, no suggestions, no error).
- LIBRARY assets yielded by importers dedup on the normal `(category, provider, externalId)` triple — `externalId` = normalized version-free purl.

## Changed: `GET /components/:id/relationships`

Each row in the six component-edge families (`dependsOn`, `dependedOnBy`, `sourcesFrom`, `sourcedBy`, `exposes`, `exposedBy`) gains optional fields:

```jsonc
{
  "id": "…", "slug": "…", "name": "…", /* existing RelatedComponent fields */
  "edgeProvenance": "IMPORTER",
  "edgeImporterSourceId": "uuid-or-null",
  "edgeImporterConfigId": "uuid-or-null",
  "edgeImportRunId": "uuid-or-null"
}
```

- `edgeProvenance` absent/`CURATED` → UI renders **Curated**; `IMPORTER` → **Added by importer** + link to `/sources/{edgeImporterSourceId}` and `/importers/{edgeImporterConfigId}/runs/{edgeImportRunId}`.
- `libraryCounts`, product lanes, `kind` param, and the `LIBRARY` lane exclusion are unchanged.

## New: `POST /component-edge-suppressions`

Hide an importer-added edge (UX-EDGE-02). `EDITOR` via `component:edge:remove`.

**Request** (strict):

```json
{ "edgeKind": "DEPENDS_ON", "fromComponentId": "uuid", "toComponentId": "uuid" }
```

`from`/`to` use declaring/target semantics (`parentId`/`childId` for DEPENDS_ON, `serviceId`/`repositoryId` for SOURCES_FROM, `serviceId`/`apiId` for EXPOSES).

**Behavior** (single transaction):

1. Both components must exist → `404 NOT_FOUND` otherwise.
2. Upsert suppression record (`ON CONFLICT DO NOTHING`) → idempotent re-hide.
3. Delete the matching junction row if present; `writeEdgeChange("removed", sessionActor, "edge-suppressed")` when a row was deleted.
4. `200 { "suppressed": true, "edgeRemoved": boolean }` — `edgeRemoved:false` when the edge was already absent (suppression still recorded).

**Errors**: `403 FORBIDDEN` (Viewer), `404 NOT_FOUND`, `400 VALIDATION` (unknown fields, bad enum/id). Suppressing a `CURATED` edge returns `409 CONFLICT` — only importer-added edges are hideable; a curated edge must be changed through its human paths.

> Design note: a suppression whose junction row is `CURATED` is refused per FR-008 ("curated edges MUST NOT be suppressible") — checked inside the transaction before writing.

## Out of scope (no endpoints in v1)

- Listing suppressions, un-hiding (escape hatch = human re-creation via link/accept paths).
- Manual component-edge create/delete endpoints.
- Run-detail or importer-config schema changes beyond the importer's own config field (schema-driven form renders `importDeclaredEdges` from the manifest schema, as every other boolean field).
