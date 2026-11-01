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
- Optionally (off by default): cached local images as metadata-only
  **PACKAGE_REGISTRY** Components.

Compose project/service values are source metadata, not Components or
edges. Swarm services/nodes and health observations arrive in later
waves — this importer emits container inventory only.

## Setup in the external tool

Every config runs on an Import Agent. Provision the agent per
`docs/agents.md`, then create a target registry at
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
**Test** action runs a minimal `ping`/`version` probe through the
resolved profile — never a full inventory.

## Configuration fields

| Field | Required | Notes |
|---|---|---|
| `targetId` | yes | Names a profile in `docker-targets.json` |
| `environmentLabel` | no | Docker label key read for environment mapping (container labels, then Compose service labels) |
| `environmentMap` | no | JSON map of label value → environment (`PRODUCTION`/`STAGING`/`DEVELOPMENT`/`OTHER`); unmapped → `OTHER` |
| `componentIdLabel` | no | Workload-identity override label; default `componode.component-id` |
| `includeImages` | no | `true` imports cached images as `PACKAGE_REGISTRY` Components; default `false` |
| `sourceKey` | no | Fallback source identity when the engine reports no `/info.ID` |

## Common failures

| Error | Meaning |
|---|---|
| `TARGET_RESOLUTION_FAILED` | `targetId` absent from the registry, registry file missing/malformed, or the profile is invalid — fails before any network access |
| `SECRET_RESOLUTION_FAILED` | A profile's `*Key` names a secret key the linked credential doesn't provide on the agent |
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
