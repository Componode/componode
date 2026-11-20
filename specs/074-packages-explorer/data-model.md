# Phase 1 Data Model: Packages Explorer (Phase 1b)

**Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

One schema change (a stored, indexed identity column) plus three read shapes derived by query. No new tables, no new write paths.

## Storage change — migration `034_bom_entries_purl_identity`

| Column | Type | Notes |
|---|---|---|
| `bom_entries.purlIdentity` | `text NOT NULL` | `normalizePurlIdentity(purl)` — version/qualifiers/subpath stripped, per-type normalization via `packageurl-js`. Fallback: verbatim `purl` when unparseable. Written by `processBomEntries`; backfilled per-row in `up()` over existing rows; also populated by `playwright/data/seed-app-flows.ts` pg inserts. |

- Index `bom_entries_purl_identity_idx` on `purlIdentity` — the grouping/matching key for `GET /packages`, `GET /packages/consumers`, and the search extension.
- Unchanged: the two partial unique upsert indexes stay keyed on verbatim `purl` (re-report identity is a write concern; the rollup identity is a read concern). `db/types.ts` `BomEntryRow` gains `purlIdentity: string`.
- `down()` drops index + column.

## Read shapes (derived — not stored)

### PackageListItem — `GET /packages` row

Grouped by `purlIdentity` over `bom_entries` joined to ACTIVE `components`:

| Field | Derivation |
|---|---|
| `purl` | the group key (`purlIdentity`) — the version-free identity |
| `name` | representative entry name (most recently reported in the group) |
| `ecosystem` | group ecosystem (one purlIdentity ⇒ one type ⇒ one ecosystem) |
| `versionCount` | `count(DISTINCT version)` in the group |
| `versions[]` | top 5 `{version, componentCount}` by component count (D3 second query) |
| `componentCount` | `count(DISTINCT componentId)` over ACTIVE components |
| `catalogComponent` | `null` — Phase 2 contract placeholder (`resolvedComponentId` match) |
| `pendingSuggestionCount` | `0` — Phase 2 contract placeholder |

### PackageConsumerListItem — `GET /packages/consumers` row

`DISTINCT ON (componentId, version, scope)` over entries matching `purlIdentity` (+ optional `version`), representative = newest `lastReportedAt`; joined to ACTIVE `components`:

| Field | Derivation |
|---|---|
| `component` | `{id, slug, name, category}` — deep-link target for `?tab=bom&q={purl}` |
| `version` | group version (nullable → shown muted when absent) |
| `scope` | `BomDependencyScope` |
| `direct` | `bool_or(direct)` over the group (D2) |
| `lastReportedAt` | `max(lastReportedAt)` over the group |

### SearchResults.packages[] — `GET /search` extension

`{ purl, name, ecosystem, componentCount }` — top 5 prefix matches (`name%` / `purlIdentity%`) over the same grouped rollup (D4).

## Validation rules

- `listPackagesQuerySchema` (`.strict()`): `page`, `pageSize`, `order` (base), `search` ≤100 chars, `ecosystem` CSV strings, `scope` CSV ∈ `BOM_DEPENDENCY_SCOPES`, `catalog` ∈ `{linked,suggested,none}` accepted-and-ignored (D6), `sort` ∈ `{name,components,versions,ecosystem}` default `components` (+`order` default `desc`).
- `listPackageConsumersQuerySchema` (`.strict()`): `purl` required string ≤~500 chars (normalized via `normalizePurlIdentity`; unparseable falls back to verbatim match), `version` optional string, `page`, `pageSize`, plus `sort` ∈ `{name,version,scope,lastReportedAt}` default `name`.
- Search: `q` unchanged; the `packages` group shares the existing `limit`-bounded pattern at a fixed top-5.

## Relationships

- `bom_entries.componentId → components.id` (existing) — consumers/rollup join; `lifecycle = 'ACTIVE'` filter (D5).
- `bom_entries.sourceId → importer_sources.id` (existing) — untouched; Phase 1b renders no per-source column (provenance stays on the BOM tab).
- `bom_entries.resolvedComponentId` (existing, always NULL) — future `catalogComponent` source; not joined in Phase 1b.
