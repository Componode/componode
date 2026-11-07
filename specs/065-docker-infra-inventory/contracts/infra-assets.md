# Contract: infrastructure components (`network` + `volume`)

Ratified design: `researches/docker-importer-enrichment-pack.md` (spec
065, Wave G). Recorded as ADR-121 **Amendment 4** by this change. All
fields are additive to a new asset type — `instances: []`, facts in
`details` only.

## Network component — one per engine network, always emitted

```jsonc
{
  "category": "NETWORK",
  "provider": "DOCKER",
  "resourceType": "network",
  "name": "<Network.Name>",
  "externalId": "<sourceIdentity>::network:<scope>:<name>",
  "details": {
    "driver": "…",               // Network.Driver
    "scope": "local",            // Network.Scope verbatim
    "internal": true,            // optional — only when true
    "attachable": true,          // optional — only when true
    "ingress": true,             // optional — only when true
    "configOnly": true,          // optional — only when true
    "enableIPv6": true,          // optional — only when true
    "createdAt": "…",            // Network.Created RFC3339
    "attachedCount": 0,          // Object.keys(Containers).length — inspect-sourced
    "attachedContainers": ["…"], // Containers[*].Name — omitted when empty
    "labels": { "…": "…" }       // Labels ∩ prefix allowlist — omitted when empty
  },
  "instances": []
}
```

Sourcing: `GET /networks` (list) + `GET /networks/{id}` inspect per
network — the list response omits `Containers` on API ≥ 1.28, so
attachments come from inspect (endpoint **names** only). Inspect
failure fails the run (fail-closed).

**Excluded forever**: `Id`, `IPAM`, `Options`, endpoint
`EndpointID`/`MacAddress`/`IPv4Address`/`IPv6Address`/`GlobalIPv6*`/
`IPPrefixLen`/`Links`, `ConfigFrom`, `Peers`.

## Volume component — one per engine volume, always emitted

```jsonc
{
  "category": "STORAGE",
  "provider": "DOCKER",
  "resourceType": "volume",
  "name": "<Volume.Name>",
  "externalId": "<sourceIdentity>::volume:<name>",
  "details": {
    "driver": "…",               // Volume.Driver
    "scope": "local",            // Volume.Scope verbatim
    "createdAt": "…",            // Volume.CreatedAt RFC3339
    "sizeBytes": 0,              // df UsageData.Size — omitted when -1/absent
    "refCount": 0,               // df UsageData.RefCount — omitted when -1/absent
    "reclaimable": true,         // df UsageData.Reclaimable — optional
    "labels": { "…": "…" }       // Labels ∩ prefix allowlist — omitted when empty
  },
  "instances": []
}
```

Sourcing: `GET /volumes` (list) + one `GET /system/df?type=volume` call
joined by `Name` — `UsageData` is omitted outside `/system/df`.
df failure fails the run (fail-closed).

**Excluded forever**: `Mountpoint` (host path), `Options`, `Status`,
`ClusterVolume` internals.

## Shared contract rules

- `labels` on both: same prefix allowlist as container labels
  (`com.docker.compose.*`, `componode.*`) — never unbounded.
- `instances: []` always; `name` = Docker name verbatim.
- Emission is unconditional — no config flag; runs after the
  `includeImages` block on every transport and both executors
  (ADR-122 parity — identical code path, whatever the API returns).
- Any `/networks`, `/volumes`, `/system/df`, or `NetworkInspect` error
  fails the run — partial infra inventory is never emitted.
- No new endpoints, config keys, manifest fields, categories, providers,
  or API/contract changes.
