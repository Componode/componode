# Research: Docker importer enrichment (spec 064)

Phase 0 output — every NEEDS CLARIFICATION resolved against the ratified
design (`researches/docker-importer-enrichment-pack.md`), the current
importer source, and the core contract. No external research needed: all
facts verified in-repo.

## R1 — Engine facts carrier: component `details` (clarified)

**Decision**: the bounded engine fact set lives in the engine component's
`details`; its single instance carries state only (`RUNNING`, empty
`rawConfig`).

**Rationale**: user ruling at clarify. Matches the existing split —
`details` holds classification/canonical facts (`workloadKind`,
`composeProject`, `imageRef` on containers; `mode`, `secretRefs` on swarm
services), `rawConfig` holds per-instance observations. Engine facts are
source-level, not per-environment.

**Alternatives considered**: instance `rawConfig.engineObservation`
(rejected — observation blocks are runtime state snapshots; engine facts
are static-ish component attributes); split carrier (rejected — one
instance per component makes the split pointless).

## R2 — Engine component identity

**Decision**: `category: "COMPUTE"`, `provider: "DOCKER"`,
`resourceType: "docker-engine"`, `externalId` = `sourceIdentity` verbatim
(e.g. `docker-engine:{info.ID}` — already qualified, never passed through
`qualifyExternalId`), `name` = `info.Name ?? engineId ?? sourceKey`.
Instance: `instanceExternalId(sourceIdentity, "engine")`,
`environment: "OTHER"`, `status: "RUNNING"`, `rawConfig: {}`.

**Rationale**: `resourceType` is a free-form string (constitution III —
`"swarm-node"`, `"image"`, `"swarm-service"` precedent); `COMPUTE` is an
existing category — no enum/CHECK changes. The source identity is already
globally unique (`docker-engine:{daemon ID}`), matching ADR-120's
"globally-unique IDs stay unqualified" rule — `isQualifiedExternalId`
correctly reports it unqualified, and adopt-on-report matches by exact
`externalId`. Two targets on the same engine report the same
`docker-engine:{id}` identity → same ImporterSource (rebind-on-report) →
one engine component, which is the desired "per source" semantics.

**Alternatives considered**: `qualifyExternalId(sourceIdentity,
"docker-engine")` → `docker-engine:{id}::docker-engine` (rejected —
double-prefix, explicitly forbidden by the design doc); new `resourceType`
enum value or category (rejected — taxonomy change unjustified).

## R3 — Engine data sourcing and field map

**Decision**: call `docker.version()` once per run, hoisted before the
Swarm gate; the gate reuses the result. `docker.info()` is already
fetched unconditionally for source identity.

| `details` key | Source |
|---|---|
| `serverVersion` | `info.ServerVersion ?? version.Version` |
| `apiVersion` | `version.ApiVersion` |
| `os` | `info.OperatingSystem ?? version.Os` |
| `arch` | `info.Architecture ?? version.Arch` |
| `kernelVersion` | `info.KernelVersion ?? version.KernelVersion` |
| `cgroupDriver` | `info.CgroupDriver` (optional) |
| `runtimes` | `Object.keys(info.Runtimes ?? {})` (optional) |
| `registryMirrors` | `info.RegistryConfig?.Mirrors ?? []` (optional, omit when empty) |
| `swarmNodeState` | `info.Swarm?.LocalNodeState` (optional) |
| `swarmControlAvailable` | `info.Swarm?.ControlAvailable` (optional) |
| `swarmManagers` | manager summary from `info.Swarm` when reported (optional — implementation verifies the exact `/info` shape against dockerode's `Info` typing; omit when absent) |

**Excluded** (never declared on the local interface): `DockerRootDir`,
`HTTPProxy`/`HTTPSProxy`/`FTPProxy`/`NO_PROXY` (any case), `Plugins`,
`SecurityOptions`, `Warnings`, `HostConfig`-adjacent daemon knobs.

**Rationale**: `/version` is a single cheap metadata call, not inventory —
FR-013 permits it ("no additional inventory or per-resource calls"). On
Swarm engines it replaces the gate's own call (net zero); on non-Swarm it
is the one added call per run. Alternatives: skip `apiVersion` off-Swarm
(rejected — inconsistent facts between engines); parse `apiVersion` from
`/info` (rejected — `/info` does not reliably carry it).

## R4 — Container instance field mapping

**Decision**: extend `ContainerInspect` (mapping.ts) with optional
`Image?: string`, `HostConfig?`, and `Config.Healthcheck?` — `Test` is
deliberately undeclared (same pattern as `State.Health.Log`).

| `rawConfig` key | Source | Notes |
|---|---|---|
| `imageId` | `inspect.Image` | `sha256:` ID; joins `details.imageId` on image assets |
| `hostConfig.memoryBytes` | `HostConfig.Memory` | bytes, optional |
| `hostConfig.nanoCpus` | `HostConfig.NanoCpus` | optional |
| `hostConfig.pidsLimit` | `HostConfig.PidsLimit` | optional |
| `hostConfig.restartPolicy` | `HostConfig.RestartPolicy` | `{mode: Name, maxRetries?: MaximumRetryCount}` — `maxRetries` only when `> 0` |
| `hostConfig.privileged` | `HostConfig.Privileged` | only when `true` |
| `hostConfig.readOnlyRootfs` | `HostConfig.ReadonlyRootfs` | only when `true` (API spelling `ReadonlyRootfs`) |
| `hostConfig.logDriver` | `HostConfig.LogConfig?.Type` | optional |
| `healthcheck.intervalSeconds` | `Config.Healthcheck.Interval / 1e9` | ns→s, rounded |
| `healthcheck.timeoutSeconds` | `Config.Healthcheck.Timeout / 1e9` | optional |
| `healthcheck.retries` | `Config.Healthcheck.Retries` | optional |
| `healthcheck.startPeriodSeconds` | `Config.Healthcheck.StartPeriod / 1e9` | optional |

`hostConfig`/`healthcheck` objects are omitted entirely when the engine
reports nothing; `dockerObservation` is untouched (state/health-status
only). Container `ports`/`networks`/`mounts` already exist — unchanged.

**Rationale**: nanosecond fields convert to seconds for readability;
booleans emit only when true (matches `oomKilled`/`restarting`
convention); every key optional — older engines simply omit.

## R5 — Swarm service field mapping

**Decision**: extend `SwarmService.Spec` with `EndpointSpec?: {
Ports?: {Protocol?, TargetPort?, PublishedPort?, PublishMode?}[] }`,
`Networks?: {Target?}[]`, and `Mode` gains `ReplicatedJob?: object` /
`GlobalJob?: object`.

| Emitted | Source | Notes |
|---|---|---|
| `rawConfig.ports[]` | `Spec.EndpointSpec.Ports` | entries `{protocol, target, published, publishMode?}` — `published` only when `PublishedPort` set; shares the `ports` key name with container instances (entry shape differs by design — swarm entries are flat) |
| `rawConfig.networks[]` | `Spec.Networks[].Target` | network names/IDs as reported |
| `swarmObservation.mode` | `Spec.Mode` | `replicated-job`/`global-job`/`global`/`replicated` — job detection checked **before** the replicated/global fallbacks |
| `details.mode` | same | stays in lockstep with the observation |

Job services remain `CONTAINER_ORCHESTRATION` — mode is an observation,
no `JOB` category (constitution III — no taxonomy change).

**Rationale**: `Spec` arrives free inside `listServices` — zero extra
calls. Mode precedence matters: `ReplicatedJob`/`GlobalJob` are distinct
`Mode` members, not flags on `Replicated`/`Global`.

## R6 — Image inspect (opt-in)

**Decision**: rework the `includeImages` block to (1) build the full
ref→asset descriptor list first, (2) dedupe `image.Id`, (3) inspect each
unique ID via `docker.getImage(id).inspect()` under
`mapWithConcurrency(INSPECT_CONCURRENCY)`, (4) merge bounded details into
every asset sharing that `Id`, (5) yield. Per-image `try/catch` → failed
inspects emit the asset with today's details only (ratified
degrade-per-image).

| `details` key (merged) | Source (`/images/{id}/json`) |
|---|---|
| `ociLabels` | `Config.Labels` filtered to the 10-key `org.opencontainers.image.*` allowlist |
| `exposedPorts` | `Object.keys(Config.ExposedPorts ?? {})` |
| `user` | `Config.User` (optional) |
| `entrypoint` | `Config.Entrypoint` (optional) |
| `workingDir` | `Config.WorkingDir` (optional) |
| `volumes` | `Object.keys(Config.Volumes ?? {})` |
| `architecture` | top-level `Architecture` |
| `os` | top-level `Os` |

OCI allowlist (exactly these 10): `org.opencontainers.image.source`,
`.revision`, `.version`, `.vendor`, `.licenses`, `.description`,
`.title`, `.url`, `.documentation`, `.source-label`.

**Rationale**: `details.imageId` already exists on image assets
(`image.Id` from `listImages`) and container `inspect.Image` is the same
`sha256:` ID space — the join key needs no migration. Dedupe is required
because one image yields one asset **per ref** (RepoDigests/RepoTags) —
N tags must not mean N inspects. Degrade-per-image was ratified at
clarify; inspect is additive metadata, not authoritative enumeration, so
the fail-closed rule does not apply.

**Alternatives considered**: list-only enrichment from `GET
/images/json` (rejected at design time — full inspect chosen);
fail-run on inspect error (rejected — ratified degrade); inspect by ref
instead of ID (rejected — ID dedupe is exact).

## R7 — Frontend rendering

**Decision**: extract allowlisted renderers into
`ux/components/catalog/docker-details.tsx`; `component-detail.tsx`
generalizes the instance expander from "dockerObservation only" to "any
known block present" and adds resourceType-keyed sections to the Details
card.

- Instance expander shows named sections for whichever allowlisted keys
  exist: existing `dockerObservation` (unchanged), new `hostConfig`,
  `healthcheck`, `ports`, `networks`, and job-mode values inside
  `swarmObservation`.
- Details card: `resourceType === "docker-engine"` → engine section;
  `resourceType === "image"` → provenance section (`ociLabels` + inspect
  fields). Sections render only keys the allowlist shaper recognizes —
  unknown `details`/`rawConfig` keys never render (no generic dump).
- `view-types.ts` needs no changes: `Component.details` and
  `ComponentInstance.rawConfig` are already `Record<string, unknown>`.

**Rationale**: matches the existing `dockerObservationOf` +
`ObservationDetails` pattern; keeps `component-detail.tsx` small by
housing the growing field renderers in a sibling module.

## R8 — Zero contract surface

**Verified**: `rawConfig`/`details` validate as
`z.record(z.string(), z.unknown()).nullable().optional()` in
`packages/core/src/validation/discovered-asset.ts` — free-form JSONB
passthrough end-to-end (importer → run service → `components.details` /
`component_instances.rawConfig` → API → view types). No core schema,
backend route, agent protocol, manifest, or `openapi.yaml` change.
`docs:api`/contract tests unaffected.

## R9 — ADR-121 Amendment 3 outline

Amendment 3 (spec 064) extends the item-8 allowlist: container
`imageId`/`hostConfig`/`healthcheck`, swarm `ports`/`networks`/job-mode,
the always-emitted `docker-engine` COMPUTE component (details-carried
facts, explicit exclusions), and opt-in image inspect details (OCI
allowlist + degrade-per-image). Restates standing exclusions.
`docs/importers/docker.md` "What it imports"/"Swarm inventory" sections
gain the new fields (prose, outside the GENERATED contract block — no
config fields change).
