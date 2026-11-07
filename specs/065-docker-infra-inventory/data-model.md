# Data Model: Docker infrastructure inventory (spec 065)

No schema changes. Both new component types carry all facts in
`components.details` (JSONB passthrough) with `instances: []` — the
image/swarm-secret precedent. Every field is optional/absent-when-
unreported.

## Network Component (new, always emitted)

```jsonc
{
  "category": "NETWORK",
  "provider": "DOCKER",
  "resourceType": "network",
  "name": "frontend",                          // Docker network Name verbatim
  "externalId": "docker-engine:<engine-id>::network:swarm:frontend",
                                                 // qualifyExternalId(sourceIdentity,
                                                 //   `network:{scope}:{name}`)
  "details": {
    "driver": "overlay",                       // Network.Driver
    "scope": "swarm",                          // Network.Scope verbatim (local|global|swarm)
    "internal": true,                          // only when true
    "attachable": true,                        // only when true
    "ingress": true,                           // only when true
    "configOnly": true,                        // only when true
    "enableIPv6": true,                        // only when true
    "createdAt": "2026-10-01T12:00:00Z",       // Network.Created RFC3339 verbatim
    "attachedCount": 3,                        // Object.keys(NetworkInspect.Containers).length
    "attachedContainers": ["web-1", "api-1"],  // Containers[*].Name — endpoint names only
    "labels": {                                // Labels ∩ prefix allowlist
      "com.docker.compose.project": "myapp"
    }                                          // omitted when no allowlisted labels
  },
  "instances": []
}
```

Sourcing: `GET /networks` list row + `GET /networks/{id}` inspect (the
list omits `Containers` on API ≥ 1.28 — see research.md R2).

**Excluded forever**: `Id`, `IPAM` (subnets/gateways/AuxAddresses),
`Options`, per-endpoint `EndpointID`/`MacAddress`/`IPv4Address`/
`IPv6Address`/`GlobalIPv6*`/`IPPrefixLen`/`Links`, `ConfigFrom`,
`Peers`.

## Volume Component (new, always emitted)

```jsonc
{
  "category": "STORAGE",
  "provider": "DOCKER",
  "resourceType": "volume",
  "name": "my-volume",                         // Docker volume Name verbatim
  "externalId": "docker-engine:<engine-id>::volume:my-volume",
                                                 // qualifyExternalId(sourceIdentity,
                                                 //   `volume:{name}`)
  "details": {
    "driver": "local",                         // Volume.Driver
    "scope": "local",                          // Volume.Scope verbatim (local|global)
    "createdAt": "2026-06-07T20:31:11Z",       // Volume.CreatedAt RFC3339 verbatim
    "sizeBytes": 10920104,                     // df UsageData.Size — omitted when -1/absent
    "refCount": 2,                             // df UsageData.RefCount — omitted when -1/absent
    "reclaimable": true,                       // df UsageData.Reclaimable — optional, modern API omits
    "labels": {                                // Labels ∩ prefix allowlist
      "com.docker.compose.project": "myapp"
    }                                          // omitted when no allowlisted labels
  },
  "instances": []
}
```

Sourcing: `GET /volumes` list row + `GET /system/df?type=volume` usage
join by `Name` (UsageData is omitted outside `/system/df` — research.md
R3).

**Excluded forever**: `Mountpoint` (host path), `Options` (driver opts —
`local type=bind` embeds host paths, `type=nfs` embeds server addresses),
`Status` (free-text), `ClusterVolume` internals.

## Shared rules

- `labels` uses the container-label prefix allowlist
  (`com.docker.compose.*`, `componode.*`) — never unbounded.
- `instances: []` always — point-in-time facts only; no per-environment
  instances, no `environment` field.
- Boolean flags emit only when `true` (the `oomKilled`/`restarting`
  convention); numeric/string facts emit when reported.
- Both asset types pass `validateDiscoveredAsset` before yield.
- Fail-closed: any `/networks`, `/volumes`, `/system/df`, or
  `NetworkInspect` error fails the run — no partial infra inventory.
- Emission is unconditional (no config flag): after the
  `includeImages` block, before `reportPhase("Completed")`.

## Validation rules

- Every emitted asset passes `validateDiscoveredAsset`.
- No new entity, table, enum, or CHECK constraint — `NETWORK`/`STORAGE`
  already exist in core constants.
- `resourceType` values `"network"`/`"volume"` are free-form strings.
