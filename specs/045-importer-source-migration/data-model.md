# Data Model: Importer Source Migration

No new tables. This feature populates existing spec-044 structures and
extends two contract interfaces.

## Entities (existing — semantic changes only)

### ImporterSource (`importer_sources`)

Unchanged schema (migration 022). Gains rows for all eight in-tree
importers' identities. `externalIdentity` values per
`contracts/source-identity-keys.md` — always canonicalized before write;
`importerName` + `externalIdentity` is the uniqueness boundary.

### Source→Component membership (`source_component_memberships`)

Columns: `id`, `sourceId`, `componentId`, `active`, `details`,
`firstSeenInRunId`, `lastSeenInRunId`, timestamps.

- `details` — **newly populated**: `asset.sourceDetails` on report.
  Previously written `null` (Wave A deferral). Canonical facts stay on
  `components.details`.
- `active`/`lastSeenInRunId` — refresh semantics unchanged (upsert on
  `(sourceId, componentId)` conflict).
- Backfilled rows: `firstSeenInRunId`/`lastSeenInRunId` = the config's
  latest run id; `details = null` (no source facts exist for history).

### Source→ComponentInstance membership (`source_instance_memberships`)

Same shape; `details` populated from `instance.sourceDetails`.

### ImportRun (`import_runs`)

- `sourceId` — populated at run start for all migrated importers (the
  contract already enforces this once `reportsSourceIdentity` is set).
- **Backfill rule**: historical `sourceId` stays `NULL` — a run that
  never reported identity remains `LEGACY_UNATTRIBUTED` forever.
- `configId → NULL` on config deletion unchanged (ADR-047 A1).

### Component / ComponentInstance

- `externalId` — may be **rewritten once** on adopt-on-report (qualified
  form replaces the legacy form when a live Source first claims the
  row). Never batch-rewritten; never rewritten for unreported rows.
- `details` — canonical last-writer semantics unchanged; curated fields
  protected per spec 017.
- `lastSeenInRunId` — the provenance link backfill traverses:
  `component.lastSeenInRunId → import_runs.id → import_runs.configId`.

### ImporterConfig (`importer_configs.scope`)

- New optional scope key `sourceKey` on `importer-aws`,
  `importer-kubernetes`, `importer-mcp-server`, `importer-azure`
  (subscription-less fallback). Non-secret, trimmed non-empty string,
  used verbatim as `externalIdentity` when the provider-native key is
  absent.

## Contract extensions (packages/core)

### `DiscoveredAsset` (+1 field)

```ts
sourceDetails?: Record<string, unknown> | null;
```

Source-specific facts destined for the component membership's `details`.
Optional; absent → membership `details` stays `null` (current behavior).

### `DiscoveredAssetInstance` (+1 field)

```ts
sourceDetails?: Record<string, unknown> | null;
```

Same, for the instance membership.

## State transitions

### Component externalId adoption (new)

```text
legacy row (externalId = "us-east-1:ec2:instance", no membership)
  → adopting run reports source + yields qualified asset
  → qualified lookup misses → legacy-form lookup hits (no membership
    from this Source)
  → externalId := "acct-1::us-east-1:ec2:instance"; membership created
```

Guards: fallback only fires for runs with a `sourceId`; the matched row
must have **no** membership under the reporting Source (prevents the
reporting Source's own rows re-matching) — other Sources' memberships do
not block (first reporter legitimately claims a previously merged row).

### Provenance resolution order (read-side, unchanged)

```text
run.sourceId != null  → attributed to that ImporterSource
run.sourceId  = null  → LEGACY_UNATTRIBUTED (explicit absence)
```

## Migration 023 backfill flow

```text
for each importer_config where importerName ∈ migrated set:
  identity := deriveFromScope(config.scope)        // contracts/migration-rules.md
  if identity = null → skip (stays LEGACY)         // underivable
  source := getOrCreate(importerName, identity)
  for each component where lastSeenInRunId ∈ runs(config):
    insert membership (active, lastSeen = run)     // idempotent
  for each instance of those components:
    insert instance membership
```

Invariant: zero rows touched whose provenance is ambiguous — deleted
configs, `configId NULL` runs, underivable identities, manually created
components.
