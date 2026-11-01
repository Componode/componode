# Contract: Swarm inventory surfaces (spec 048)

Ratifies with **ADR-121 Amendment 2**. All shapes are allowlists — fields
not listed here are never read, persisted, or logged.

## Discovery gate

```text
swarm = info.Swarm
emitSwarm = swarm.LocalNodeState === "active" && swarm.ControlAvailable === true
if emitSwarm: require version.ApiVersion >= "1.41" (status=1 ServiceStatus)
  else → coded run failure (no partial Swarm inventory)
non-Swarm endpoints: zero additional API calls
```

## Status tables

**Service aggregate instance** (replicated + global — `ServiceStatus`
`DesiredTasks`/`RunningTasks`):

| running / desired | status |
|---|---|
| desired > 0, running === desired | `RUNNING` |
| desired > 0, running < desired | `ERROR` |
| desired === 0 | `STOPPED` |
| absent on completed run | `GONE` |

**Node instance**:

| `Status.State` / `Spec.Availability` / `ManagerStatus.Reachability` | status |
|---|---|
| `ready` + `active` (+ reachable/managerless) | `RUNNING` |
| any state + `drain` or `pause` | `STOPPED` |
| `down`, `disconnected`, unreachable, unknown/undefined | `ERROR` |
| absent on completed run | `GONE` |

## `swarmObservation` allowlist (service instance `rawConfig`)

```ts
{
  mode: "replicated" | "global";
  desired: number;
  running: number;
  completed?: number;       // only when > 0
  updateState?: string;     // only when present (updating/rollback/…)
  observedAt: string;       // importer ISO timestamp
}
```

## `swarmNodeObservation` allowlist (node instance `rawConfig`)

```ts
{ role: string; availability: string; reachability: string | null;
  leader: boolean; state: string; addr: string | null }
```

## Never collected

Task lists, `/tasks` endpoints, task inspect, service/node logs,
`/events`, secret or config **contents**, `TLSInfo`, node labels/env,
`ManagerStatus.Addr` beyond the node `addr` fact, raw swarm objects.

## Identity formats

```text
component ext: {src}:swarm-service:{Spec.Name}   (stack-prefixed → distinct stacks)
instance  ext: {src}::swarm-service:{ID}
component ext: {src}:swarm-node:{Spec.Name}
instance  ext: {src}::swarm-node:{ID}
component ext: {src}:swarm-secret:{Spec.Name}    (instances: [])
```

`qualifyExternalId`/`canonicalizeSourceIdentity` conventions unchanged.
