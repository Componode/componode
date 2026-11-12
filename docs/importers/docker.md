---
title: Docker importer
description: What the Docker importer discovers and how to configure it.
---

# Docker

The Docker importer inventories **containerized workloads** on Docker
Engines you operate — either **in-process on the Hub** or through an
assigned **Import Agent** (ADR-121, ADR-122). Use the Hub for engines the
backend can reach directly; use an Agent for daemons inside restricted
networks.

## Quickstart: Hub + local socket (about 5 minutes)

The happy path — the Hub imports from a Docker Engine on the same host.

1. **Mount the socket (one-time).** The default Compose stack does *not*
   mount the Docker socket. Add the opt-in mount described in
   [deployment.md → Docker importer on the Hub](../deployment.md#docker-importer-on-the-hub)
   and recreate the backend container. Socket access is
   **root-equivalent on the host** — only enable it for engines you
   trust the Hub to control.
2. **Guided setup.** Sign in as an administrator → **Importers →
   Guided Docker setup** (or the hint shown on *Add importer* when
   Docker is selected). Pick **Local socket / named pipe**, enter
   `/var/run/docker.sock`, give the importer a label, choose a schedule,
   and continue.
3. **Verify & create.** The wizard probes the engine (`/version` only),
   then creates the Docker target and importer config in one pass —
   nothing is persisted if the probe fails. For `tcp`/`ssh` transports
   the secrets step captures certificates/keys inline (stored encrypted
   as a credential) or reuses an existing credential that already has
   the required keys.
4. **Run it.** Open the new importer and choose **Run now** — discovered
   workloads appear in the catalog on the next reconciliation.

Everything below covers the manual path: target transports, credential
key contracts, lifecycle rules, and the Agent executor. Non-socket
setups are covered in [deployment.md](../deployment.md) (Hub) and
[import-agents.md](../import-agents.md) (Agent).

## What it imports

- One **CONTAINER** Component per logical workload: a Compose service
  (`project` + `service` labels), a workload carrying a
  `componode.component-id` label, or a standalone container
  (daemon-scoped name fallback).
- One **Component Instance** per concrete container, carrying its
  deployed image reference/digest, published ports, network and volume
  names, and a redacted bind-mount representation — never raw host
  paths, environment variables, health-check output, or full inspect
  JSON.
- Each Instance also persists an allowlisted **`dockerObservation`**
  snapshot under `rawConfig`: engine `state`, non-zero `exitCode`,
  `oomKilled`/`restarting` flags, `startedAt`/`finishedAt`, and
  `health` (`status` + `failingStreak`, or `null` when no health check
  is configured). Never collected: `/stats`, events, health-check
  output (`Health.Log`), health-check test commands, or history — the
  observation renders on the component detail's Instances table.
- Each Instance also carries bounded **configuration facts** under
  `rawConfig`: `imageId` (the immutable `sha256:` image ID, which joins
  image assets), `hostConfig` (memory/CPU/PID limits, restart policy,
  privileged and read-only-rootfs posture, log-driver name), and
  `healthcheck` timings in seconds. Never collected: `Config.Env`,
  health-check `Test` commands, bind mount sources, or log-driver
  options.
- One **COMPUTE** Component per source (`docker-engine`) — always
  emitted on every transport and executor — carrying bounded engine
  facts in `details`: server/API versions, OS, architecture, kernel,
  cgroup driver, runtimes, registry mirrors, and Swarm manager state
  when the engine reports it. Host root dir, proxy variables, plugins,
  security options, and warnings are never collected.
- Optionally (off by default): cached local images as metadata-only
  **PACKAGE_REGISTRY** Components. With `includeImages` on, each unique
  image is inspected once and gains bounded provenance in `details` —
  allowlisted `org.opencontainers.image.*` labels plus exposed ports,
  user, entrypoint, working directory, volumes, and architecture/OS.
  A failed inspect omits that image's enrichment only; the run is
  unaffected.
- Always on: infrastructure inventory — one **NETWORK** Component per
  Docker network and one **STORAGE** Component per Docker volume,
  metadata only (`instances: []`). See
  [Infrastructure inventory](#infrastructure-inventory) for the exact
  field bounds and exclusions.

Compose project/service values are source metadata, not Components or
edges; the component edit dialog offers them as user-confirmed
`compose:<project>` / `service:<project>.<service>` tag suggestions.

## Swarm inventory

When the endpoint reports an **active Swarm and manager access**
(`info.Swarm.ControlAvailable`), the same run also inventories — at
Engine **API ≥ 1.41** (required for manager-reported `ServiceStatus`;
below the floor the run fails rather than emit a partial inventory):

- One **CONTAINER_ORCHESTRATION** Component per Swarm service
  (`swarm-service`), identity by `Spec.Name` (stack-prefixed, so
  same-named services in different stacks stay distinct) + one
  aggregate Instance per environment. Status derives from
  manager-reported replica counts only: full replication → `RUNNING`,
  partial or zero-of-N → `ERROR`, scaled-to-zero → `STOPPED`, absent →
  `GONE`. Per-task health is never inferred. Each Instance carries an
  allowlisted `swarmObservation` (`mode`, `desired`, `running`,
  optional `completed` and `updateState`, `observedAt`) — never task
  lists, task inspect, or logs. `mode` reports `replicated`, `global`,
  `replicated-job`, or `global-job`; job services remain
  `CONTAINER_ORCHESTRATION`. The Instance also carries the service
  spec's published ports (`ports[]`: protocol/target/published/
  publishMode) and attached network targets (`networks[]` — names or
  IDs as reported by the service spec).
- One **COMPUTE** Component per node (`swarm-node`) with a
  status-bearing Instance — `ready`+`active` → `RUNNING`,
  `drain`/`pause` → `STOPPED`, `down`/`disconnected`/unreachable/
  unknown-or-undefined → `ERROR` — and a bounded `swarmNodeObservation`
  (`role`, `availability`, `reachability`, `leader`, `state`, `addr`).
- One metadata-only **SECRET** Component per Swarm secret
  (`swarm-secret`) — name + revision, no Instances, contents never
  read. Secret/config *references* appear on service details as
  bounded `{id,name}` pairs; no `CONFIG` Components.

Non-Swarm endpoints make no Swarm calls — the run still makes one
`/version` call for the engine component's facts (reused by the
API-floor gate when Swarm is active).

## Infrastructure inventory

Every run also inventories Docker infrastructure — always on, no
config flag, independent of Swarm state:

- One **NETWORK** Component (`resourceType: network`) per entry in
  `GET /networks`, enriched by `GET /networks/{id}` for attachment
  names (the list omits `Containers` on API ≥ 1.28). `details` carries
  `driver`, `scope`, `createdAt`, the posture flags `internal`,
  `attachable`, `ingress`, `configOnly`, `enableIPv6` (emitted only
  when true), `attachedCount`, `attachedContainers` (endpoint names),
  and allowlisted `labels` (`com.docker.compose.*`, `componode.*`).
- One **STORAGE** Component (`resourceType: volume`) per entry in
  `GET /volumes`, joined by name to `GET /system/df` for usage facts.
  `details` carries `driver`, `scope`, `createdAt`,
  `sizeBytes`/`refCount`/`reclaimable` from `UsageData` (omitted when
  unreported or reported as `-1`), and allowlisted `labels`.

Identities are scope/name-qualified
(`{source}::network:{scope}:{name}`, `{source}::volume:{name}`); both
asset types emit `instances: []` — point-in-time infrastructure facts,
not workloads.

Never collected: network IPAM subnets/gateways/auxiliary addresses,
per-endpoint IDs and MAC/IP/global-IPv6 addressing, network `Options`,
volume `Mountpoint`/`Options`/`Status`, host paths, and any label
outside the prefix allowlist. `GET /networks`, any per-network
inspect, `GET /volumes`, or `GET /system/df` failing fails the whole
run — partial infrastructure inventory is never emitted.

## Instance status

Engine state and latest health-check facts map to `InstanceStatus`
(ADR-121 Amendment 1): `running` → `RUNNING` unless the health check is
`unhealthy` (`ERROR`); `starting` health is inconclusive (`RUNNING`);
`created`/`paused`/`exited` → `STOPPED`; OOM-killed, `dead`,
`restarting`, `removing`, and unknown states → `ERROR`; absent from a
completed run → `GONE`. Non-zero exit codes alone do not escalate
`exited` past `STOPPED`.

## Source lifecycle

Every Docker run attributes to a durable **ImporterSource**
(`docker-engine:{/info.ID}`). Sources are visible under **Sources →
Importer sources** in the app: identity, bound config, last complete
run, run history, and membership counts. Deleting a config leaves the
source `UNMONITORED` — a config reporting the same engine identity
rebinds on its next run (rebind-on-report, never by name). Admins can
explicitly **retire** a source (memberships excluded from catalog
reads) and **reactivate** it later.

## Setup in the external tool

**Hub execution** (Execution = "Hub (in-process)"): admins manage targets
under **Administration → Docker targets**. Each target stores a
non-secret route profile — the same typed schema below — keyed by an
immutable `targetId` (1–200 chars). Transports reference credential *key
names* only; the values come from the config's linked **STORED**
credential. The default deployment does not mount a Docker socket into
the hub — socket and context transports require explicit opt-in (see
`docs/deployment.md` → *Docker importer on the Hub*).

**Agent execution** (Execution = an agent): provision the agent per
`docs/import-agents.md`, then create a target registry at
`${SECRETS_DIR}/docker-targets.json` on the agent host — a versioned,
read-only allowlist:

```jsonc
{
  "version": 1,
  "targets": {
    "local":     { "transport": "socket", "path": "/var/run/docker.sock" },
    "prod-mtls": { "transport": "tcp", "host": "docker.example.com", "port": 2376,
                   "caCertKey": "caCert", "clientCertKey": "clientCert", "clientKeyKey": "clientKey" },
    "prod-ssh":  { "transport": "ssh", "host": "docker-host.internal", "user": "componode",
                   "hostKeySha256": "SHA256:....", "privateKeyKey": "sshPrivateKey", "passphraseKey": "sshPassphrase" },
    "prod-ctx":  { "transport": "context", "name": "prod-docker" }
  }
}
```

| Transport | External setup |
|---|---|
| `socket` | Mount the daemon socket/pipe into the executor host (e.g. `-v /var/run/docker.sock:/var/run/docker.sock`, or `//./pipe/docker_engine` on Windows). The executing process needs socket access (docker group). |
| `tcp` | Enable the daemon's TLS listener (`dockerd --tlsverify --tlscacert --tlscert --tlskey -H tcp://0.0.0.0:2376`). Issue a client cert/key pair; `caCertKey` is needed only for a private CA. Plaintext and skip-verify are rejected — always verified mTLS. |
| `ssh` | The remote host needs Docker CLI (`docker system dial-stdio`) and the user needs socket access. Pin the server's SHA-256 host key (`ssh-keyscan`/`ssh-keygen -lf`). Private key + optional passphrase via agent-managed credentials. No password auth, no implicit OpenSSH config. |
| `context` | A named Docker Context that already exists in the executor's on-disk context store (`~/.docker/contexts/`). `default`, `SkipTLSVerify`, and `ssh://` endpoints are rejected — use a direct `ssh` profile for SSH daemons. |

Fields ending in `Key` name secrets resolved by the executor — the
profile never embeds key material. `targetId`s are immutable on both
executors: to change an endpoint, mint a new profile (on the Hub, a new
target record).

## Credentials

- **Hub-bound configs** link **STORED** credentials whose keys cover
  every `*Key` name in the selected target's profile — save-time
  validation rejects a config whose credential is missing a named key.
- **Agent-bound configs** link **AGENT_MANAGED** credentials whose
  reference map supplies the keys (`{env: "VAR"}` / `{file: "path"}` —
  resolved on the agent host under `SECRETS_DIR`).

No credential is needed for `socket`/`context`-only targets. The target
detail's **Test** action (or the credential test for agent-bound
configs) runs a minimal `version` probe through the resolved profile —
never a full inventory.

## Target lifecycle (Hub)

- **Disable** blocks new config assignments, tests, and runs
  (`TARGET_DISABLED`); active Hub runs/tests are asked to cancel with
  `cancelReason: TARGET_DISABLED`. Existing configs keep the reference
  and can be edited in unrelated fields — they run again once the target
  is re-enabled or they pick another target.
- **Delete** is blocked (`TARGET_IN_USE`) while any config references
  the target.
- Target create/update/enable/disable/delete/test events are audited
  and appear in the Activity feed with the target label.
- Executor changes (Hub ↔ Agent) clear the target and credential
  selections — registries are executor-local, and the same `targetId`
  text can name different routes on each.

## Configuration fields

<!-- GENERATED:contract -->
**Secrets:** `caCert`, `clientCert`, `clientKey`, `sshPrivateKey`, `sshPassphrase`
**Execution:** hub or Import Agent · target profiles
**Source identity:** `context.reportSourceIdentity()`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `targetId` | string | yes | — | Hub: a managed Docker target; Agent: a profile in docker-targets.json |
| `environmentLabel` | string | no | — | Docker label key read for environment mapping (container labels, then Compose service labels) |
| `environmentMap` | record | no | — | Map of label value to environment; unmapped values fall back to OTHER |
| `includeImages` | bool | no | `false` | Import cached images as PACKAGE_REGISTRY components |
| `componentIdLabel` | string | no | `componode.component-id` | Workload-identity override label |
| `sourceKey` | string | no | — | Fallback source identity when the engine reports no /info.ID |
| `autoGroup` | bool | no | — | Automatically maintain a ComponentGroup for this source's exclusively reported components (default true) |
<!-- /GENERATED:contract -->

## Auto-grouping

With `autoGroup` enabled (the default), each ImporterSource this importer
reports gets at most one auto-managed ComponentGroup — named after the
source label (falling back to the engine component), slugged
`docker-cluster-{hash}`, and linked back to the source. After every
completed run the backend recomputes membership: a component joins the
group only while this source is its **sole** effective-active reporter, so
components shared with another importer stay ungrouped. Two Docker configs
pointed at managers of the same swarm still produce two source-scoped
groups.

The group's lifecycle is derived (`ACTIVE` while it has active members) —
humans can rename, re-describe, or re-own it, but `lifecycle` writes and
deletion are rejected (`409 GROUP_AUTO_MANAGED`); retire the source instead.
Set `autoGroup: false` to opt a config out — its source's group is frozen
as-is, never torn down, and resumes maintenance if a later bound config
re-enables it.

### Application groups

The same pass also maintains **app-level groups** — one auto-managed group
per Compose project and per Swarm stack discovered on the engine. A
workload joins its project/stack group when it is effectively reported by
this source _and_ carries the boundary label: Compose workloads via
`details.composeProject`, Compose networks/volumes via the
`com.docker.compose.project` label, and Swarm services via
`details.stack`. Images, the engine component, nodes, secrets, and
standalone containers stay in the source group only.

App groups are per-source — two engines running a project with the same
name get separate groups (slug `docker-app-{key}-{hash}`). Membership is
additive: a component can sit in the source group, an app group, and any
human-managed groups at once. The same `autoGroup` opt-out freezes app
groups together with the source group.


## Common failures

| Error | Meaning |
|---|---|
| `TARGET_RESOLUTION_FAILED` | `targetId` absent from the executor's registry, registry file missing/malformed (Agent), or the profile is invalid — fails before any network access |
| `TARGET_DISABLED` | The Hub target is disabled — runs record `FAILED`/`TARGET_DISABLED` and tests return `ok:false`; re-enable or pick another target |
| `TARGET_IN_USE` | Deleting a Hub target that an importer config still references |
| `CREDENTIAL_MISSING_KEY` | A Hub target's `*Key` name is not covered by the config's linked `STORED` credentials |
| `SECRET_RESOLUTION_FAILED` | A profile's `*Key` names a secret key the linked credential doesn't provide on the agent (a missing key inside the run is a run `FAILED` with the key name in the error) |
| `AGENT_UNAVAILABLE` / `AGENT_LOST` | Agent offline, over capacity, or disconnected mid-run (remote runs are never resumed) |
| Run fails at "Identifying source" | `/info.ID` unavailable and no `sourceKey` configured |
| Run `FAILED` mid-run | An enumeration call failed — the catalog keeps the prior import; nothing is retired on a partial run |

## Identity and reconciliation

The importer reports `docker-engine:{/info.ID}` as its ImporterSource
before yielding assets — including empty inventories. Compose/override
external IDs deliberately omit daemon identity, so the same workload
shares one Component across environments; each daemon's container is a
per-Source Instance. Rebuilds create new Instances under the same
Component; renames without an override label create new Components and
never transfer product edges.
