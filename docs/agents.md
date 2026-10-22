# Import Agents

Remote **Import Agents** (spec 025, ADR-116) run Componode importers inside
networks the hub cannot reach — private cloud VPCs, on-prem Kubernetes,
corporate egress-only environments. The agent makes one **outbound** TLS
WebSocket to the hub; the hub never dials in.

## Concepts

| Term             | Meaning                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Import Agent     | Registered identity in the hub; binds runtime, policy, and audit                              |
| Enrollment token | Single-use, ~24 h TTL secret issued at create/rotate; exchanged once for a durable credential |
| Agent credential | Durable bearer token the agent stores and uses on the stream                                  |
| Agent session    | One connected episode; recorded with address/versions in connection history                   |

## Deploy

```bash
docker build -f Dockerfile.agent -t componode-agent:latest .

docker run -d --name componode-agent \
  -e HUB_URL=https://hub.example.com \
  -e AGENT_ENROLLMENT_TOKEN_FILE=/run/secrets/enroll_token \
  -v ./enroll_token:/run/secrets/enroll_token:ro \
  -v componode-agent-state:/state \
  -e AGENT_STATE_DIR=/state \
  componode-agent:latest
```

The agent enrolls once, writes its durable credential to
`/state/agent-token` (mode `0600`), then connects and holds the stream.
Restarts reuse the persisted credential — the enrollment token is not
needed again, and its read-only mount can be removed after first boot.
`*_FILE` paths must be mounted explicitly (a bind mount as above, or a
Docker secret under `/run/secrets/` on Swarm) — nothing inside the image
creates them.

## Configuration

| Variable                                  | Required | Default                                | Notes                                                                                                                                        |
| ----------------------------------------- | -------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `HUB_URL`                                 | yes      | —                                      | `https://` (or `wss://`). `http://`/`ws://` are refused except for loopback hosts (local dev). There is no skip-verify option — fail closed. |
| `AGENT_ENROLLMENT_TOKEN`                  | one of   | —                                      | Single-use token from the create/rotate dialog                                                                                               |
| `AGENT_ENROLLMENT_TOKEN_FILE`             | one of   | —                                      | Preferred: path to a file containing the token                                                                                               |
| `AGENT_TOKEN` / `AGENT_TOKEN_FILE`        | no       | —                                      | Skip enrollment by supplying a durable credential directly                                                                                   |
| `AGENT_STATE_DIR`                         | no       | `./.agent-state` (container: `/state`) | Must be writable and persistent; holds `agent-token`                                                                                         |
| `SECRETS_DIR`                             | no       | `/run/secrets`                         | Base directory for `{file: "…"}` secret references of `AGENT_MANAGED` credentials; paths must stay relative — absolute paths and `..` escapes are rejected |
| `CA_BUNDLE`                               | no       | system CAs                             | Path to a PEM bundle for internal/private CAs                                                                                                |
| `MAX_JOBS`                                | no       | `1`                                    | Reported to the hub in `hello` capabilities                                                                                                  |
| `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` | no       | —                                      | Standard egress proxy support                                                                                                                |

Credential precedence: `AGENT_TOKEN_FILE` → `AGENT_TOKEN` → persisted
`<AGENT_STATE_DIR>/agent-token` → enrollment exchange.

## Lifecycle

- **Rotate** (Administration → Import Agents → detail): issues a fresh
  enrollment token and clears revocation. The old credential keeps working
  until the new token is exchanged; on successful exchange the old session
  is superseded and dropped.
- **Revoke**: immediately invalidates the credential and drops any live
  session. Reconnect attempts get `401` and the agent exits.
- **Delete**: blocked while importer configs are bound to the agent;
  otherwise removes the record and its connection history. A running
  agent's next reconnect gets `401` and exits.

## Behavior notes

- **Reconnect**: network drops and hub `shutdown` closes retry with
  exponential backoff + jitter (1 s → 60 s cap).
- **No retry**: `superseded` (a duplicate credential is live elsewhere —
  fix the deployment instead of flapping), handshake mismatches
  (`protocol_mismatch`, `importer_mismatch` — upgrade/rebuild the agent
  image), and `401` at upgrade (revoked/deleted).
- **Exit codes** distinguish terminal causes: `0` clean end (normal close
  or reconnect budget exhausted), `1` credential rejected / startup
  failure, `2` protocol or importer mismatch (rebuild the agent), `3`
  superseded/replaced by a newer credential (do not auto-restart).
- **Lockstep versions**: the agent must report exactly the hub's importer
  set and protocol version or the handshake is rejected — rebuild the
  agent image from the same commit as the hub.
- **Hub-side timing overrides**: `AGENT_STALE_AFTER_MS` (default 90 000),
  `AGENT_SESSION_SWEEP_MS` (15 000), `AGENT_HELLO_TIMEOUT_MS` (5 000), and
  `AGENT_CREDENTIAL_TEST_TIMEOUT_MS` (30 000 — remote credential-test
  window) can be overridden via environment on the **hub** — intended for
  tests and tuning; the spec-fixed defaults are the supported values.

## Agent-managed credentials (spec 026)

`AGENT_MANAGED` credentials store **reference names only** on the hub —
`{env: "VAR"}` or `{file: "relative/path"}` per secret key. The agent
resolves them on its host when a credential test (and later, a run) needs
values; secret material never crosses the WebSocket in either direction.

- `env` refs read `process.env` **at resolve time** — rotating a value is
  purely agent-side: update the env var or remount the file; the hub
  record needs no change and nothing re-encrypts.
- `file` refs are confined to `SECRETS_DIR` (default `/run/secrets`);
  contents are trimmed. Confinement is enforced through `realpath` — a
  symlink inside `SECRETS_DIR` pointing outside it is rejected.
- Resolution events are logged with key name + source type only —
  never values.

## Hardening

- Prefer `*_FILE` secrets (Docker secrets / mounted files) over env vars —
  env values leak via `/proc/<pid>/environ`, `docker inspect`, and crash
  dumps; mounted files do not. The same applies to the agent token itself —
  use `AGENT_TOKEN_FILE` where the platform supports it.
- Importer secrets for `AGENT_MANAGED` credentials follow the same rule:
  mount them under `SECRETS_DIR` (Kubernetes secrets → volumes, Docker
  secrets → `/run/secrets`, Vault agent → files) rather than baking them
  into env vars.
- Encryption at rest for the secrets directory is delegated to the
  platform (`encryptionConfiguration` on Kubernetes, encrypted Swarm
  secrets, Vault-managed mounts); the agent reads plaintext files at
  resolve time.
- Mount `AGENT_STATE_DIR` on a persistent volume with tight permissions;
  the `agent-token` file is a durable credential.
- Use `CA_BUNDLE` for hubs on internal CAs — never disable verification.
- Run one agent process per agent identity; a second connection with the
  same credential supersedes (and exits) the first.

## Troubleshooting

| Symptom                               | Cause                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `no credential material` at startup   | No token env/file and no persisted credential — pass an enrollment token     |
| `enrollment rejected by hub (401)`    | Token is used, expired (~24 h), or mistyped — rotate a new one               |
| `credential rejected (401)` on stream | Agent revoked or deleted — rotate to re-enable, or recreate                  |
| `importer_mismatch` close             | Agent image built from a different commit than the hub — rebuild in lockstep |
| `refuses insecure` config error       | `HUB_URL` is `http://`/`ws://` to a non-loopback host — use TLS              |
