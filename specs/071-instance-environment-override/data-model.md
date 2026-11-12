# Data Model: Manual environment override for ComponentInstances

## `component_instances` — column additions (migration `031_instance_environment_override`)

| Column | Type | Null | Default | Constraints |
|---|---|---|---|---|
| `environmentOverride` | text | YES | — | CHECK: `environmentOverride IS NULL OR environmentOverride IN ('DEV','TEST','STAGING','DEMO','PRODUCTION','OTHER')` — built from core `ENVIRONMENTS` (same pattern as `component_instances_environment_check`) |
| `environmentOverriddenBy` | uuid | YES | — | plain column, no FK (same convention as `createdBy`/`updatedBy` — audit survives user deletion) |
| `environmentOverriddenAt` | timestamptz | YES | — | — |

No backfill: every existing row correctly starts unoverridden (`NULL` override → effective = `environment`).

## Field semantics

| Field | Written by | Meaning |
|---|---|---|
| `environment` (existing) | importer upsert / manual create / composite create | **Reported** environment — the baseline fact. Importers keep rewriting it every run, unchanged. |
| `environmentOverride` | `PATCH /component-instances/{id}` only | Human-set environment, or `NULL` = no override. |
| `environmentOverriddenBy` / `…At` | same PATCH | Provenance of the current override; set together, cleared together. |

**Effective environment** = `environmentOverride ?? environment` — derived at serialization, never stored.

## API contract (`ComponentInstance` payload)

| Field | Type | Notes |
|---|---|---|
| `environment` | enum | **Effective** value (was: reported). Backward-compatible — consumers already read it as "the environment". |
| `reportedEnvironment` | enum | The non-override column value; equals `environment` when not overridden. |
| `environmentOverride` | enum \| null | The override value; `null` = not overridden (doubles as the flag). |
| `environmentOverriddenBy` | uuid \| null | Actor who set the current override. |
| `environmentOverriddenAt` | date-time \| null | When the current override was set. |

All other instance fields unchanged. `environmentOverride`/`By`/`At` are `null` on non-overridden instances; `reportedEnvironment` always equals the stored `environment` column.

## Write rules

- **Import upsert** (`import-run-service`): writes `environment` (reported) as today; never touches the three new columns — they are absent from `instanceValues`, so updates and inserts leave them alone. No code change required.
- **Manual instance create** (spec 054 + composite create): sets `environment`; override columns default `NULL`.
- **PATCH** (new): `{environment: ENV}` → sets all three override columns atomically; `{environment: null}` → clears all three. Single transaction + `writeEntityChange` audit.
- **Reconciliation**: untouched — GONE/retirement is orthogonal; an override never affects instance lifecycle or visibility (FR-011).

## State transitions

```
not overridden ──PATCH env──▶ overridden(env=X, by, at)
overridden ──────PATCH env=Y▶ overridden(env=Y, by, at)   (by/at updated)
overridden ──────PATCH null─▶ not overridden              (effective → latest reported)
import run (any state) ─────▶ reported column refreshes; override columns untouched
```

## Identity invariants (FR-008)

`id`, `slug`, `externalId`, `componentId`, source memberships (`component_source_members`-style tables), `url_checks.componentInstanceId` — none derive from the override. Slug keeps its reported-env segment; it is opaque identity, not display truth.
