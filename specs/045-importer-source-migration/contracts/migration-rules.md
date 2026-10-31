# Contract: migration 023 backfill rules

Ratified in ADR-120. Runs inside the Kysely migration chain at boot —
idempotent (`ON CONFLICT DO NOTHING` on membership/source unique keys).

## Defensible-identity derivation (scope-only)

| Importer | Derivable `externalIdentity` from scope? | Rule |
|---|---|---|
| github | **No** — `org.id` needs an API call | skip backfill; adopt-on-report covers live configs |
| aws | only `sourceKey` (new field — always absent pre-migration) | skip |
| azure | `subscriptionId` when present | identity = subscriptionId |
| alibaba-cloud | **No** — `accountId` needs STS call | skip |
| kubernetes | `endpoint` when present | identity = canonical endpoint |
| api-url | `url` (required) | identity = canonical url |
| web-url | `url` (required) | identity = canonical url |
| mcp-server | `endpoint` when present | identity = canonical endpoint |

## Backfill actions per derivable config

1. `getOrCreate ImporterSource(importerName, canonicalIdentity)`
   (`status = ACTIVE`, `boundConfigId = config.id`).
2. For every `component` whose `lastSeenInRunId` resolves to a run of
   this config: insert `source_component_memberships`
   (`active = true`, `first/lastSeenInRunId = latest such run`,
   `details = null`).
3. Same for `component_instances` of those components.
4. Skip components whose `lastSeenInRunId` is `NULL` (manually created),
   whose last-seen run belongs to a different/deleted config, or whose
   config identity is underivable → all stay `LEGACY_UNATTRIBUTED`.

## Explicit non-actions (preservation invariants)

- `import_runs.sourceId` — **never** backfilled; `NULL` is factually
  correct (no run reported identity pre-adoption).
- `components.externalId` — **never** batch-rewritten; adoption rekeys
  only on live report.
- No component/instance lifecycle or status changes; no memberships for
  entities a run didn't last-see under that config.
- No auto-split/merge/rekey/retire anywhere in the migration.

## Concurrency

Migrations run before the worker accepts runs, so live-run races are
structurally excluded; `ON CONFLICT` guards make a partially-repeated
migration safe.
