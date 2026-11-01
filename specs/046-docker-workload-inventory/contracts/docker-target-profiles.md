# Contract: `docker-targets.json` target profiles

**Feature**: `046-docker-workload-inventory` | **Status**: ratified text for ADR-121

Registry file: `${SECRETS_DIR}/docker-targets.json` on the Import Agent
(convention `${SECRETS_DIR}/{importerName}-targets.json`, ADR-116 A6).
Read-only, reloaded per job and per credential test. The registry's
contents are the complete allowlist — a `targetId` absent from the file
is rejected before any network access.

## Envelope (already ratified — ADR-116 A6)

```jsonc
{
  "version": 1,
  "targets": {
    "<targetId>": { "transport": "<transport>", "...": "..." }
  }
}
```

Missing/corrupt file = empty allowlist (fail closed; agent stays up).
`targetId` is an immutable access-route identifier — changing any field
means minting a new ID.

## Typed profiles (new — this contract)

All transports share: non-secret fields only; `transport` discriminates
the shape. Validation is fail-closed — unknown keys, missing required
fields, or forbidden combinations reject the profile before any
connection attempt.

### `socket` — local socket / named pipe

```jsonc
{ "transport": "socket", "path": "/var/run/docker.sock" }
```

| Field | Rule |
|---|---|
| `path` | Absolute unix path or Windows `//./pipe/<name>` npipe; no `..`; must be provisioned/mounted on the Agent |

No secrets. Common provisioning: bind-mount `/var/run/docker.sock`, or
`npipe:////./pipe/docker_engine` on Windows agents.

### `tcp` — verified mutual TLS

```jsonc
{
  "transport": "tcp",
  "host": "docker.internal.example.com",
  "port": 2376,
  "caCertKey": "caCert",
  "clientCertKey": "clientCert",
  "clientKeyKey": "clientKey"
}
```

| Field | Rule |
|---|---|
| `host`, `port` | Required; HTTPS only — there is no plaintext mode |
| `clientCertKey`, `clientKeyKey` | Required; name `secrets` record keys holding PEM material resolved from AGENT_MANAGED refs |
| `caCertKey` | Optional — required for private CAs; when absent the Agent/system trust store is used |

Server verification is always on; no skip-verify field exists.

### `ssh` — pinned-host-key SSH (`docker system dial-stdio`)

```jsonc
{
  "transport": "ssh",
  "host": "docker-host.internal",
  "port": 22,
  "user": "componode",
  "hostKeySha256": "<64-hex or SHA256:...>",
  "privateKeyKey": "sshPrivateKey",
  "passphraseKey": "sshPassphrase"
}
```

| Field | Rule |
|---|---|
| `host`, `user` | Required; `port` defaults to 22 |
| `hostKeySha256` | Required; SHA-256 fingerprint of the server host key (hex or OpenSSH `SHA256:base64` form both accepted, normalized on compare) |
| `privateKeyKey` | Required; names the `secrets` key holding PEM private key |
| `passphraseKey` | Optional; names the `secrets` key holding the key passphrase |

No password-only auth, no implicit OpenSSH config/aliases. The remote
host must have Docker CLI for `docker system dial-stdio`.

### `context` — allowlisted named Docker Context

```jsonc
{ "transport": "context", "name": "prod-docker" }
```

| Field | Rule |
|---|---|
| `name` | Required; must exist in the Agent's on-disk context store (`$DOCKER_CONFIG/contexts/meta/` or `~/.docker/contexts/meta/`) |

Rejected: the in-memory `default` context; contexts with
`SkipTLSVerify`; `ssh://` context endpoints (use a direct `ssh` profile).
TLS material is read from the Agent's context store
(`contexts/tls/<name>/docker/`) — never from `secrets`.

## Secret-key indirection

Profile fields ending in `Key` name entries in the run/test `secrets`
record (resolved from AGENT_MANAGED `env`/`file` refs per ADR-117).
Profiles that name a key absent from the linked credential's secret map
fail with a non-secret `SECRET_RESOLUTION_FAILED`-style reason.
