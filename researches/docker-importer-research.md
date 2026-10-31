# Docker Importer Research

**Status:** Unnumbered research and planning input. This is not a feature spec, an ADR, or executable implementation tasks. Feature numbering is intentionally undecided.

## Purpose and fit

Componode is an importer-first catalog of discovered Components, enriched by human-curated Digital Products and relationships. The Docker importer should provide a trustworthy, point-in-time view of Docker workloads and their source-reported operational observations. It should not become a metrics collector, event processor, or product authoring system.

**Research conclusion:** Docker Engine API is the right v1 discovery surface. Compose is observable through metadata on Engine resources, not through a general Compose-project inventory API. Registry and Hub APIs answer different questions and should not be bundled into runtime discovery.

## API landscape

| Surface                            | What it owns                                                                                            | Typical access model                                                                                                | Relevance to Componode                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker Engine API                  | A Docker daemon's containers, images, networks, volumes, system information, and optional Swarm objects | Local socket permissions, TLS client certificates, or an SSH transport to the socket; deployment controls authority | Primary inventory and source-observation API. Negotiate against `/version`; the v1.41 feature floor for Swarm `ServiceStatus` is not a fixed request version. Recent engines can advertise a higher `MinAPIVersion`. |
| Docker Registry HTTP API v2        | Repository manifests, tags, and blobs                                                                   | Registry's `WWW-Authenticate` challenge and repository-scoped Bearer token; public pull access may be anonymous     | Separate image-artifact discovery. Not needed to discover what is deployed on a daemon. Defer unless registry provenance becomes a distinct user need.                                                               |
| Docker Hub API                     | Docker Hub namespaces, repositories, teams, and account administration                                  | Hub access token/Bearer authentication, with account/token setup depending on the operation                         | Not a runtime inventory API. A Hub importer would be a separate integration and scope.                                                                                                                               |
| Docker Compose Specification / CLI | Compose application definition and implementation behavior                                              | Local CLI context/config and Compose file; not a general Engine API auth method                                     | Compose labels on Engine containers can identify project/service membership. Engine inventory alone does not provide the full Compose file or services with no created container. Do not imply otherwise.            |
| Docker Desktop Extensions SDK      | Extension UI and backend integration for Docker Desktop                                                 | Extension runtime and Desktop SDK                                                                                   | Not a server-side inventory API for this importer.                                                                                                                                                                   |

Primary references: [Docker Engine API](https://docs.docker.com/reference/api/engine/), [Engine API version history](https://docs.docker.com/reference/api/engine/version-history/), [versioned Engine API v1.41 reference](https://docs.docker.com/reference/api/engine/version/v1.41/), [Registry API v2](https://distribution.github.io/distribution/spec/api/), [Registry authentication](https://docs.docker.com/reference/api/registry/auth/), [Docker Hub API](https://docs.docker.com/reference/api/hub/latest/), [Hub access-token endpoint](https://docs.docker.com/reference/api/hub/latest/operations/AuthCreateAccessToken/), [Compose Specification](https://compose-spec.github.io/compose-spec/spec.html), [Compose application model](https://docs.docker.com/compose/intro/compose-application-model/), [Compose label implementation](https://github.com/docker/compose), [Docker Desktop Extensions SDK](https://docs.docker.com/reference/api/extensions-sdk/).

### Client library

`dockerode` is the selected third-party Node.js client baseline for the Engine API; it is not an official Docker Node SDK. Docker's Engine API documentation links official Go and Python SDKs. `dockerode` delegates transport work to `docker-modem`; Context resolution remains a narrow Agent-side adapter because `dockerode` does not resolve named Docker Contexts natively. Pin an actual release during implementation planning and verify API coverage, supported Node versions, cancellation, errors, and the exact transport behaviors. SSH host verification must override any library default and fail closed.

References: [Docker Engine API and SDK overview](https://docs.docker.com/reference/api/engine/), [dockerode project](https://github.com/apocas/dockerode), [docker-modem project](https://github.com/apocas/docker-modem).

## Engine inventory surfaces

The importer should use only the minimum read operations required for the chosen resource scope. List responses and inspect responses are distinct; container health, for example, requires inspect data. `GET /services?status=1` provides `ServiceStatus` from Engine API v1.41 onward. Negotiate the request version using `/version`: choose a supported version at or above v1.41 and within the daemon's advertised minimum/maximum; fail clearly if the supported range cannot provide required fields. Do not hard-pin v1.41 because recent Docker Engine releases may advertise a higher minimum API version.

| Inventory                  | Candidate Engine operations                                                | Useful source facts                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Daemon                     | `GET /version`, `GET /info`                                                | Engine/API version and daemon/Swarm identity. Use a stable, non-secret source namespace for imported IDs.                                                          |
| Containers                 | `GET /containers/json?all=1`, then selected `GET /containers/{id}/json`    | Container ID/name, image reference, state, labels, ports, mounts, network attachments, and optional health check state.                                            |
| Images                     | `GET /images/json`, optional inspect                                       | Local image IDs/digests, tags, architecture, creation metadata. Prefer the deployed image digest/reference on the workload over importing every cached base image. |
| Networks                   | `GET /networks`, optional inspect                                          | Name, driver, scope, labels, IPAM and attached endpoint metadata. Avoid storing unnecessary address detail.                                                        |
| Volumes                    | `GET /volumes`, optional inspect                                           | Name, driver, scope, labels, options. For bind mounts, retain only a redacted source-path representation and an opaque reference; never persist the raw host path. |
| Swarm services/tasks/nodes | `GET /services?status=1`, `/tasks`, `/nodes` on a manager-capable endpoint | API v1.41+ service status includes desired/running task counts. All Swarm management lists require a manager; check `/info` and `Swarm.ControlAvailable`.          |
| Swarm secrets/configs      | `GET /secrets`, `/configs` when Swarm is active and manager-accessible     | Auto-discover metadata within the selected source scope. Never import secret contents or config data.                                                              |
| Events/stats               | `GET /events`, `GET /containers/{id}/stats`                                | Excluded: event streaming and live resource metrics are outside the point-in-time importer purpose.                                                                |

The Docker API does not offer a Compose project resource. Labels such as `com.docker.compose.project` and `com.docker.compose.service` are evidence attached to existing containers; they do not reveal desired services with no container. Treat this as observed membership, not authoritative Compose configuration.

Common Compose labels to inspect include `com.docker.compose.project`, `com.docker.compose.service`, `com.docker.compose.version`, and `com.docker.compose.config-hash`. These are runtime labels emitted by Compose, not a complete Compose specification. Do not import working-directory/config-file paths by default; they may reveal host layout or user names.

### Relationships visible in source responses

| Source fact                                                         | What it supports                                                                                    | What it does not authorize                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Container references an image and carries network/mount attachments | Image digest/reference, network names, and volume/bind-mount references on the workload observation | No importer-created `DEPENDS_ON` edge                   |
| Compose project/service labels on containers                        | Grouping/identity metadata for workload Components                                                  | No project Component or `COMPOSES` edge                 |
| Swarm Service has Tasks; each Task identifies a Node                | Service-level desired/observed task summary and node IDs                                            | No automatic service-to-node or Product dependency edge |

References: [Engine API reference](https://docs.docker.com/reference/api/engine/), [Compose application model](https://docs.docker.com/compose/intro/compose-application-model/), [Compose label constants](https://github.com/docker/compose), [Swarm key concepts](https://docs.docker.com/engine/swarm/key-concepts/).

## Source health observations (snapshot, not monitoring)

Docker can report its latest configured health-check result and operational state when an import runs. This is a source observation with a time boundary, not a continuous health guarantee.

| Source observation              | What to retain                                                                                  | Caveat                                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Container `State.Status`        | Allowlisted Docker state, mapped to existing `InstanceStatus`                                   | This is the daemon's operational state at the API read.                                                                                                                        |
| Container `State.Health.Status` | `healthy`, `unhealthy`, `starting`, or `none` when present in the Engine response               | `State.Health` may be absent when no health check is configured. Preserve a returned `none` as source data; do not infer healthy from it.                                      |
| Health-check result metadata    | Failing streak and bounded check timestamps/exit codes, only if useful                          | Do not persist `Output` by default; health-check output can contain secrets or personal data. Do not persist the full `Healthcheck.Test` command by default.                   |
| Exit/OOM/restart facts          | Exit code, OOM flag, cumulative restart count as source facts                                   | A historical restart count greater than zero is not proof of current degradation. Interpret with the current state; otherwise display as context only.                         |
| Swarm service/tasks             | Desired mode/count and observed task states, if API v1.41+ and manager permissions provide them | Use service `ServiceStatus` (`status=1`) for desired/running counts. Replicated and global services have different semantics. Task objects do not expose a health-check field. |
| Swarm nodes                     | Node state and administrative availability                                                      | `drain` is an intentional scheduling setting, not itself a failure. A node observation only impacts a Digital Product when the catalog has an explicit dependency path.        |

No `/stats`, events stream, historical metric series, alert engine, or real-time dashboard is proposed. The UI should label the observation as last imported/observed and avoid presenting stale data as live. Docker's observation timestamp, when available, should be preserved; Componode's last-seen/import-run timestamps identify when Componode observed the source.

Swarm Task status does not include container `Health`. Container health for a Swarm task would require `GET /containers/{ContainerID}/json` on the node running that task. A manager endpoint cannot inspect worker-local containers, so per-task health-check collection is out of scope; use manager-reported service counts/task states instead.

References: [Dockerfile HEALTHCHECK](https://docs.docker.com/reference/dockerfile/#healthcheck), [Container inspect API](https://docs.docker.com/reference/api/engine/version/v1.50/#tag/Container/operation/ContainerInspect), [Swarm services](https://docs.docker.com/engine/swarm/services/), [Node availability](https://docs.docker.com/engine/swarm/manage-nodes/).

## Authentication and trust boundary

All Docker calls run through an assigned Import Agent. Connection modes are transports to the Engine API, not separate Docker APIs or equivalent authorization models.

| Mode                    | Agent-side target profile                                                 | Authentication/verification                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local socket/named pipe | Explicit socket/named-pipe path; must be mounted/provisioned on the Agent | OS/socket permissions; access is highly privileged                                                                                                           |
| TCP                     | Explicit host and port, HTTPS only                                        | Mutual TLS; always verify daemon certificate; require client cert/key; CA secret optional only when Agent system trust suffices                              |
| SSH                     | Explicit host, user, port                                                 | Private key and optional passphrase; target profile pins a SHA-256 SSH host-key fingerprint; remote host must have Docker CLI for `docker system dial-stdio` |
| Docker Context          | Explicit allowed, named, on-disk Context on the Agent                     | Resolver reads selected context metadata/TLS files locally; reject in-memory `default` Context and `SkipTLSVerify`                                           |

The Agent loads a versioned, read-only registry at `${SECRETS_DIR}/docker-targets.json`, reloads it per job, and preflights the importer config's `targetId`. Target IDs are immutable; changing endpoint or transport creates a new target ID. Unknown/malformed profiles fail before connecting; the Agent remains ready for other importers. The Docker config is Agent-bound only.

The Docker `targetId` is a connection/authorization selector, not a Component or Source identity. A provider-native Source identity (Docker Engine `/info.ID`) is reported separately. This keeps endpoint routing, source ownership, and logical Component identity distinct.

Docker Engine access is high trust. The importer emits read requests only, but that does not constrain process compromise or socket authority. `AGENT_MANAGED` credentials hold direct TLS/SSH key references on the Agent and are distinct per Agent/target; Context TLS bytes remain in the selected Agent-local Context store.

Componode's generic `urlSafetyError` rejects private/local URLs, while Docker daemons are commonly private. The importer therefore does not accept arbitrary endpoint URLs in scope and does not bypass the general guard. The Agent-side allowlist and operator egress policy are the trusted-target boundary. Restrict Agent egress as defense in depth.

References: [Docker Engine security](https://docs.docker.com/engine/security/), [remote access configuration](https://docs.docker.com/engine/daemon/remote-access/), [protecting Docker access over SSH](https://docs.docker.com/engine/security/protect-access/), [Docker contexts](https://docs.docker.com/engine/manage-resources/contexts/), [Docker CLI context store](https://github.com/docker/cli/tree/master/cli/context/store), [ssh2 host verification](https://github.com/mscdex/ssh2), [Componode ADR-106](./adrs/ADR-106-security-hardening-2026-09-assessment.md), [Import Agents](../docs/agents.md).

## Data minimization

Persist an explicit allowlist, not full Docker `inspect` JSON. Do not import container environment variables, full host config, full network settings, raw bind-mount source paths, health-check output/commands, Swarm secret data, or Swarm config data. The earlier `rawConfig: {...}` examples are not an acceptable mapping without field-level redaction. Preserve the prior user decision to include a redacted bind-mount path representation, mount type, and container destination. Use a source-native volume name/ID when available; for a bind mount with no native ID, derive a clearly importer-local reference from the Component Instance ID and destination, not a fabricated Docker ID. Define the exact redaction policy during grilling. Store only useful labels (or a bounded allowlist), image reference/digest, ports, network/volume names, and the source health/state fields selected by the eventual spec. Keep secret/config content out of logs, details, and test errors.

## Confirmed Componode mapping

The imported Component is a **logical containerized workload** (`category: CONTAINER`), not a Compose Project and not a transient Docker container ID. For a Compose stack named `commerce`, `web`, `api`, and `db` are separate Components. The Compose Project is a source reference/grouping value; `com.docker.compose.service` is metadata used to identify/filter a workload, not a Componode entity. Each concrete container running `web` in DEV or PROD is a Component Instance.

| Docker fact                                                                | Componode location/meaning                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stable logical workload identity                                           | Component `externalId`: canonical project key + workload/service key; omit daemon/target identity so the same workload Component is shared across environments. An explicit stable workload ID label/mapping overrides the default to survive project/service renames. |
| Docker daemon/target identity + container ID                               | Component Instance `externalId`; a rebuilt container is a new Instance under the same Component.                                                                                                                                                                       |
| Canonical Compose project/service values                                   | Shared Component details and optional edit-time tag suggestions. Suggestions require a user click and are never auto-applied.                                                                                                                                          |
| Original per-target Compose labels and endpoint facts                      | `ImporterSource` membership details, preserving differing source values without last-writer overwrite.                                                                                                                                                                 |
| Container state/health, image digest, ports, safe network/mount references | Namespaced `ComponentInstance.rawConfig.dockerObservation`, with source-check time distinct from Componode `lastSeenAt`.                                                                                                                                               |
| Swarm Service identity and counts                                          | A `CONTAINER_ORCHESTRATION` Component with one aggregate Component Instance per environment; task/container IDs and status stay in the instance observation.                                                                                                           |
| Swarm Service project/workload key                                         | Stable service label/mapping or stack namespace + service name across target clusters; use the target/Swarm service ID for the aggregate Instance identity.                                                                                                            |
| Swarm Node                                                                 | Source-scoped `COMPUTE` Component with an operational Instance. It has no automatic edge to a Service or Product.                                                                                                                                                      |
| Swarm Secret                                                               | Source-scoped `SECRET` Component with metadata only and `instances: []`; never read secret content.                                                                                                                                                                    |
| Swarm Config                                                               | Name/ID/target reference in Swarm Service details; no separate Component because `CONFIG` is not a category and content is not collected.                                                                                                                              |
| Docker Networks, Volumes, local Images                                     | Safe workload metadata; images are additionally importable as a separate inventory only when the opt-in is enabled.                                                                                                                                                    |

Compose and Swarm representations have different Component categories (`CONTAINER` vs. `CONTAINER_ORCHESTRATION`); they do not automatically merge even if they represent the same business workload. A Product owner can migrate its curated dependency deliberately. `COMPOSES` does not apply: it is a DigitalProduct-to-DigitalProduct edge, not a Compose Project/service/container relationship.

Digital Products remain human-authored. People add direct `DEPENDS_ON_COMPONENT` edges to the workload Components. ADR-112 then derives Product status from direct dependency Components' non-GONE Component Instance statuses, ranking `ERROR > STOPPED > RUNNING`. There is no `ComponentInstance.health` field and no Line-of-Business/Team health rollup.

### Source and reconciliation model

`ImporterSource` is a durable, internal UUIDv7 record distinct from `ImporterConfig`, a Docker target profile, and a catalog Component. Each source carries a provider-native external identity (Docker Engine `/info.ID`; use an explicit Admin-supplied key only if the provider has no trustworthy identity). Source identities are non-secret and canonical: URL-based identities must strip userinfo, authentication query parameters, and fragments, or use a safe label/admin key instead. `ImporterSource` records source identity/retirement; it is not a user-facing Product or Component.

Each source has one active ImporterConfig. Source identity is reported before assets, including an empty inventory. `ImportRun.sourceId` is durable; `configId` becomes nullable with `ON DELETE SET NULL` so a deleted config cannot delete its source history. Component and Component Instance memberships are stored per `ImporterSource`, independent of the mutable `lastSeenInRunId` pointer. A source run only marks its own missing memberships GONE. A shared Component remains ACTIVE while any source membership is active; source-local data never overwrites another source's details.

Component upsert remains globally keyed by `(category, provider, externalId)`; `ImporterSource.id` is not added to that key. Source-local Components must include source identity in their `externalId`. A Compose workload deliberately shared across targets instead uses its canonical logical project/service identity. This prevents accidental collisions without duplicating a logical workload once per Docker daemon.

Deleting an ImporterConfig stops collection and marks its Source `UNMONITORED`, but retains the Source, memberships, and run history. Retiring a Source is a separate, explicit and reversible operation: its own Instances become GONE; shared Components retire only when no other active Source reports them. Reappearance by the same provider identity reactivates the Source/Components.

This reconciliation model is generic core behavior for all importers. Existing importers adopt it in documented stages. Backfill from surviving `lastSeenInRunId -> ImportRun -> config` links is best-effort; deleted-config or multi-source history may be unrecoverable. Preserve uncertain legacy Components and their Product edges as `LEGACY_UNATTRIBUTED`; do not automatically split, merge, rekey, or retire them.

References: [Componode vocabulary](../CONTEXT.md), [ComponentInstance contract](../packages/core/src/contracts/component-instance.ts), [DiscoveredAsset contract](../packages/core/src/contracts/discovered-asset.ts), [ADR-112](./adrs/ADR-112-product-health-rollup.md), [ADR-057](./adrs/ADR-057-discoveredasset-final-shape.md), [ADR-113](./adrs/ADR-113-staged-edge-suggestions.md).

### Existing importer identity audit for staged migration

| In-tree importer    | Current provider/source identity evidence                              | Migration concern                                                                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alibaba Cloud       | STS `GetCallerIdentity.accountId`; resource ARNs are account-qualified | Existing implemented importer has a strong account key. See [importer](../packages/importer-alibaba-cloud/src/importer.ts) and [mapping](../packages/importer-alibaba-cloud/src/mapping.ts).                                                                          |
| GitHub              | Organization ID and `baseUrl`; repository numeric ID                   | Include the host/base URL for GHES. Repo allow-lists can include repositories outside the configured organization. See [config](../packages/importer-github/src/config.ts) and [importer](../packages/importer-github/src/importer.ts).                               |
| AWS scaffold        | No API identity probe; placeholder ID is `{region}:{resourceType}`     | Does not include account ID, so different accounts can collide. Add STS identity before a real cloud inventory is enabled. See [importer](../packages/importer-aws/src/importer.ts).                                                                                  |
| Azure scaffold      | Optional subscription ID; tenant ID is not recorded                    | Missing subscription collapses identities to `default:<resourceType>`; qualify tenant + subscription before real inventory. See [config](../packages/importer-azure/src/config.ts) and [importer](../packages/importer-azure/src/importer.ts).                        |
| Kubernetes scaffold | Namespace + resource type; endpoint is metadata, not part of the ID    | Cluster identity is absent, so equal namespace/type values across clusters collide. Add a stable cluster identity before live discovery. See [config](../packages/importer-kubernetes/src/config.ts) and [importer](../packages/importer-kubernetes/src/importer.ts). |
| MCP server scaffold | Endpoint when present; generic `mcp:<resourceType>` fallback           | Configs without endpoint collide. Require a stable server identity or explicit admin source key. See [config](../packages/importer-mcp-server/src/config.ts) and [importer](../packages/importer-mcp-server/src/importer.ts).                                         |
| API URL / Web URL   | Configured URL, also used as the single asset identity                 | One config is one endpoint; consider URL aliases/canonicalization so the same service is not duplicated under multiple URLs. See each importer's `config.ts` and `importer.ts`.                                                                                       |

These are current code facts, not approved new external IDs. Each staged migration must ratify the provider-specific Source key and `Component.externalId` rule before enabling multi-source reconciliation.

## Importer and UI fit

Use the existing importer contract: pull-only `AsyncGenerator<DiscoveredAsset>`, strict Zod config, manifest-declared secret keys and target-reference key, credential testing, cancellation, structured phases, and `validateDiscoveredAsset`. The source-identity callback must run before the first asset so the backend can bind the run to an `ImporterSource`, even if the source has zero Components.

The UI reuses the schema-driven importer form, generic credential handling, run detail, and a generic Importer Sources view/detail (source state, attached config, last complete run, reattach, explicit retire). No Docker-specific config widgets or real-time detail panel. Component edit offers normalized `compose:<project-slug>` and `service:<service-slug>` tag suggestions; users explicitly click to add and save them. Suggestions must satisfy the existing tag grammar/32-character limit; omit overlong or invalid suggestions rather than truncating, while retaining full labels in Source metadata. The `details` API-to-view mapper must expose the stable Compose keys to that editor; no new backend endpoint is required.

## Implementation research gates

- Pin the `dockerode`/`docker-modem` release and verify error handling, AbortSignal/cancellation support, Windows named-pipe support, SSH host-verifier behavior, and Context resolver behavior against that exact version.
- Define the versioned `docker-targets.json` schema, Source/target records and state transitions, source membership tables, and config deletion/run-history FK behavior in ADR-backed design artifacts.
- Verify Docker Compose identity labels, Swarm manager API fields (`GET /services?status=1`, API v1.41+), health/state mappings, and bounded inspect concurrency in fixture tests.
- The spec waves must document the all-importer source migration, best-effort legacy backfill, `LEGACY_UNATTRIBUTED` handling, and provider-specific source-identity keys.

## Primary references

- Docker Engine API: https://docs.docker.com/reference/api/engine/
- Docker Engine API version history: https://docs.docker.com/reference/api/engine/version-history/
- Docker Engine API v1.41 reference: https://docs.docker.com/reference/api/engine/version/v1.41/
- Dockerfile health checks: https://docs.docker.com/reference/dockerfile/#healthcheck
- Docker Engine security: https://docs.docker.com/engine/security/
- Docker remote access: https://docs.docker.com/engine/daemon/remote-access/
- Docker SSH access protection and `docker system dial-stdio`: https://docs.docker.com/engine/security/protect-access/
- Docker contexts: https://docs.docker.com/engine/manage-resources/contexts/
- Docker CLI context store: https://github.com/docker/cli/tree/master/cli/context/store
- Docker Compose Specification: https://compose-spec.github.io/compose-spec/spec.html
- Compose labels and application model: https://docs.docker.com/compose/intro/compose-application-model/
- Registry API v2: https://distribution.github.io/distribution/spec/api/
- Docker Hub API: https://docs.docker.com/reference/api/hub/latest/
- `dockerode`: https://github.com/apocas/dockerode
- `docker-modem`: https://github.com/apocas/docker-modem
