# ADR-121 — Docker importer: agent-bound execution, target profiles, and workload identity

**Status**: Ratified (2026-11-01, spec 046)
**Supersedes**: none
**Amends**: ADR-056, ADR-065, ADR-116, ADR-117 (see "Amendments to earlier ADRs")

## Context

Wave C of the Docker importer program (`researches/docker-importer-spec-waves.md`)
ships `@componode/importer-docker` — the first adopter of the
`targetRefKey`/`resolveTarget` machinery ratified in ADR-116 A5/A6 and the
first importer that can never run in-process. Several contract surfaces
did not exist in ratified form: the typed profile schema, agent-binding
enforcement, credential-test target resolution, Docker scope keys, and
identity/externalId formats.

## Decision

1. **`@componode/importer-docker` package** — core-only deps +
   `dockerode`; registered in `IMPORTER_PACKAGES` and backend/agent
   dependency manifests in lockstep (ADR-065 A1). Manifest declares
   `reportsSourceIdentity: true`, `targetRefKey: "targetId"`, and
   `requiresAgent: true`.
2. **`ImporterManifest.requiresAgent?: boolean`** — when true, config
   create/update with `agentId: null` is rejected (`400 VALIDATION_FAILED`)
   and in-process dispatch is refused. Docker is the first (only) setter.
3. **`testSecrets(secrets, config?, resolvedTarget?)`** — third parameter
   carries the preflight-resolved `TargetProfile`; the agent's
   `handleCredentialTest` performs the same `targetRefKey` →
   `loadTargetProfile` preflight as `job.assign` and passes it through
   (fail-closed `TARGET_RESOLUTION_FAILED` on unknown/malformed/
   unprovisioned targets). No protocol change — `credential.test` already
   carries `scope`; profiles never cross the wire.
4. **Typed `docker-targets.json` profile schema** — four transports,
   validated importer-side before any network use (the core envelope
   stays provider-agnostic):
   - `socket`: `{path}` — absolute unix path or `//./pipe/` npipe.
   - `tcp`: `{host, port, caCertKey?, clientCertKey, clientKeyKey}` —
     verified mTLS; client cert+key required; `caCertKey` only for
     private CAs; no plaintext/skip-verify mode exists.
   - `ssh`: `{host, port?, user, hostKeySha256, privateKeyKey, passphraseKey?}`
     — `docker system dial-stdio`; SHA-256 host-key pin required; no
     password-only auth or implicit OpenSSH config.
   - `context`: `{name}` — allowlisted on-disk Docker Context on the
     agent; rejects `default`, `SkipTLSVerify`, and `ssh://` endpoints.
   `*Key` fields name `secrets` record keys resolved from AGENT_MANAGED
   refs (ADR-117) — profiles carry no key material.
5. **Scope keys** — `targetId` (required), `environmentLabel`,
   `environmentMap` (label value → `ENVIRONMENTS`, unmapped → `OTHER`),
   `componentIdLabel` (default `componode.component-id`),
   `includeImages` (default `false`), `sourceKey` (fallback identity).
6. **Identity/externalId formats**:
   - Source: `docker-engine:{/info.ID}`; `docker-engine:{sourceKey}` when
     the engine reports no ID; run fails otherwise.
   - Component (`CONTAINER`/`DOCKER`): `workload:{componentIdLabel}` |
     `compose:{project}:{service}` | `{sourceIdentity}::{containerName}` —
     never the mutable container ID.
   - Instance: `{sourceIdentity}::{containerId}`.
   - Image (opt-in, `PACKAGE_REGISTRY`/`DOCKER`, `instances: []`):
     `docker-image:{repo}@{digest-or-tag}`.
7. **Status mapping (Wave C)** — engine `State.Status` only:
   `running`→`RUNNING`, `created`/`paused`/`exited`→`STOPPED`,
   `dead`/`restarting`/`removing`/unknown→`ERROR`. Health-check results
   do not influence Wave C status; `dockerObservation` and health-aware
   rules are Wave D.
8. **Data minimization** — allowlisted persistence: image ref/digest,
   published ports, network/volume names, mount `{type, destination,
   opaqueRef}` (bind sources as `bind:{containerId}:{destination}` refs),
   bounded label subset, state/exit facts. Never: `Env`, raw bind paths,
   inspect JSON, health output/test commands, secret material.
9. **Deferred** — `dockerObservation` + health-aware status + Source UI +
   tag suggestions (Wave D); Swarm (Wave E); `ssh://` context endpoints.

## Amendments to earlier ADRs

- **ADR-056** (importer contract): `testSecrets` gains the optional
  `resolvedTarget` parameter (item 3).
- **ADR-065** (package boundaries): `@componode/importer-docker` joins
  the in-tree lockstep set — anticipated by Amendment 1; now concrete.
- **ADR-116** (remote agents): first `targetRefKey`/`resolveTarget`
  adopter landed; typed docker profile schema ratified here (item 4);
  credential-test path performs target preflight (item 3).
- **ADR-117** (agent-managed credentials): profile `*Key` indirection
  composes AGENT_MANAGED refs with target profiles (item 4).

## Amendment 1 — Health-aware status and `dockerObservation` (spec 047)

Wave D replaces item 7's engine-state-only rule and extends item 8's
allowlist:

1. **`rawConfig.dockerObservation`** — each Instance persists an
   allowlisted snapshot: `state`, `exitCode` (non-zero only),
   `oomKilled`/`restarting` (true only), `startedAt`/`finishedAt`
   (Docker zero-time → `null`), and `health` = `{status, failingStreak?}`
   or `null` when no health check is configured (`"none"` → `null`).
   Still never: `/stats`, events, `Health.Log` (check output),
   `Config.Healthcheck.Test` (test command), full inspect JSON, history.
   The allowlisted fields render on the component detail's Instances
   table — no Docker-specific monitoring page.
2. **State × health → `InstanceStatus`** — `running` → `RUNNING` unless
   `Health.Status == "unhealthy"` (`ERROR`); `starting` health is
   inconclusive (`RUNNING`); `OOMKilled` overrides any state to `ERROR`
   (including `exited`); `created`/`paused`/`exited` → `STOPPED`;
   `dead`/`restarting`/`removing`/unknown/`undefined` → `ERROR`; absent
   from a completed run → `GONE` via unchanged source-scoped
   reconciliation. Non-zero `exitCode` alone does not escalate `exited`.
   ADR-112 derived product health consumes the emitted status — no
   rollup changes.
3. **Generic ImporterSource UI + tag suggestions** — `/sources` +
   `/sources/:id` surfaces on the existing API (no contract change);
   `compose:<project>`/`service:<project>.<service>` edit-dialog
   suggestions are user-confirmed, grammar-filtered derivations — no
   contract surface, recorded here for provenance only.
4. Item 9's deferred list shrinks: Swarm (Wave E) and `ssh://` context
   endpoints remain.

## Amendment 2 — Swarm inventory (spec 048)

Wave E extends the importer's emitted surfaces on Swarm managers:

1. **Discovery gate** — Swarm inventory runs iff
   `info.Swarm.LocalNodeState === "active"` AND `ControlAvailable === true`,
   using the `/info` call already made for engine identity; non-Swarm and
   worker-only endpoints make zero additional calls. `ApiVersion >= 1.41`
   (for `status=1` → `ServiceStatus`) is required when Swarm is detected;
   below floor → coded run failure — a partial Swarm inventory is never
   emitted.
2. **Entity mappings** — each service → `CONTAINER_ORCHESTRATION`
   Component (`swarm-service`) with one aggregate Instance per
   environment (envLabel/envMap, default OTHER); each node → `COMPUTE`
   Component (`swarm-node`) with one status-bearing Instance; each
   secret → metadata-only `SECRET` Component (`swarm-secret`),
   `instances: []`, contents never read. Service-referenced
   secrets/configs are bounded `{id,name}` references on details — no
   `CONFIG` components, no content.
3. **Status tables** — service: `running===desired>0 → RUNNING`,
   `running<desired → ERROR`, `desired===0 → STOPPED`, absent → `GONE`
   (replicated and global alike — `ServiceStatus` manager counts; per-task
   health is never inferred). Node: `ready`+`active` → `RUNNING`,
   `drain`/`pause` → `STOPPED`, `down`/`disconnected`/unreachable/unknown →
   `ERROR`, absent → `GONE`.
4. **`swarmObservation` / `swarmNodeObservation` allowlists** — bounded
   manager-reported facts only (`mode`, `desired`, `running`,
   `completed?`, `updateState?`, `observedAt`; node: `role`,
   `availability`, `reachability`, `leader`, `state`, `addr`). Still
   never: task lists, task inspect, logs, events, contents, raw swarm
   objects.
5. **Identities** — component externalIds are name-based
   (`{src}:swarm-{service,node,secret}:{Spec.Name}`; stack prefix keeps
   same-named services distinct); instance externalIds carry the
   resource `ID` so they survive rename. Compose-to-Swarm transitions
   produce distinct components — no automatic product-edge transfer.
6. Item 9's deferred list now stands at `ssh://` context endpoints only.

## Amendment 3 — Observation enrichment, engine component, image inspect (spec 064)

Extends items 6/8 and the Amendment-2 Swarm surfaces:

1. **Container instance `rawConfig` additions** — `imageId` (the
   immutable `sha256:` `inspect.Image`, joining image assets), bounded
   `hostConfig` (`memoryBytes`, `nanoCpus`, `pidsLimit`,
   `restartPolicy{mode, maxRetries?}`, `privileged`/`readOnlyRootfs`
   only when true, `logDriver`), and `healthcheck` timings in seconds
   (`intervalSeconds`, `timeoutSeconds`, `retries`,
   `startPeriodSeconds`). `Config.Env`, `Healthcheck.Test`,
   `HostConfig.Binds`, and `LogConfig.Config` remain undeclared —
   never collected. `dockerObservation` stays state/health-status only;
   configuration facts live outside it.
2. **Swarm service enrichment** — instance `rawConfig` gains `ports[]`
   (`protocol`/`target`/`published`/`publishMode?` from
   `Spec.EndpointSpec.Ports`) and `networks[]`
   (`Spec.Networks[].Target`); `swarmObservation.mode` and
   `details.mode` gain `replicated-job`/`global-job` (job `Mode`
   members checked before replicated/global). Job services remain
   `CONTAINER_ORCHESTRATION` — mode is an observation, not a category.
3. **Engine component** — exactly one `COMPUTE`/`docker-engine`
   Component per source on every transport and executor, emitted after
   `reportSourceIdentity` and before inventory; `externalId` is the
   source identity verbatim (no `::` qualifier, no double-prefixing);
   one `OTHER`/`RUNNING` Instance with empty `rawConfig`. `details`
   carries bounded `/info` + one `/version`-per-run facts:
   `serverVersion`, `apiVersion`, `os`, `arch`, `kernelVersion`,
   `cgroupDriver?`, `runtimes?`, `registryMirrors?`, `swarmNodeState?`,
   `swarmControlAvailable?`, `swarmManagers?`. Still never:
   `DockerRootDir`, proxy variables (any case), `Plugins`,
   `SecurityOptions`, `Warnings`, or any other unapproved
   `/info`/`/version` field.
4. **Image inspect (opt-in)** — `includeImages` on → each unique
   `image.Id` inspected once (`GET /images/{id}/json`, concurrency ≤ 8)
   and a bounded merge added to every ref asset's `details`:
   `ociLabels` (exactly the 10-key `org.opencontainers.image.*`
   allowlist), `exposedPorts`, and when reported `user`, `entrypoint`,
   `workingDir`, `volumes`, `architecture`, `os`. A failed inspect
   omits the merge for that image only — the asset still emits and the
   run is unaffected (ratified degrade-per-image). Off → zero inspect
   calls and byte-identical image output.
5. **UI** — named allowlist sections only (observation, host config,
   health-check definition, ports, networks on instances; engine and
   image-provenance sections on the Details card); no generic
   `rawConfig`/`details` dump.

## Amendment 4 — Infrastructure inventory: networks and volumes (spec 065)

Extends the item-8 allowlist with bounded infrastructure components:

1. **NETWORK components** — one per `GET /networks` entry per source,
   `provider: DOCKER`, `resourceType: network`, `category: NETWORK`,
   `instances: []`. Identity is
   `qualifyExternalId(sourceIdentity, "network:{scope}:{name}")` —
   scope-qualified so same-named `local` and `swarm` networks stay
   distinct. `details` carries only: `driver`, `scope`, `createdAt`,
   `internal`/`attachable`/`ingress`/`configOnly`/`enableIPv6` (only
   when true), `attachedCount`, `attachedContainers` (endpoint *names*
   only), and `labels` through the shared prefix allowlist
   (`com.docker.compose.*`, `componode.*`).
   Attachment names come from `GET /networks/{id}` inspect — the list
   omits `Containers` on API ≥ 1.28 — inspected once per network at
   concurrency ≤ 8. Still never: IPAM subnets/gateways/auxiliary
   addresses, per-endpoint `EndpointID`/`MacAddress`/`IPv4Address`/
   `IPv6Address`/`GlobalIPv6Address`, network `Options`, or any other
   unapproved field.
2. **STORAGE components** — one per `GET /volumes` entry per source,
   `resourceType: volume`, `category: STORAGE`, `instances: []`.
   Identity is `qualifyExternalId(sourceIdentity, "volume:{name}")`.
   `details` carries only: `driver`, `scope`, `createdAt`,
   `sizeBytes`/`refCount`/`reclaimable` joined by `Name` from one
   `GET /system/df` call per run (`UsageData`; omitted when absent or
   `-1`), and allowlisted `labels`. Still never: `Mountpoint`,
   `Options`, `Status`, host paths, or credential-adjacent driver
   options.
3. **Fail-closed sourcing** — `listNetworks`, `listVolumes`, and `df`
   are fetched together before any infra yield, and all network
   inspects complete first; any endpoint or inspect error fails the
   run, so partial infrastructure inventory is never emitted.
4. **UI** — named `Network`/`Volume` sections on the Details card via
   allowlist shapers; unknown `details` keys never render, and
   foreign shapes render nothing.

---

**Amended by ADR-122**: item 2 — Docker is no longer `requiresAgent`; Hub execution resolves managed `docker_targets` profiles (spec 049).
