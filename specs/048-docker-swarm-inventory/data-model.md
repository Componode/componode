# Data Model: Docker Swarm inventory (Wave E)

No schema/migration changes — all surfaces reuse `Component`,
`ComponentInstance`, `details`, `sourceDetails`, `rawConfig`, and the
existing `docker-engine:{info.ID}` ImporterSource.

## Swarm Service → Component + Instance

| Field | Value |
|---|---|
| `category` | `CONTAINER_ORCHESTRATION` |
| `provider` / `resourceType` | `DOCKER` / `swarm-service` |
| `name` / `slug` | `Spec.Name` (stack-prefixed: `stack_svc`) |
| `externalId` | `qualifyExternalId(src, "swarm-service:"+Spec.Name)` |
| `details` | `mode`, `image`, `stack` (namespace label or null), `secretRefs`/`configRefs` (`{id,name}` pairs), `updateState` |
| `sourceDetails` | `stack`, `serviceId` |

**Aggregate Instance** (one per resolved environment via
`envLabel`/`envMap` on `Spec.Labels`, default `OTHER`):

| Field | Value |
|---|---|
| `externalId` | `{src}::swarm-service:{Service.ID}` (survives rename) |
| `status` | replica table (contracts/) |
| `deployedAt`/`updatedAt` | manager `CreatedAt`/`UpdatedAt` when sane |
| `rawConfig.swarmObservation` | `{mode, desired, running, completed?, updateState?, observedAt}` |
| `sourceDetails` | `{stack, serviceId}` |

## Swarm Node → Component + Instance

| Field | Value |
|---|---|
| `category` / `resourceType` | `COMPUTE` / `swarm-node` |
| `name` | `Spec.Name` |
| `externalId` | `qualifyExternalId(src, "swarm-node:"+Spec.Name)` |
| `details` | `role`, `availability`, `reachability`, `leader` (bounded) |
| `instance.status` | node table (contracts/) |
| `instance.rawConfig.swarmNodeObservation` | `{role, availability, reachability, leader, state, addr}` |
| `instance.externalId` | `{src}::swarm-node:{Node.ID}` |

## Swarm Secret → metadata-only Component

| Field | Value |
|---|---|
| `category` / `resourceType` | `SECRET` / `swarm-secret` |
| `name` | `Spec.Name` |
| `externalId` | `qualifyExternalId(src, "swarm-secret:"+Spec.Name)` |
| `details` | `secretId`, `revision` (`Version.Index`), `labels` (allowlist only) |
| `instances` | `[]` — none, ever |
| rotation | new `Version.Index` updates `details.revision` on the same Component |

## Identity/reconciliation

- All externalIds carry the engine-source prefix → source-scoped
  reconciliation marks absent-on-next-run `GONE` unchanged.
- Compose (`CONTAINER`) and Swarm (`CONTAINER_ORCHESTRATION`)
  components sharing a name stay distinct — categories differ,
  externalIds differ; no edge transfer.
