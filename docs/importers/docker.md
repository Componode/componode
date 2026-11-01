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
- Optionally (off by default): cached local images as metadata-only
  **PACKAGE_REGISTRY** Components.

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
  lists, task inspect, or logs.
- One **COMPUTE** Component per node (`swarm-node`) with a
  status-bearing Instance — `ready`+`active` → `RUNNING`,
  `drain`/`pause` → `STOPPED`, `down`/`disconnected`/unreachable/
  unknown-or-undefined → `ERROR` — and a bounded `swarmNodeObservation`
  (`role`, `availability`, `reachability`, `leader`, `state`, `addr`).
- One metadata-only **SECRET** Component per Swarm secret
  (`swarm-secret`) — name + revision, no Instances, contents never
  read. Secret/config *references* appear on service details as
  bounded `{id,name}` pairs; no `CONFIG` Components.

Non-Swarm endpoints make zero additional calls beyond the `/info` the
importer already fetches.

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
<!-- /GENERATED:contract -->


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
