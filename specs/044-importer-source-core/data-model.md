# Phase 1 Data Model — ImporterSource Core

**Feature**: 044-importer-source-core | **Date**: 2026-10-31

Lands as migration `022_importer_sources` (latest is `021_team_lob`); row
interfaces in `packages/backend/src/db/types.ts` + `DB` map; CHECK
constraints built from new `packages/core` constants via
`db/check-constraint-helper.ts` (no native ENUMs).

## New entities

### `importer_sources`

Durable provenance record (ADR-119). One row per
`(importerName, externalIdentity)` ever seen.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | UUID v7, param-inserted (ADR-045) |
| `importerName` | `text` NN | provider/importer scope for the identity |
| `externalIdentity` | `text` NN | canonical non-secret provider identity (URL identities canonicalized at write) |
| `label` | `text` NULL | display metadata — never used for matching |
| `status` | `text` NN default `'ACTIVE'` | CHECK `IMPORTER_SOURCE_STATUSES` |
| `boundConfigId` | `uuid` NULL → `importer_configs` `ON DELETE SET NULL` | the one active config bound to this Source |
| `firstSeenInRunId` | `uuid` NULL → `import_runs` `ON DELETE SET NULL` | provenance only |
| `lastSeenInRunId` | `uuid` NULL → `import_runs` `ON DELETE SET NULL` | provenance only |
| `createdAt`/`updatedAt` | `timestamptz` NN | |

Constraints: `UNIQUE(importerName, externalIdentity)`; index on
`boundConfigId`, `status`.

### `source_component_memberships`

Which Source reports which Component — the reconciliation unit.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | UUID v7 |
| `sourceId` | `uuid` NN → `importer_sources` `ON DELETE CASCADE` | |
| `componentId` | `uuid` NN → `components` `ON DELETE CASCADE` | |
| `active` | `boolean` NN default `true` | this Source currently reports it |
| `details` | `jsonb` NULL | source-specific metadata (ADR-119 item 4) |
| `firstSeenInRunId`/`lastSeenInRunId` | `uuid` NULL → `import_runs` `ON DELETE SET NULL` | |
| `createdAt`/`updatedAt` | `timestamptz` NN | |

Constraints: `UNIQUE(sourceId, componentId)`; index on `componentId`.

### `source_instance_memberships`

Same shape for `ComponentInstance`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | UUID v7 |
| `sourceId` | `uuid` NN → `importer_sources` `ON DELETE CASCADE` | |
| `componentInstanceId` | `uuid` NN → `component_instances` `ON DELETE CASCADE` | |
| `active` | `boolean` NN default `true` | |
| `details` | `jsonb` NULL | |
| `firstSeenInRunId`/`lastSeenInRunId` | `uuid` NULL → `import_runs` `ON DELETE SET NULL` | |
| `createdAt`/`updatedAt` | `timestamptz` NN | |

Constraints: `UNIQUE(sourceId, componentInstanceId)`; index on
`componentInstanceId`.

## Altered entities

### `import_runs`

| Change | Detail |
|---|---|
| `+ sourceId` | `uuid` NULL → `importer_sources` `ON DELETE RESTRICT` — durable attribution; NULL = `LEGACY_UNATTRIBUTED` |
| `configId` | NOT NULL → NULL; drop + recreate FK `ON DELETE SET NULL` (precedent: `pg_constraint` DO-block, migration `008`) |
| `+ import_runs_config_idx` | `configId` is unindexed today and `listRunsForConfig` scans |
| `+ import_runs_source_idx` | source run-history reads |

## Constants (packages/core)

- `IMPORTER_SOURCE_STATUSES = ["ACTIVE","UNMONITORED","RETIRED"]` +
  `ImporterSourceStatus` type — `constants/importer-source.ts` (drives the
  CHECK constraint per the core-constants rule).
- `SOURCE_AUDIT_ACTIONS` for `entity_changes.action` on
  `entityType = "importer_source"` (`created|bound|unmonitored|retired|
  reactivated`) — precedent `AGENT_AUDIT_ACTIONS`.

## Lifecycle state machine — `importer_sources.status`

```text
                ┌─────────────────────────────────────────────┐
                │                                             │
   report ──▶ ACTIVE ──config deleted/unbound──▶ UNMONITORED ──┤
                │  ▲                                ▲         │ report/
                │  │ config reattached               │         │ reattach
   retire       │  │                                 │         │
      └────────▶ RETIRED ◀── explicit, reversible ───┴─────────┘
                    │
                    └── reactivate → ACTIVE (bound) | UNMONITORED (unbound)
```

- `UNMONITORED` memberships keep counting in the effective-active union.
- `RETIRED` removes the Source's memberships from the union (rows persist —
  reversible); the transition runs the entity evaluation so entities with
  zero remaining effective-active memberships retire/`GONE`.
- `REPORT` on `RETIRED`/`UNMONITORED` reactivates to `ACTIVE` and rebinds
  the reporting config (Decision 1).

## Validation rules

- `externalIdentity` — non-empty, ≤512 chars, canonicalized at write
  (strip userinfo, auth query params, fragments for URL identities).
- `boundConfigId` — set only by the report/bind path and cleared by FK on
  config delete; never client-writable.
- Retirement endpoint enforces transitions: `retire` valid from
  `ACTIVE|UNMONITORED`; `reactivate` valid only from `RETIRED` — else
  `409 SOURCE_STATE_CONFLICT`.
