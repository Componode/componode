# Data Model: Web/API importer profiles and managed URL Checks

## Scope and source of truth

- ImporterConfig `scope` is the authoritative declaration for Web/API
  Component profiles, ComponentInstances, and their one managed check per
  instance.
- `ImporterSource` remains the durable inventory-provenance entity.
- `components` and `component_instances` remain the canonical catalog records.
- `url_checks` is the materialized operational record used by the independent
  scheduler. `url_check_observations` remains the monitoring history.
- Importer packages emit only `DiscoveredAsset`; the core reads validated
  ImporterConfig scope and performs all database writes.

## Configuration model

### ImporterConfig collection

The existing `importer_configs.scope` JSON value gains a v2 collection shape.
The config keeps its existing importer name, label, schedule, executor,
credential binding, and `enabled` state.

| Field          | Meaning                                               | Invariant                                                                                                  |
| -------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `sourceKey`    | Generated stable identity for the collection          | UUID v7; immutable across URL/name changes; retained on the durable Source and selectable for reattachment |
| `components[]` | Logical Component profiles declared by the collection | At least one profile; stable order is not identity                                                         |

The Source identity reported by the importer is
`collection:<sourceKey>`. `ImporterSource` continues to enforce one active
config binding per Source.

### Component profile

| Field          | Meaning                                            | Invariant                                                                                                                           |
| -------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `componentKey` | Stable Component identity key                      | Generated UUID v7; immutable; reusable across Sources only when the same logical Component is intended                              |
| `name`         | Human-readable Component/profile name              | Required, trimmed, 1–200 characters; initially suggested from the first instance URL host; editable without changing `componentKey` |
| `instances[]`  | Environment-specific occurrences of this Component | At least one instance                                                                                                               |

The importer’s `provider` and `category` remain fixed by importer:

| Importer  | Component provider | Component category | Resource type |
| --------- | ------------------ | ------------------ | ------------- |
| `web-url` | `WEB_URL`          | `WEB_ENDPOINT`     | `web:url`     |
| `api-url` | `API_URL`          | `API`              | `api:url`     |

The existing Component slug is retained when an existing Component is
renamed. New Component slugs are generated from the profile name through the
existing slug/uniqueness rules.

### ComponentInstance definition

| Field         | Meaning                                                            | Invariant                                                      |
| ------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| `instanceKey` | Stable occurrence identity                                         | Generated UUID v7; unique within its Component                 |
| `environment` | Operational environment                                            | One of the existing `ENVIRONMENTS` values                      |
| `url`         | Instance's primary URL                                             | Required HTTP(S), max 2048; ADR-106 validation at save and run |
| `region`      | Provider/location metadata                                         | Optional                                                       |
| `version`     | Reported version                                                   | Optional                                                       |
| `check`       | The single managed URL Check definition for this imported instance | Required for newly configured instances; one per instance      |

`Component.externalId` is the stable `componentKey`, and
`ComponentInstance.externalId` is the stable `instanceKey`; neither derives
from display name, URL, or environment. Environment remains an attribute,
not part of the ComponentInstance upsert key. Migration retains existing
external IDs as their stable key values.

### Managed URL Check definition

| Field                                 | Meaning                                        | Invariant                                                                                      |
| ------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `checkKey`                            | Stable identity of this check for the instance | Generated UUID v7; stable across config edits; used to share the same check across Sources     |
| `name`                                | Check display name                             | Required, trimmed; generated from profile/instance when omitted                                |
| `url`                                 | Optional target override                       | Defaults to `ComponentInstance.url`; independently validated with ADR-106 rules                |
| `method`                              | HTTP request method                            | `GET` or `HEAD`; default `GET`                                                                 |
| `enabled`                             | Configured intent to probe                     | Boolean; default true                                                                          |
| `successPolicy`                       | Accepted HTTP response policy                  | Existing URL Check policy; default 2xx                                                         |
| `cadenceSeconds`                      | Optional per-check cadence override            | Null inherits the Component monitoring setup; otherwise within existing 60–86400 second limits |
| `authMode`                            | Authentication mode                            | `NONE`, `BASIC`, `BEARER`, or `CUSTOM_HEADERS`; non-`NONE` only for `API` Components           |
| `credentialId`                        | Reusable Credential reference                  | Never a secret value; compatible with Hub/Agent vantage and existing Credential rules          |
| `authConfig`                          | Credential key-name mapping                    | Never contains Credential values                                                               |
| `availabilityTarget` / `targetWindow` | Optional target                                | Both set together or both null; existing URL Check validation applies                          |
| `autoDisableAfter`                    | Consecutive non-success threshold              | Null inherits the global default; `0` means never; existing 0–1000 limit applies               |

Vantage is not stored per check. It is inherited from the Component's existing
`component_monitoring_setups` record. A one-shot importer request and the
scheduled URL Check are separate requests and produce different facts.

## Persisted records and relationships

### Existing records

- `importer_configs.scope` stores the collection and all stable keys.
- `importer_sources.externalIdentity` stores `collection:<sourceKey>`.
- `source_component_memberships` and `source_instance_memberships` remain the
  inventory reconciliation ownership records.
- `components.externalId` and `component_instances.externalId` are derived
  from stable profile/instance keys.
- `component_monitoring_setups` remains one per Component and owns shared
  cadence/vantage defaults.
- `url_checks` stores the materialized managed definition, runtime enabled
  state, next due time, auto-disable state, and Credential reference.
- `url_check_observations` stores per-slot results and remains the source for
  availability, error-rate, latency, and coverage-gap metrics.

### New managed-check ownership

Set `url_checks.managedKey` to `checkKey`, unique per `componentInstanceId`;
null denotes a legacy/manual row.
Add a typed `source_url_check_memberships` junction with:

| Field               | Meaning                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `sourceId`          | Owning ImporterSource                                                   |
| `urlCheckId`        | Materialized URL Check                                                  |
| `checkKey`          | Stable key from the ImporterConfig                                      |
| `active`            | Whether this Source declared the check in its latest complete inventory |
| `configuredEnabled` | This Source's desired check-enabled state                               |
| `lastSeenInRunId`   | Last completed run that reported this membership                        |

The table uses typed foreign keys, a unique `(sourceId, checkKey)` key, and
indexes for Source reconciliation and lookup by URL Check. It is not a
polymorphic `edges` table.

For one `(ComponentInstance, managedKey)`, all Sources must resolve to the
same check definition. A mismatch is a controlled conflict; the backend
never applies last-writer-wins. A check is schedulable while at least one
effective, enabled Source membership declares it. A Source's `UNMONITORED`
state pauses its own membership; another effective, enabled Source may keep
the shared check scheduled.

## Status and lifecycle

### ComponentInstance status authority

1. Before a managed URL Check has an observation, the importer's one-shot
   result supplies the initial ComponentInstance status.
2. After the first observation, the managed check is authoritative:
   `SUCCESS` → `RUNNING`, `FAILURE` → `ERROR`.
3. `MISSED`, no data, and disabled states preserve the last status.
4. Later importer-run status values are ignored for a ComponentInstance
   with a managed check that has an observation. Importer-run discovery
   details and source membership continue to update.
5. `GONE` is set only by Source reconciliation and cannot be overwritten by
   a late URL Check result. A `RETIRED` Component is not probed.
6. Status changes are audited only on transition; Product health is recomputed
   from the current ComponentInstance statuses under ADR-112.

### ImporterConfig and check transitions

| Event                                     | Importer/Source effect                                                  | Managed check effect                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Config created                            | New Source key is reported and registered on first run                  | Checks materialize with stable keys                                                                                                           |
| Config scope edited                       | Same Source identity remains; completed run reconciles updated profiles | Existing check IDs/history remain for stable keys; changes sync from config                                                                   |
| Config disabled                           | Source binding remains; no inventory run executes                       | Its check memberships pause; a shared check continues if another effective, enabled Source declares it                                        |
| Config re-enabled                         | Explicit operator transition                                            | Configured-enabled checks re-enable and reset the consecutive-failure streak; configured-disabled checks remain off                           |
| Config deleted                            | Source becomes `UNMONITORED`; run history and memberships remain        | Checks pause and retain definitions/observations; reattachment uses the same sourceKey                                                        |
| Endpoint removed from completed inventory | Its Source membership deactivates                                       | If the instance becomes `GONE` with no effective Source membership, delete the check and its observations; otherwise retain the shared record |
| URL Check auto-disables                   | Source/config remain unchanged                                          | `FAILURE` and `MISSED` advance the streak; `SUCCESS` resets; ordinary import runs preserve auto-disable                                       |

## Migration

For each existing one-URL config:

1. Locate its bound ImporterSource using the config/source relationship.
2. Set `sourceKey` from the existing Source UUID and rekey the same Source row
   to `collection:<sourceKey>`; preserve its Source ID, status, memberships,
   bound config, and run history.
3. Create one Component profile. Seed `componentKey` from the existing
   Component external ID, preserve the Component ID and slug, and use the
   URL host as the editable name suggestion where the old name was the URL.
4. Create one instance entry. Seed `instanceKey` from the existing instance
   external ID and preserve the ComponentInstance ID and existing URL,
   environment, version, region, and status.
5. If exactly one existing URL Check on that instance has a canonical URL
   equal to the instance URL, adopt that row as the managed check and preserve
   its ID and observation history. Disable and retain other checks.
6. If no unique check matches, create one default managed check for the
   instance URL and disable/retain all old checks. Do not merge check histories.
7. Make the migration idempotent and transactional per config. If Source or
   Component provenance is ambiguous, report the config for explicit
   resolution; do not split, merge, retire, or rekey uncertain records.

Manifest version `2.0.0` signals the config contract change but does not itself
perform the stored-scope migration.

## Invariants

- Importer packages never access the database and continue to call
  `validateDiscoveredAsset` in tests.
- A single profile always maps to one logical Component; its environments
  are ComponentInstances.
- Name, URL, environment, and label edits do not alter stable keys.
- Each imported ComponentInstance has exactly one managed check. Existing
  disabled legacy checks remain viewable but do not participate in status
  propagation.
- The Source's check membership is reconciled only after a complete run.
- A shared check definition never changes because another Source reported
  conflicting settings.
- Direct URL Check writes and manual Component-create monitoring are rejected;
  Component monitoring-setup defaults remain editable through their current
  permission.
