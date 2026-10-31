# Docker Importer Planning Notes

**Status:** Unnumbered planning material. No feature number, spec-kit spec, ADR, or executable tasks have been assigned. The research source is [docker-importer-research.md](./docker-importer-research.md); scenarios are in [docker-importer-scenarios.md](./docker-importer-scenarios.md); candidate future spec waves are in [docker-importer-spec-waves.md](./docker-importer-spec-waves.md).

## Purpose

Offer a useful, point-in-time Docker inventory for the Componode catalog: stable workload Components, operational Component Instances, and Docker-reported health/state observations that can inform the existing product status rollup when a person has wired the Component to a Digital Product.

The importer does not create Digital Products, add graph edges, manage Docker, stream events, or collect CPU/memory/network metrics.

## Binding Componode constraints

- Digital Products are human-authored; the importer emits Components and Component Instances only.
- `DiscoveredAsset` has no relationships field. `COMPOSES` is a DigitalProduct-to-DigitalProduct relationship; it cannot connect a Compose project Component to workload Components.
- `ComponentGroup` represents a human-declared equivalence and is not an importer-created folder/project.
- `ComponentInstance.status` is one of `RUNNING`, `STOPPED`, `ERROR`, `GONE`. There is no `ComponentInstance.health` field.
- ADR-112 computes product status from direct Component dependencies' non-GONE instance statuses. It does not roll health into LineOfBusiness or Team records.
- Instance disappearance and Component retirement are reconciled by the backend after a completed run. `GONE` is not a Docker transitional state.

Anchors: `CONTEXT.md`; `packages/core/src/contracts/discovered-asset.ts`; `packages/core/src/contracts/component-instance.ts`; ADR-034, ADR-036, ADR-057, ADR-112, ADR-113.

## Confirmed decisions

| Decision           | Confirmed direction                                                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection modes   | All four requested modes remain in scope: local socket/named pipe, TCP/TLS, SSH, and Docker Context. All Docker calls run through an assigned Import Agent.                                                                                                                            |
| Compose model      | One logical `CONTAINER` Component per containerized workload; concrete Docker containers are its Component Instances. A Compose Project or Compose Service is not a separate Componode entity.                                                                                         |
| Compose labels     | Project/service labels are source metadata and optional user-confirmed tag suggestions. They create no Componode edge.                                                                                                                                                                 |
| Compose identity   | Use a canonical logical project key + service key; allow a stable per-workload ID label/mapping to preserve identity when names differ or a service is renamed. The daemon ID is not part of the shared Component ID.                                                                  |
| Swarm model        | One `CONTAINER_ORCHESTRATION` Component per logical Swarm Service with an aggregate Component Instance per environment. Tasks remain observations. Nodes are `COMPUTE` Components; metadata-only secrets are `SECRET` Components with no instances; Configs remain service references. |
| Discovery defaults | Include running and stopped containers; auto-discover Swarm resources when active and manager-accessible; local-image inventory is opt-in and defaults off; networks and volumes remain workload metadata. No free-form label/status filters in the first wave.                        |
| Health             | Point-in-time observations map to existing `InstanceStatus` values only; no `ComponentInstance.health` field, metrics, event stream, or real-time monitoring.                                                                                                                          |
| Mount path         | Retain a redacted bind-source representation plus mount type/destination and an importer-local reference derived from instance ID + destination; never persist the raw host path.                                                                                                      |
| Source lifecycle   | A durable `ImporterSource` is distinct from an editable config. Source-scoped reconciliation is the generic core standard; all importers migrate in documented stages.                                                                                                                 |

## Catalog model

| Docker concept                             | Confirmed Componode representation                                                                                                                    | Rationale / boundary                                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Compose workload (e.g. `web`, `api`, `db`) | One logical `CONTAINER` Component per workload; one Component Instance per concrete container occurrence                                              | The Compose project groups workloads but is not a Component. `com.docker.compose.project` and `.service` remain source metadata.                                         |
| Standalone workload                        | One logical `CONTAINER` Component using an explicit stable label, falling back to daemon-scoped container name; container ID is the instance identity | A container ID changes on recreate; it must not be the logical Component key. Rename without an override creates a new Component.                                        |
| Swarm Service                              | One `CONTAINER_ORCHESTRATION` Component per logical service; one aggregate Component Instance per environment with desired/running/task observations  | Do not create one Component per ephemeral task. A Compose-to-Swarm transition is a distinct Component category and does not transfer Product edges automatically.        |
| Swarm Node                                 | One source-scoped `COMPUTE` Component and one Component Instance                                                                                      | Store node ID/state/availability. Do not infer a Service or Product relationship.                                                                                        |
| Swarm Secret                               | Source-scoped `SECRET` Component with `instances: []`; metadata only                                                                                  | Secret data is never read or stored. An empty instance list is valid for a source-only object; do not use it for a workload whose instances are temporarily unavailable. |
| Swarm Config                               | Config name/ID/target reference in the Swarm Service metadata                                                                                         | No `CONFIG` category exists; do not force it into an unrelated category or store config content.                                                                         |
| Image                                      | Store deployed image reference/digest on the workload Component Instance; optional local-image inventory remains off by default                       | Cached base images are often noise and are not proof of a product dependency.                                                                                            |
| Network / named volume                     | Store safe names/references on the workload observation, not separate Components                                                                      | Docker attachments do not create Componode edges.                                                                                                                        |
| Docker Compose project                     | Shared source metadata on workload Components and their source/instance observations                                                                  | No project Component and no `COMPOSES` edge. A Digital Product can depend directly on selected workload Components.                                                      |

### Identity and source ownership

- Source identity is non-secret and canonical. For URL-based sources, remove userinfo, authentication query parameters, and fragments from persisted/displayed identity; use a safe label or explicit source key if the URL cannot be safely canonicalized.
- `ImporterSource` is a durable internal UUID v7 record, distinct from a connection target and from the editable `ImporterConfig`. The importer reports source identity before yielding assets, including when the inventory is empty.
- Source identity uses a provider-native canonical key where available (Docker Engine `/info.ID`, GitHub organization ID, cloud account/subscription ID, cluster UID, or endpoint identity). Use an explicit stable source key only when the provider has no trustworthy identity; never match Sources by display name.
- One active `ImporterConfig` binds to a Source. Replacing a config can reattach to the same Source. Source state is `ACTIVE`, `UNMONITORED`, or `RETIRED`; deleting the config makes the Source unmonitored but preserves its identity and ImportRun history. Retirement is explicit and reversible.
- Compose Component `externalId` is a stable logical project/workload key + service key, not daemon ID. A `componode.component-id` label or configured mapping overrides the default to preserve identity across project/service renames. The canonical project/service values live in shared Component details.
- Standalone Components use an explicit stable workload label or fall back to daemon identity + container name. A rename without an override is a new Component.
- Container Component Instance `externalId` includes daemon/source identity + container ID. Rebuilds create a new Instance under the same logical Component; the previous Instance becomes GONE after a complete source run.
- Swarm Service Components use a stable service identity label/mapping or a consistent stack namespace + service name. Their aggregate Instance identity includes target/source identity + Swarm service ID. Node and Secret Components remain source-scoped.
- Component and Component Instance source memberships are durable records keyed by `ImporterSource.id`, independent of `lastSeenInRunId` and ImportRun retention. A source run reconciles only its own memberships. A shared Component/Instance remains active while any Source membership is active.
- Stable shared facts belong in `Component.details`; source-specific metadata belongs in the Source membership; per-deployment Docker observations belong in `ComponentInstance.rawConfig.dockerObservation`. This prevents last-writer-wins loss across environments.

### Environment

Use an explicitly configured environment label key/value mapping. For container Instances, read the configured label from container labels first, then the Compose service labels when available. For a Swarm aggregate Instance, use service labels. Unmapped values default to `OTHER`; do not infer `PRODUCTION` from daemon reachability. The mapping shape must make clear which labels are keys and which values map to Componode environments.

## Point-in-time health and status policy

Persist an allowlisted source snapshot under `instances[].rawConfig.dockerObservation`; never persist full Docker inspect JSON. Preserve Docker's latest check time separately from Componode's instance `lastSeenAt`/ImportRun timestamp. The observation is a snapshot, not live health.

| Docker observation                                      | `ComponentInstance.status`                  | Rule                                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine says running; health check says healthy          | `RUNNING`                                   | Preserve the source health status/time separately.                                                                                                    |
| Engine says running; health check says unhealthy        | `ERROR`                                     | ADR-112 can surface this status to directly wired Digital Products.                                                                                   |
| Health check starting or no `State.Health` object       | Follow Engine state (`RUNNING` if running)  | Preserve `starting` or `notConfigured`; do not invent `DEGRADED` or a Docker status `none`.                                                           |
| Paused, created, or cleanly exited                      | `STOPPED`                                   | Preserve exact state and exit code in the observation.                                                                                                |
| Dead, restarting, non-zero exit, or current OOM failure | `ERROR`                                     | Cumulative `RestartCount` alone is context, not proof of current failure.                                                                             |
| Missing from a successful, complete source inventory    | `GONE`                                      | Only reconciliation produces GONE; not a Docker transition such as `removing`.                                                                        |
| Replicated Swarm Service below desired task count       | `ERROR`                                     | Use API v1.41+ `ServiceStatus`; desired count zero is `STOPPED`.                                                                                      |
| Global Swarm Service                                    | Use manager-reported desired/running counts | Do not apply replicated-service assumptions or infer missing counts.                                                                                  |
| Swarm update/rollback paused                            | Keep as source observation                  | Do not mark `ERROR` solely for rollout status when current service availability is met.                                                               |
| Swarm Node `ready` / `down`                             | `RUNNING` / `ERROR`                         | `pause` and `drain` are availability metadata, not failure states. Missing/unrecognized node states fail that observation rather than assert healthy. |

Swarm Task objects do not include container health-check status. This release uses manager-reported service/task state; it does not inspect containers on worker nodes. No `ComponentInstance.health` field is added. Product health remains ADR-112's derived status over human-curated direct Component dependencies; there is no automatic LOB/Team rollup or importer-declared relationship.

## Inventory scope

- Containers: include running and stopped container instances; Compose project/service labels are metadata.
- Swarm: auto-detect. Enumerate services, tasks, nodes, secrets, and configs only from a manager-capable target; a selected inventory failure fails the run.
- Require API v1.41+ for Swarm `ServiceStatus`, but negotiate using `/version` and the daemon's advertised `MinAPIVersion`/`ApiVersion`; do not hard-pin a v1.41 request if the server requires a higher floor.
- Images: local image inventory is opt-in and defaults off. Keep the deployed image reference/digest on the workload observation.
- Networks/volumes: safe names/references only on workload observations; no separate Components.
- Secrets: source-scoped `SECRET` Components with metadata and `instances: []`; never read secret content.
- Configs: names/IDs/target paths as metadata on Swarm Service observations; no separate Component because there is no `CONFIG` category; never read config content.
- No free-form label/status filters in v1; the configured source is a complete inventory boundary.
- No stats, event stream, time series, alert evaluation, or source mutations.

## Agent execution, target profiles, and credentials

- Every Docker importer config is Agent-bound; direct hub execution is unsupported.
- The assigned Agent reads a read-only, versioned target registry at `${SECRETS_DIR}/docker-targets.json` before each run. Each target profile is one Docker daemon with an immutable `targetId`; changing endpoint/transport means creating a new profile ID.
- The importer config scope contains a plain `targetId`. `manifest.targetRefKey` declares it; the Agent validates it before importer execution and resolves the non-secret transport profile through the typed `ImporterContext` target resolver.
- Unknown/malformed profiles fail before network access. The Agent remains ready for other importers. Egress allowlists remain defense-in-depth.
- Local socket/named-pipe paths are Agent-provisioned (common candidates: Linux `/var/run/docker.sock`, macOS `~/.docker/run/docker.sock`, Windows `//./pipe/docker_engine`); explicit mount is required.
- TCP uses mutual TLS and always verifies the server. `caCert` is needed for a private CA; otherwise use Agent/system trust. `clientCert` and `clientKey` are required. No plaintext or skip-verification mode.
- SSH uses explicit host/user/port, a private key, optional key passphrase, and a SHA-256 host-key pin. Do not use password-only SSH, implicit OpenSSH config, or aliases. The remote host must have Docker CLI for `docker system dial-stdio`.
- Context mode accepts only named, allowlisted, on-disk Docker Contexts on the Agent. Resolve metadata and TLS files inside the selected context store; reject the in-memory `default` Context and `SkipTLSVerify`. Context TLS files stay on the Agent; direct TCP/SSH credentials use AGENT_MANAGED bundles.
- AGENT_MANAGED credential bundles are distinct per Agent/target because credential rows are not Agent-scoped. `testSecrets` validates the selected mode with a minimal read probe and actionable non-secret errors; it never runs a full inventory.

## Source lifecycle and reconciliation

- Each `ImporterSource` is a durable UUIDv7 record with a provider-native external identity; an Admin-supplied stable key is the fallback where no trustworthy provider identity exists. Source identity is reported before assets, including when the inventory is empty. The Source record is internal provenance, not a catalog Component.
- One active `ImporterConfig` attaches to a Source. The importer config is editable execution/schedule/credential state; the Source is the longer-lived identity and ownership boundary.
- Add durable per-Source membership records for both Components and Component Instances. They record source observations independently of `lastSeenInRunId` and ImportRun foreign keys; source-specific Component details are retained on the membership rather than overwritten by the latest source.
- ImportRuns carry a durable `sourceId`; `configId` becomes nullable with `ON DELETE SET NULL`. Config deletion removes its schedule/credential links and marks the Source `UNMONITORED`, but preserves the Source, Source memberships, and ImportRun history.
- A complete run marks only its own absent Component/Instance memberships inactive. Instances become GONE only when no active Source reports them. A shared Component remains ACTIVE while any Source reports it and is retired only when no active Source remains.
- Retiring a Source deactivates its memberships; it does not retire a shared Component that another Source still reports. A retired Source can reactivate when the same provider identity returns.
- Any authoritative selected API failure fails the run; no partial snapshot may trigger retirement. Active Swarm without manager access is an incomplete inventory, not an empty Swarm.
- The source scope is complete: no arbitrary filters. A deliberate scope change that omits previously yielded assets is an explicit reconciliation change.
- Migrate existing data conservatively: backfill source memberships only where surviving run provenance proves them; preserve ambiguous records as legacy/unattributed; never auto-split, merge, or rekey Components.

## Security and user experience

- Persist allowlisted fields only: no environment variables, full inspect JSON, raw bind paths, health output/commands, Swarm Secret contents, or Config data. Preserve the agreed redacted bind-path clue and target/destination reference.
- Use bounded concurrency for container inspect calls. Do not claim list pagination/streaming without SDK/API evidence; measure run duration.
- Reuse schema-driven importer config/run forms and generic credentials. The target ID is a plain text field validated by the Agent; no custom target picker in v1.
- Component detail keeps the existing Instance status badge/last-seen view. The source snapshot remains stored but raw JSON is not displayed.
- Component edit may offer normalized `compose:<project-slug>` and `service:<service-slug>` tags as optional chips; only user-confirmed tags are saved. Values must pass the existing tag grammar/32-character limit; omit invalid or overlong suggestions rather than truncating. Preserve full source labels in details.
- Source list/detail is part of the generic Importers operations area, with Source status, attached config, last complete run, reattachment, and explicit retire action.
- Required guide: `docs/importers/docker.md`, linked from `docs/importers/index.md` and the VitePress sidebar, following `docs/importer-development.md`.

## Ratified decisions still required before implementation

- Amend ADR-036 for source-scoped reconciliation and source lifecycle; define the Source-membership storage and config/source retirement transaction.
- Amend ADR-056 for source identity reporting, target resolver, and per-Source importer contract; update the `ImporterManifest` with `targetRefKey`.
- Amend ADR-116 for the Agent-local target registry and target preflight/allowlist policy; the Agent protocol/config surface must be documented.
- Amend ADR-065 for the Docker importer package in the hub/Agent lockstep set.
- Define source-key providers for each existing importer and document the staged migration/backfill limitations before calling the source model universal.

Feature numbering remains undecided. These are research/planning notes, not numbered spec-kit artifacts or executable tasks.
