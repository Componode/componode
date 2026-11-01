# Docker

The Docker importer inventories **containerized workloads** on Docker
Engines you operate — always through an assigned **Import Agent**;
direct hub execution is unsupported (ADR-121).

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

Every config runs on an Import Agent. Provision the agent per
`docs/import-agents.md`, then create a target registry at
`${SECRETS_DIR}/docker-targets.json` — a versioned, read-only allowlist:

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
| `socket` | Mount the daemon socket/pipe into the agent (e.g. `-v /var/run/docker.sock:/var/run/docker.sock`, or `//./pipe/docker_engine` on Windows). Agent user needs socket access (docker group). |
| `tcp` | Enable the daemon's TLS listener (`dockerd --tlsverify --tlscacert --tlscert --tlskey -H tcp://0.0.0.0:2376`). Issue a client cert/key pair; `caCertKey` is needed only for a private CA. Plaintext and skip-verify are rejected — always verified mTLS. |
| `ssh` | The remote host needs Docker CLI (`docker system dial-stdio`) and the user needs socket access. Pin the server's SHA-256 host key (`ssh-keyscan`/`ssh-keygen -lf`). Private key + optional passphrase via agent-managed credentials. No password auth, no implicit OpenSSH config. |
| `context` | A named Docker Context that already exists in the agent's on-disk context store (`~/.docker/contexts/`). `default`, `SkipTLSVerify`, and `ssh://` endpoints are rejected — use a direct `ssh` profile for SSH daemons. |

Fields ending in `Key` name secrets resolved on the agent — the profile
never embeds key material. `targetId`s are immutable: to change an
endpoint, mint a new profile.

## Credentials

Link an **AGENT_MANAGED** credential whose reference map supplies the
keys your transport profiles name (`{env: "VAR"}` / `{file: "path"}` —
resolved on the agent host under `SECRETS_DIR`). No credential is needed
for `socket`/`context`-only setups; an empty link or none is fine. The
**Test** action runs a minimal `version` probe through the
resolved profile — never a full inventory.

## Configuration fields

| Field | Required | Notes |
|---|---|---|
| `targetId` | yes | Names a profile in `docker-targets.json` |
| `environmentLabel` | no | Docker label key read for environment mapping (container labels, then Compose service labels) |
| `environmentMap` | no | JSON map of label value → environment (`DEV`/`TEST`/`STAGING`/`DEMO`/`PRODUCTION`/`OTHER`); unmapped → `OTHER` |
| `componentIdLabel` | no | Workload-identity override label; default `componode.component-id` |
| `includeImages` | no | `true` imports cached images as `PACKAGE_REGISTRY` Components; default `false` |
| `sourceKey` | no | Fallback source identity when the engine reports no `/info.ID` |

## Common failures

| Error | Meaning |
|---|---|
| `TARGET_RESOLUTION_FAILED` | `targetId` absent from the registry, registry file missing/malformed, or the profile is invalid — fails before any network access |
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
