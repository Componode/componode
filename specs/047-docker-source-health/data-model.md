# Data Model: Docker Source Health Observations and ImporterSource UI

**Feature**: `047-docker-source-health` | **Date**: 2026-11-01

No schema migrations — `component_instances.rawConfig` (jsonb, nullable)
already exists (`001_initial_schema.ts:348`) and is persisted verbatim
from `DiscoveredAssetInstance.rawConfig` (`import-run-service.ts:462`).

## Entities

### `component_instances.rawConfig.dockerObservation` (new payload)

| Field | Type | Source (inspect) | Notes |
|---|---|---|---|
| `state` | `string` | `State.Status` | verbatim engine state (`unknown` fallback) |
| `exitCode` | `number` (optional) | `State.ExitCode` | only when non-zero |
| `oomKilled` | `boolean` (optional) | `State.OOMKilled` | only when true |
| `restarting` | `boolean` (optional) | `State.Restarting` | only when true |
| `startedAt` | `string\|null` | `State.StartedAt` | `0001-01-01…` zero-time → `null` |
| `finishedAt` | `string\|null` | `State.FinishedAt` | same zero-time rule |
| `health` | `object\|null` | `State.Health` | `null` = no healthcheck configured |
| `health.status` | `"healthy"\|"unhealthy"\|"starting"` | `Health.Status` | verbatim |
| `health.failingStreak` | `number` (optional) | `Health.FailingStreak` | when > 0 |

**Exclusion allowlist (never persisted/logged)**: `State.Health.Log`
(output + exit codes), health-check test commands
(`Config.Healthcheck.Test`), `/stats` API, event streams, full inspect
JSON, any history/time-series.

**Cardinality**: one observation per concrete container Instance;
rebuilt container → new Instance + new observation (retired Instance's
observation is not carried forward).

### `component_instances.status` (existing column, new mapping)

`InstanceStatus` enum unchanged (`RUNNING`/`STOPPED`/`ERROR`/`GONE`).
The Docker importer's emitted status changes per the R2 table —
`unhealthy`, `OOMKilled`, and unrecognized states now produce `ERROR`
where Wave C produced `RUNNING`/`STOPPED`. Consumers (status badge,
ADR-112 rollup, dashboard attention) require no changes.

### `ImporterSource` (existing — first UI consumer)

Wire shape `ImporterSourceListItem` (`core/src/contracts/importer-source.ts`):
`id`, `importerName`, `externalIdentity`, `label`, `status`
(`ACTIVE`/`UNMONITORED`/`RETIRED`), `boundConfigId`,
`boundConfig{id,label}|null`, `lastCompletedRunAt`,
`activeComponentMemberships`, `activeInstanceMemberships`,
`firstSeenInRunId`, `lastSeenInRunId`, `createdAt`, `updatedAt`.

Sub-resources: `GET /:id/runs` → `import_runs` rows (`configId` nullable
— run-detail links only render when present);
`GET /:id/memberships` → `{components, instances, truncated}` (200-row
cap per list).

Lifecycle transitions (existing semantics, surfaced in UI):
`ACTIVE ⇄ UNMONITORED` (config delete/rebind-on-report — automatic),
`ACTIVE|UNMONITORED → RETIRED` (explicit, confirmed), `RETIRED →
ACTIVE|UNMONITORED` (reactivate; 409 `SOURCE_STATE_CONFLICT` on invalid
transition).

### Component tags & suggestions (existing grammar, new derivation)

Tag grammar `^[a-z0-9][a-z0-9._:-]{0,31}$`, ≤20 tags (core `tagSchema`/
`tagsSchema`). Suggestion candidates derived at render time — never
persisted as suggestions:

| Source value | Candidate tag | Rule |
|---|---|---|
| `details.composeProject` | `compose:<project>` | project lowercased/trimmed by grammar transform; invalid → omit |
| `details.composeProject` + `details.composeService` | `service:<project>.<service>` | project-qualified (Clarifications); invalid/overlong → omit |

Dedup rule: candidates already present in `component.tags` are not
offered. Acceptance = append via `TagsInput` semantics (user saves the
edit); declining writes nothing.

## View-layer additions (frontend)

- `api/types.ts`: `ComponentInstance.rawConfig?: Record<string, unknown> | null`;
  `ComponentWithInstances.details` already on wire type — carry through
  `mapComponent` into the view `Component`; importer-source contracts
  re-exported from `@componode/core`; local interfaces for the
  memberships response (`SourceComponentMembership`,
  `SourceInstanceMembership` mirroring openapi.yaml:3666-3699).
- `view-types.ts`: view `Component.details`; view `ComponentInstance.rawConfig`;
  new `ImporterSource` view type (+ `mapImporterSource`,
  `SOURCE_STATUS_META` in `ux/lib/domain.ts`).
