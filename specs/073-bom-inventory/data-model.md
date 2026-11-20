# Data Model: BOM Inventory (Phase 1)

**Feature**: `073-bom-inventory` | **Date**: 2026-11-20

## New table: `bom_entries` (migration `032_bom_entries`)

```sql
CREATE TABLE bom_entries (
  id                    uuid PRIMARY KEY,                    -- UUID v7, SQL param (ADR-045)
  "componentId"         uuid NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  "componentInstanceId" uuid REFERENCES component_instances(id) ON DELETE CASCADE,
  "parentBomEntryId"    uuid REFERENCES bom_entries(id) ON DELETE CASCADE,  -- NULL = top-level

  purl                  text NOT NULL,          -- verbatim, e.g. pkg:npm/lodash@4.17.21
  name                  text NOT NULL,
  version               text,
  ecosystem             text NOT NULL,          -- purl type fragment: npm, pypi, deb, rpm …

  scope                 text NOT NULL
    CHECK (scope IN ('RUNTIME','DEV','BUILD','TEST','SYSTEM','OPTIONAL','BUNDLED','TRANSITIVE')),
  "evidenceSource"      text NOT NULL
    CHECK ("evidenceSource" IN ('LOCK_FILE','MANIFEST_FILE','SBOM_DOCUMENT','IMAGE_LAYER','REGISTRY_API','VCS_ANALYSIS')),
  "evidenceDetail"      text,
  supplier              text,
  licenses              jsonb NOT NULL DEFAULT '[]',
  direct                boolean NOT NULL DEFAULT false,     -- authoritative for directness (Q4)
  "lastReportedAt"      timestamptz NOT NULL DEFAULT now(), -- bumped every report
  "cdxType"             text,                                  -- BomCdxType (round-trip; Phase-2 category)
  "cdxBomRef"           text,                                  -- intra-document ref

  "importRunId"         uuid REFERENCES import_runs(id) ON DELETE SET NULL,
  "sourceId"            uuid REFERENCES importer_sources(id) ON DELETE SET NULL,
  "resolvedComponentId" uuid REFERENCES components(id) ON DELETE SET NULL,  -- Phase 2 only

  details               jsonb,                  -- CPE, checksums, SPDX extras
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now()
);
```

**Upsert keys** (both `NULLS NOT DISTINCT` — grill Q2: NULL `componentInstanceId` must dedupe on PG16):

```sql
CREATE UNIQUE INDEX bom_entries_top_level_upsert_key
  ON bom_entries ("componentId", purl, scope, "componentInstanceId")
  NULLS NOT DISTINCT WHERE "parentBomEntryId" IS NULL;

CREATE UNIQUE INDEX bom_entries_child_upsert_key
  ON bom_entries ("componentId", purl, scope, "componentInstanceId", "parentBomEntryId")
  NULLS NOT DISTINCT WHERE "parentBomEntryId" IS NOT NULL;
```

**Secondary indexes**: `(componentId)`, `(componentInstanceId)`, `(parentBomEntryId)`, `(purl)` — the Phase-1b/impact index, `(resolvedComponentId)`, `(sourceId)`, `(ecosystem)`.

### Write semantics (ADR-131)

- **Scope** = `(componentId, componentInstanceId|null)` reported by one `sourceId`. Asset-level `bomEntries` → NULL-instance scope; instance-level `bomEntries` → that instance's scope.
- Per-asset transaction (`processAsset`): upsert by key — insert if absent, update payload fields if key-matched and changed, refresh only `lastReportedAt`/`importRunId`/`updatedAt` if identical. Children upsert under their parent's resolved id; the tree is written top-down inside the same transaction.
- Completion step (COMPLETED runs only): per reported scope, `DELETE … WHERE sourceId = ? AND scope = ? AND (importRunId IS NULL OR importRunId != ?)` — the key-matched diff's delete half.
- `FAILED`/`CANCELLED`/`INTERRUPTED` never reach the delete step; upserts already committed persist (same as components).
- `resolvedComponentId` is never written in Phase 1; `importRunId`/`sourceId` are provenance for freshness/multi-source UX.

## Altered table: `import_runs` (migration `033_import_run_package_counts`)

| Column | Type | Meaning |
|---|---|---|
| `packagesCreated` | integer NOT NULL DEFAULT 0 | new keys inserted |
| `packagesUpdated` | integer NOT NULL DEFAULT 0 | key-matched, payload changed |
| `packagesUnchanged` | integer NOT NULL DEFAULT 0 | key-matched, identical (only timestamps refreshed) |
| `packagesRemoved` | integer NOT NULL DEFAULT 0 | diff-deleted at completion |

## `app_settings`

| Key | Default | Read via |
|---|---|---|
| `bom.staleThresholdDays` | `7` | `getBomStaleThresholdDays()`; env `BOM_STALE_THRESHOLD_DAYS`; returned on the BOM summary as `staleThresholdDays` |

## Core contract shapes

```ts
// contracts/discovered-asset.ts — ADR-057 Amendment 1
interface DiscoveredBomEntry {
  purl: string;                        // required, valid purl
  name: string;                        // required
  evidenceSource: BomEvidenceSource;   // required
  evidenceDetail?: string | null;
  version?: string | null;
  scope?: BomDependencyScope;          // default RUNTIME
  direct?: boolean;                    // default: scope !== 'TRANSITIVE'
  licenses?: string[];
  supplier?: string | null;
  cdxType?: BomCdxType | null;
  cdxBomRef?: string | null;
  children?: DiscoveredBomEntry[];     // nested assemblies / SPDX CONTAINS
  details?: Record<string, unknown> | null;
}
interface DiscoveredAsset         { …; bomEntries?: DiscoveredBomEntry[] }
interface DiscoveredAssetInstance { …; bomEntries?: DiscoveredBomEntry[] }   // D2
```

`validateDiscoveredAsset` (Zod, `validation/discovered-asset.ts`) gains a recursive `discoveredBomEntrySchema` — purl shape check (via `isValidPurl`), enum checks, `scope` default `RUNTIME`; the field is **optional and presence-preserving** (schema must not default it in — absence vs `[]` is the completeness signal).

## API view shapes (contracts/bom-api.md is normative)

- `BomEntryListItem`: `id, purl, name, version, ecosystem, scope, direct, evidenceSource, evidenceDetail, licenses[], supplier, cdxType, source{id,name}, lastReportedAt, parentId, hasChildren, childCount, instanceCount, instanceTotal, resolvedComponent{id,slug,name}|null (always null P1), pendingSuggestionId (always null P1)`.
- `BomSummary`: `total, direct, ecosystems[], licenseCount, hasNesting, lastReportedAt, staleThresholdDays, sources[{id,name,importerKind,lastReportedAt}], instances[{id,name,environment,entryCount}]`.

## Constants (`packages/core/src/constants/bom-entry.ts`)

`BOM_DEPENDENCY_SCOPES` (8), `BOM_EVIDENCE_SOURCES` (6), `BOM_CDX_TYPES` (12) — verbatim from research §New enum constants. CHECK constraints generated from the same arrays (repo convention — no native ENUMs).

## Entity relationships

```
components 1───n bom_entries (CASCADE)
component_instances 1───n bom_entries (CASCADE, optional scope)
bom_entries 1───n bom_entries (self parent, CASCADE)
importer_sources 1───n bom_entries (SET NULL — provenance)
import_runs 1───n bom_entries (SET NULL — last-reporting run)
components 1───n bom_entries.resolvedComponentId (SET NULL — Phase 2)
```
