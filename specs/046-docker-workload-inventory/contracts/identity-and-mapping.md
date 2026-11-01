# Contract: Docker identity & asset mapping

**Feature**: `046-docker-workload-inventory` | **Status**: ratified text for ADR-121

## Source identity

| Case | `externalIdentity` | `label` |
|---|---|---|
| `/info.ID` present | `docker-engine:{ID}` | `/info.Name` |
| `/info.ID` absent | `docker-engine:{sourceKey}` (config scope `sourceKey`) | `/info.Name` else `sourceKey` |
| Neither available | run fails — contract violation (no unattributed assets) | — |

Reported via `context.reportSourceIdentity()` before the first asset
yield — including empty inventories (ADR-119, FR-007).

## Component `externalId` (`CONTAINER`, provider `DOCKER`)

| Workload kind | externalId | Rename behavior |
|---|---|---|
| Compose (`com.docker.compose.project` + `.service` labels) | `compose:{project}:{service}` | Rename without override → new Component (no edge transfer) |
| Any container with `componode.component-id` label (or configured `componentIdLabel` mapping key) | `workload:{labelValue}` | Stable across renames/environments |
| Standalone (no compose labels, no override) | `{sourceIdentity}::{containerName}` (leading `/` stripped) | Survives rebuild; rename → new Component |

Compose/override keys deliberately omit daemon/target identity — the
same logical workload shares one Component across environments. The
standalone fallback is daemon-qualified because bare names collide
across hosts. Component `externalId` uniqueness stays keyed
`(category, provider, externalId)` — ADR-120 precedent.

## ComponentInstance `externalId`

`{sourceIdentity}::{containerId}` — daemon + concrete container ID.
Rebuilds produce a new Instance under the same Component; the prior
Instance retires through normal source-scoped reconciliation only.

## Image `externalId` (opt-in — `PACKAGE_REGISTRY`, provider `DOCKER`)

`docker-image:{repo}@{digest}` when a digest exists, else
`docker-image:{repo}:{tag}` for untagged/digest-less images.
`instances: []` (metadata-only — the
`SECRET`-with-no-instances precedent). One Component per unique
reference; shared across sources via memberships.

## Environment mapping

`environmentLabel` names the Docker label key; `environmentMap` maps
label values to `ENVIRONMENTS`. Resolution order: container labels →
Compose service labels (when the container is compose-managed) →
`OTHER`. No inference from reachability, hostname, or target naming.

## Status mapping (Wave C)

Engine `State.Status` only — `running`→`RUNNING`;
`created`/`paused`/`exited`→`STOPPED`; `dead`/`restarting`/`removing`→
`ERROR`; unrecognized→`ERROR` (fail closed). `State.Health` is not
consulted in Wave C.

## Minimization allowlist

Persisted: image ref/digest, published ports, network names, volume
names, mount `{type, destination, opaqueRef}` (bind sources hashed into
`bind:{instanceId}:{destination}` refs — never raw paths), bounded label
subset (`com.docker.compose.*` + `componode.*` + configured env label),
state/exit facts, restart policy name.

Never persisted or logged: `Env` arrays, raw bind `Source` paths, full
inspect JSON, `State.Health` `Output`/`Test`, Swarm secret/config
content, resolved secret values.
