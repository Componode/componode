# Research: Web/API importer profiles and managed URL Checks

## Decision: Collection config contains Component profiles and instances

Each Web/API ImporterConfig stores one or more Component profiles. One profile
maps to one Component; its `instances[]` maps to that Component's
ComponentInstances. Profile names are editable and initially suggested from
the URL host. Stable profile/instance keys, not names or URLs, drive identity.

**Rationale**: A single source asset with environment-specific occurrences is
one Component with multiple ComponentInstances (ADR-014). A URL is not a
logical Component name, and an editable display name must not determine
reconciliation identity.

**Alternatives considered**: one Component per environment/URL (rejected;
conflates logical identity with deployment), one importer config per URL
(rejected; retains the current configuration-cardinality problem).

**Ratified in**: ADR-126. The config migration is one-to-one; old configs are
not automatically combined.

## Decision: Use a generated durable collection Source key

Each collection receives a generated immutable `sourceKey`, stored in
ImporterConfig scope and represented on the durable ImporterSource as
`collection:<sourceKey>`. URL additions/removals and display-label edits do
not re-key the Source. A recreated config can select and reattach the same
`UNMONITORED` Source.

**Rationale**: A set-derived URL identity changes whenever the endpoint set
changes and produces Source churn. An editable config label is not identity.
The new key is explicitly scoped to user-configured Web/API collections that
have no provider-native collection identity.

**Alternatives considered**: canonical URL-set identity (rejected; endpoint
list changes create a new Source), display label (rejected; mutable), one
Source per endpoint (rejected; conflicts with one-config/one-Source).

**Ratified in**: ADR-126 and ADR-119 Amendment 2.

## Decision: Core synchronizes managed URL Checks from importer scope

ImporterConfig scope is canonical for the one managed check definition per
configured ComponentInstance. Core materializes/reconciles those definitions
as `url_checks` rows and Source memberships. Importer packages continue to
yield only `DiscoveredAsset` and never touch the database. The URL Check
scheduler and `url_check_observations` remain separate from `import_runs`.

The check inherits cadence and vantage from the Component monitoring setup;
it may override cadence and target URL. The check target defaults to the
ComponentInstance URL. Methods are `GET`/`HEAD`; authentication is available
only for API-category Components. `autoDisableAfter` and the spec-056
consecutive-failure policy remain in force.

**Rationale**: This provides one place to author inventory and managed check
definitions without making importer code a persistence adapter or making
monitoring observations importer-run history. Materialized URL Check rows
preserve the existing scheduler, credentials, metrics, retention, and detail
read path.

**Alternatives considered**: keep one URL per config (rejected; does not solve
the collection journey), make importer runs the monitoring scheduler
(rejected; conflates complete inventory/reconciliation with probe history),
let importer packages write checks directly (rejected by Constitution
Principle II).

**Ratified in**: ADR-126, amending ADR-123 and ADR-124.

## Decision: Share managed checks by stable key with Source ownership

A managed check has a stable key associated with its ComponentInstance. The
same Component/instance/check keys across Sources resolve to one URL Check
record and observation stream. A typed `source_url_check_memberships` table
tracks which Source declares that check. Conflicting definitions for the
same managed key are rejected. A shared check remains scheduled while any
effective, enabled Source membership declares it.

**Rationale**: Source-scoped ownership prevents one ImporterConfig from
retiring a check another Source still declares, while preserving one
monitoring history for one logical check.

**Alternatives considered**: one duplicate URL Check per Source (rejected;
duplicates probe traffic and histories), last-writer-wins definitions
(rejected; a Source could silently change another Source's monitor).

**Ratified in**: ADR-126; the schema inventory change is recorded in
ADR-077 Amendment 5.

## Decision: URL Check outcomes drive monitored ComponentInstance status

The importer continues its one-shot discovery request for initial status and
discovery details. After the first URL Check observation, check outcomes are
authoritative for the monitored instance: `SUCCESS` sets `RUNNING`,
`FAILURE` sets `ERROR`, and `MISSED`, no-data, or disabled states preserve
the last operational status. Importer runs continue fetching the configured
URL, but their later status values do not overwrite a status after the check
has observed the instance. `GONE` remains exclusively source-reconciled.

Product health continues to use the ADR-112 rollup over current
ComponentInstance statuses; it therefore reflects URL Check outcomes for
monitored instances.

**Rationale**: The user selected one operational signal for monitored
instances and accepted its effect on Product health, while preserving
`MISSED` as a monitor-side gap rather than evidence of endpoint failure.

**Alternatives considered**: keep importer status as the only operational
signal (rejected for this feature), make the last write from importer or
scheduler win (rejected; nondeterministic), map `MISSED` to `ERROR` (rejected;
monitor downtime is not endpoint failure).

**Ratified in**: ADR-126, amending ADR-014, ADR-112, ADR-123, and ADR-124.

## Decision: Completed runs contain row-level endpoint failures

Every configured profile and instance is evaluated. An endpoint response or
transport failure is represented on that ComponentInstance as `ERROR` while
sibling rows continue. When every configured row has been evaluated, the
ImportRun is `COMPLETED` and Source reconciliation runs. Fatal/configuration
failures and incomplete runs remain `FAILED` and never reconcile. No
`PARTIAL` status is added.

**Rationale**: The config is the complete inventory definition. Per-instance
errors do not make the inventory set incomplete; a fatal run does.

**Alternatives considered**: `PARTIAL` terminal status (rejected; no new
status is needed when each configured row has an explicit outcome), fail the
whole run for one endpoint error (rejected; loses independent sibling
outcomes).

**Ratified in**: ADR-126 and ADR-037 Amendment 2.

## Decision: Source lifecycle governs managed check lifecycle

- Disabling an ImporterConfig pauses its managed check memberships.
- An explicit disabled-to-enabled transition re-enables checks whose
  configured `enabled` value is true and resets their auto-disable streak.
  Ordinary import runs do not clear an auto-disable state.
- Deleting an ImporterConfig leaves its Source `UNMONITORED`; managed checks
  are paused and their definitions/observations remain available for
  reattachment.
- Removing an endpoint deactivates only its reporting Source membership. If
  a completed run makes the ComponentInstance `GONE` and no effective Source
  membership remains, the managed URL Check and all of its observations are
  deleted. A shared instance/check is retained.

**Rationale**: This follows source-scoped reconciliation and preserves
history across config deletion while making removal of a truly orphaned
instance a deliberate retention boundary.

**Ratified in**: ADR-126, amending ADR-047, ADR-119, and ADR-124.

## Decision: Managed check authoring is importer-only

The Importer UI is the only authoring surface for importer-managed checks.
Component detail shows managed check state/history read-only and links to the
owning ImporterConfig. Legacy manually authored checks are disabled and
retained read-only. Direct URL Check write methods are deprecated and return
`410 URL_CHECK_WRITE_DEPRECATED`; URL Check read/metrics/history and
Component monitoring-setup defaults remain available. Manual Component
creation remains, but `POST /components` no longer accepts a monitoring
block.

**Alternatives considered**: keep two editable sources of managed check
definitions (rejected; they could diverge), continue manual check authoring
(rejected for this product flow), delete legacy check history on rollout
(rejected; retain it for auditability).

**Ratified in**: ADR-126, amending ADR-054, ADR-071, ADR-123, ADR-124, and
ADR-125.

## Decision: Migrate one old config to one new profile

Each existing `{ url }` scope becomes a singleton profile and instance.
Existing Component, ComponentInstance, ImporterSource, and run IDs remain;
the Source row receives a generated collection key and keeps its memberships
and run history. A unique existing check whose URL matches the instance URL
is adopted without changing its ID or observations. Extra legacy checks are
disabled and retained. If no unique match exists, create a default managed
check and retain old check rows as disabled legacy records. Separate old
configs are never automatically merged.

**Rationale**: Provenance and observation identity survive the schema change;
an ambiguous check history is not silently merged or discarded.

**Ratified in**: ADR-126.

## Current-source notes

- Current importer config create/update validates stored `scope` against the
  current manifest schema; manifest `version` alone does not migrate the
  stored JSON. A migration step is required.
- `DiscoveredAsset` has no check field. Core synchronization must read the
  validated ImporterConfig scope and remain outside importer packages.
- Current URL Check observations are retained for 30 days, except the
  user-ratified early deletion when a managed check's ComponentInstance
  becomes `GONE` with no effective Source membership.
