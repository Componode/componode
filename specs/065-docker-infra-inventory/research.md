# Research: Docker infrastructure inventory (spec 065)

Phase 0 output — every NEEDS CLARIFICATION resolved against the ratified
design (`researches/docker-importer-enrichment-pack.md`, Wave G), the
current importer source, the core contract, and the **Docker Engine API
v1.44 OpenAPI spec** (fetched and verified — see R1/R2; two ratified
fields required sourcing refinements the grilling session could not see).

## R1 — Minimum Engine API versions (FR-014): no new gate

**Verified** against `moby/moby` `docs/api/version-history.md` (v28.1.0)
and the Engine API v1.44 OpenAPI spec:

| Endpoint | Introduced | Notes |
|---|---|---|
| `GET /networks` (+ `/{id}` inspect) | API **v1.21** (Docker 1.9, 2014) | libnetwork endpoints; `Containers` detail confirmed on inspect |
| `GET /volumes` | API **v1.21** (Docker 1.9, 2014) | explicit v1.21 changelog entry |
| `GET /system/df` | API **v1.25** (Docker 1.13, 2016) | required for volume `UsageData` (R3) |

All three long predate the existing **v1.41 Swarm floor** and every
engine's practical minimum client API (Docker 20.10+ enforces ≥1.24;
Swarm-gated runs already require ≥1.41). **Decision**: no new version
gate, no floor constant — absent fields/endpoints simply omit on engines
that predate them (they cannot be reached in practice). The v1.41 Swarm
gate is unchanged.

**Alternatives considered**: adding an infra API floor (rejected —
unreachable in practice, adds a failure mode for zero benefit).

## R2 — Network attachments are NOT in the list response (API ≥ 1.28)

**Verified** in the v1.44 spec, `GET /networks` description: *"the list
of containers attached to the network is not propagated in API versions
1.28 and up."* `Network.Containers` (endpoint `Name`/`EndpointID`/
`MacAddress`/`IPv4Address`/…) is populated only by
`GET /networks/{id}` (`NetworkInspect`).

**Decision**: after `listNetworks()`, inspect each listed network via
`docker.getNetwork(id).inspect()` under the existing
`mapWithConcurrency(INSPECT_CONCURRENCY = 8)` — the same pattern as
container inspects. `attachedCount` = `Object.keys(Containers ??
{}).length`; `attachedContainers` = the endpoint **`Name`** values only
(ratified — MACs/IPs/endpoint IDs never leave the boundary). A failed
inspect **fails the run** — it is a `/networks`-family error, so the
ratified fail-closed policy (FR-012) applies; this is deliberately
stricter than the opt-in image-inspect degrade (authoritative
enumeration vs. additive metadata).

**Alternatives considered**: derive attachments by joining container
`NetworkSettings.Networks` + Swarm `Spec.Networks` already collected
(rejected — name/ID join ambiguity produces silently wrong attachment
lists; the engine's `Containers` map is authoritative); drop the fields
(rejected — ratified allowlist, and inspect is the API-intended path).

## R3 — Volume usage data requires `GET /system/df`

**Verified** in the v1.44 spec: `Volume.UsageData` is *"used by the
`GET /system/df` endpoint, and omitted in other endpoints"* — so
`GET /volumes` list (and `GET /volumes/{name}` inspect) never carry
`Size`/`RefCount` on modern engines. `/system/df?type=volume` returns
`Volumes[]` as full `Volume` objects **with** `UsageData{Size,
RefCount}`. `Reclaimable` does not exist in the v1.44 `UsageData`
schema — the ratified `reclaimable` field stays optional and simply
never emits on modern engines (kept for older/driver-reported shapes).

**Decision**: one `docker.df({type:"volume"})` call per run (the `type`
param accepts `container|image|volume|build-cache`, multi-value), joined
to the volume list by `Name`. `sizeBytes` ← `UsageData.Size` (omit when
`-1` = "not available"); `refCount` ← `UsageData.RefCount` (omit when
`-1`); `reclaimable` ← `UsageData.Reclaimable` when present. df failure
→ run fails (same fail-closed reasoning as R2 — usage fields are part of
the ratified inventory, not optional enrichment).

**Alternatives considered**: per-volume inspect for usage (rejected —
`UsageData` is omitted there too); drop usage fields (rejected —
ratified; one extra call delivers all of them).

## R4 — Emitted identities (ADR-120 qualified form)

**Decision**: `externalId` via `qualifyExternalId(sourceIdentity,
nativeId)` → `{sourceIdentity}::network:{scope}:{name}` and
`{sourceIdentity}::volume:{name}` — the `::` separator is
`QUALIFIER_SEPARATOR` (same as `swarm-secret:{name}` precedent; the
research doc's single-colon notation is shorthand). `scope` is the
engine-reported `Scope` verbatim (`local`/`global`/`swarm`), making
same-named networks in different scopes distinct by construction.
Volume names are daemon-unique → name alone qualifies.

`category`/`provider`/`resourceType`: `NETWORK`/`DOCKER`/`"network"` and
`STORAGE`/`DOCKER`/`"volume"` — both categories already exist in
`packages/core/src/constants/component-categories.ts`; `resourceType`
is free-form (constitution III). `name` = Docker `Name` verbatim.

## R5 — Field allowlists (ratified, unchanged)

**Network `details`** — sourced from `NetworkInspect` (full `Network`):

| `details` key | Source | Notes |
|---|---|---|
| `driver` | `Driver` | e.g. `bridge`, `overlay`, `null` |
| `scope` | `Scope` | `local`/`global`/`swarm` verbatim |
| `internal` | `Internal` | only when `true` |
| `attachable` | `Attachable` | only when `true` |
| `ingress` | `Ingress` | only when `true` |
| `configOnly` | `ConfigOnly` | only when `true` |
| `enableIPv6` | `EnableIPv6` | only when `true` |
| `createdAt` | `Created` | RFC3339 verbatim |
| `attachedCount` | `Containers` keys | from inspect (R2); `0` when none |
| `attachedContainers` | `Containers[*].Name` | endpoint names only; omitted when empty |
| `labels` | `Labels` | `allowedLabels`-equivalent prefix allowlist |

**Excluded forever** (never declared on local interfaces): `Id`,
`IPAM` (all config), `Options`, per-endpoint `EndpointID`/`MacAddress`/
`IPv4Address`/`IPv6Address`/`GlobalIPv6*`/`IPPrefixLen`/`Links`,
`ConfigFrom`/`ConfigOnly`-adjacent references, `Peers`.

**Volume `details`** — sourced from `GET /volumes` + `df` join (R3):

| `details` key | Source | Notes |
|---|---|---|
| `driver` | `Driver` | e.g. `local`, `custom` |
| `scope` | `Scope` | `local`/`global` verbatim |
| `createdAt` | `CreatedAt` | RFC3339 verbatim |
| `sizeBytes` | `df.Volumes[].UsageData.Size` | omit when `-1`/absent |
| `refCount` | `df.Volumes[].UsageData.RefCount` | omit when `-1`/absent |
| `reclaimable` | `df.Volumes[].UsageData.Reclaimable` | optional — absent on modern API |
| `labels` | `Labels` | same prefix allowlist |

**Excluded forever**: `Mountpoint` (host path), `Options` (credential/
host-path-adjacent driver opts), `Status` (free-text), `Id`/`Name`
(already the identity), `ClusterVolume` internals.

**Labels**: same bounded prefix allowlist as container labels —
`ALLOWED_LABEL_PREFIXES = ["com.docker.compose.", "componode."]` in
`mapping.ts` is module-private; `infra.ts` either exports a shared
helper from `mapping.ts` or duplicates the two-prefix check (plan-level;
prefer exporting to keep one source of truth — no importer→importer
boundary is crossed, it's intra-package).

## R6 — Emission order and failure policy

**Decision**: new `reportPhase("Inventorying infrastructure")` after the
`includeImages` block, before `reportPhase("Completed")`. One
`Promise.all([listNetworks(), listVolumes(), df({type:"volume"})])` —
parallel, and **any rejection fails the run** before any infra asset is
yielded from that batch (the lists themselves are prerequisites for
inspect/df joins; partial infra inventory is never emitted — FR-012).
Network inspects then run under `mapWithConcurrency`; each inspect
failure throws (fail-closed per R2). Emission: all networks, then all
volumes — each `validateDiscoveredAsset`-checked before yield, matching
every existing yield site.

**Swarm-scoped networks on workers** (open question from the design doc):
resolved — emit whatever the executor's API returns; no Hub/Agent
filtering (FR-013, ADR-122). If a worker cannot inspect a swarm network,
the run fails visibly rather than silently dropping it — the honest
outcome for an authoritative-inventory feature.

## R7 — Response shape normalization

`GET /networks` returns a **bare array** on modern API (the v1.44 spec
shows `type: array`); very old engines wrapped it as
`{Networks: [...]}`. `GET /volumes` returns `{Volumes: [...],
Warnings: []}`. `df` returns the `SystemDataUsageResponse` object.
**Decision**: `infra.ts` declares narrow local interfaces for exactly
the allowlisted fields and normalizes the networks list defensively
(`Array.isArray` → use; else read `.Networks`) — one-line tolerance,
zero cost. `df({type:"volume"})` query param verified against dockerode's
modem query serialization during implementation (fallback: unfiltered
`df()` and filter client-side — same data, slightly larger payload).

## R8 — Frontend rendering

**Decision**: extend `docker-details.tsx` with `networkDetailsOf` /
`volumeDetailsOf` allowlist shapers + `NetworkDetailsSection` /
`VolumeDetailsSection`, wired in `component-detail.tsx` Details card
keyed on `c.resourceType === "network" | "volume"` — identical pattern
to `EngineDetailsSection`/`ImageDetailsSection`. Component-level
`details` only — `instances: []` means no instance-expander work.
Shapers return `null` on unrecognized shapes → foreign `details` never
render (no generic dump, FR-016). `view-types.ts` unchanged
(`details` is already `Record<string, unknown>`).

## R9 — Zero contract surface (verified)

Same verification as spec 064 R8: `details` validates as
`z.record(z.string(), z.unknown()).nullable().optional()` — free-form
JSONB passthrough end-to-end. `NETWORK`/`STORAGE` categories exist; no
core schema, backend route, agent protocol, manifest, config-schema, or
`openapi.yaml` change. `docs:api`/contract tests unaffected;
`docs:importers:check` unaffected (no manifest/config change — docs page
prose updated outside GENERATED blocks).

## R10 — ADR-121 Amendment 4 outline

Amendment 4 (spec 065) extends the item-8 allowlist with the infra
inventory: `NETWORK` components from `GET /networks` + per-network
inspect (attachments), `STORAGE` components from `GET /volumes` +
`/system/df` usage join, scope/name-qualified identities, `instances:
[]` precedent, the excluded-field list (IPAM/Options/Mountpoint/
Status/endpoint addressing), and the fail-closed error policy. Restates
standing exclusions. `docs/importers/docker.md` "What it imports" gains
a infrastructure-inventory bullet documenting every collected field and
bound (prose, outside GENERATED contract blocks).
