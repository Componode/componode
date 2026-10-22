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
| `AGENT_OPS_HOST`                          | no       | `0.0.0.0`                              | Bind address for the operations listener — `127.0.0.1` for local-only                                                                        |
| `AGENT_OPS_PORT`                          | no       | `9464`                                 | Operations listener port                                                                                                                     |
| `AGENT_OPS_DISABLED`                      | no       | —                                      | `"true"` disables the operations listener entirely                                                                                           |
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
  `AGENT_SESSION_SWEEP_MS` (15 000), `AGENT_HELLO_TIMEOUT_MS` (5 000),
  `AGENT_CREDENTIAL_TEST_TIMEOUT_MS` (30 000 — remote credential-test
  window), `AGENT_DISPATCH_TIMEOUT_MS` (600 000 — how long a queued remote
  run waits for its agent before failing `AGENT_UNAVAILABLE`), and
  `AGENT_JOB_ACK_TIMEOUT_MS` (15 000 — how long the hub waits for
  `job.ack` after `job.assign`) can be overridden via environment on the
  **hub** — intended for tests and tuning; the spec-fixed defaults are
  the supported values.

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

## Remote import execution (spec 027)

An importer config bound to an agent (**Execution** selector on the config
form) runs on that agent instead of in-process. The hub dispatches a
`job.assign` frame over the agent's stream carrying `importerName`, the
config's `scope`, and the merged `secretRefMap` (reference names only) of
its linked `AGENT_MANAGED` credentials.

- **Capacity**: `MAX_JOBS` caps concurrent jobs per agent. Runs beyond
  capacity queue on the hub and dispatch in FIFO order as slots free.
- **Streaming**: the agent runs the importer's generator locally and
  streams `phase`, `asset.batch` (≤100 assets or ~1 MB), `run.error`, and
  `run.complete` frames. The hub applies the same validation, upsert,
  reconciliation, and suggestion logic as in-process runs.
- **Failures**: offline/blocked dispatch → `AGENT_UNAVAILABLE`; agent NACK
  → `AGENT_INCOMPATIBLE` (or `SECRET_RESOLUTION_FAILED` when the reason
  says so); session loss or hub restart → `AGENT_LOST` — remote runs are
  bound to their session and are **never resumed**; a single oversized
  asset → `ASSET_TOO_LARGE` run error, run continues.
- **Cancellation**: cancelling a run sends a `cancel` frame; the agent
  aborts the importer's abort token and confirms with
  `run.complete{result:"CANCELLED"}`. Queued (not yet assigned) runs
  cancel instantly hub-side.
- **Policy drift**: edits to `allowedImporters` flag bound configs
  `agentIncompatible` at read time, and the dispatch-time gate fails the
  next run fast — in-flight runs are unaffected.

## Operations observability (spec 028)

The agent runs a process-local HTTP listener exposing liveness, readiness,
and Prometheus metrics — GET-only, unauthenticated, and never serving
secret material (same posture as the hub's `/metrics`; restrict it with
network policy or bind to loopback).

| Endpoint      | Codes     | Content                                                                                                    |
| ------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /healthz` | `200`    | `{ "status": "ok", "uptimeSeconds": n }` — alive once config is loaded, including during reconnect backoff   |
| `GET /readyz`  | `200`/`503` | `{ "ready": true, "state": "connected", "activeJobs": n }` when the stream is established; `503` with `state` = `connecting` \| `backoff` \| `no-credential` otherwise |
| `GET /metrics` | `200`    | Prometheus exposition (`agent_*` series + default process metrics)                                           |

Other paths return `404`; non-GET methods return `405`. A bind failure
logs a warning and the agent continues enrolling/streaming — the ops
listener is never a reason to exit.

**Metrics catalog** (process-lifetime counters; reset on restart):

| Series                                    | Type    | Labels     |
| ----------------------------------------- | ------- | ---------- |
| `agent_stream_connected`                  | gauge   | —          |
| `agent_sessions_total`                    | counter | `reason`   |
| `agent_reconnects_total`                  | counter | `outcome`  |
| `agent_jobs_received_total`               | counter | —          |
| `agent_jobs_completed_total`              | counter | `result`   |
| `agent_jobs_active`                       | gauge   | —          |
| `agent_assets_streamed_total`             | counter | `importer` |
| `agent_credential_tests_total`            | counter | `result`   |
| `agent_secret_resolution_failures_total`  | counter | —          |

**Container healthcheck**: `Dockerfile.agent` ships a `HEALTHCHECK` that
hits `GET /healthz` on `AGENT_OPS_PORT` (30 s interval, 15 s start-period).
Disabling the listener (`AGENT_OPS_DISABLED=true`) leaves the healthcheck
failing — override or remove the `HEALTHCHECK` in the deployment if you
disable it.

**Restricted-network scraping**: the listener is agent-side, so the
scraper must reach the agent host — for fully egress-only networks, bind
to loopback and scrape via a sidecar/exporter on the same pod or host, or
rely on the hub-side surfaces below and agent logs instead.

**Hub-side visibility**: every heartbeat carries an `ops` snapshot of the
same counters (protocol v2). The hub persists the latest snapshot
(replace-on-write, hub-stamped `receivedAt`) and exposes it on
`GET /agents/{id}` as `reportedStatus` — labeled agent-reported, like the
version fields. `lastHeartbeatAt` is the live session's freshness floor;
`lastDisconnectReason` shows why the most recent session ended. The
detail page renders both. Hub `/metrics` gains
`agent_dispatch_wait_seconds`, `agent_remote_job_duration_seconds`,
`agent_session_duration_seconds`, and
`agent_last_contact_timestamp_seconds` for queue-wait, job-duration,
session-duration, and staleness questions.

**Recommended alerting signals**:

- `agent_stream_connected == 0` for longer than the reconnect budget —
  the agent is alive but cannot hold a session (hub or network issue).
- `rate(agent_reconnects_total[15m])` climbing — flapping connectivity;
  correlate with hub `agent_sessions_total{reason}` (`heartbeat_timeout`
  = network, `revoked`/`superseded` = operator action).
- `increase(agent_secret_resolution_failures_total[1h])` — references on
  the agent host are drifting; runs will NACK `SECRET_RESOLUTION_FAILED`.
- `increase(agent_jobs_completed_total{result="failed"}[1h])` — remote
  jobs failing on the agent side.
- Hub side: `time() - agent_last_contact_timestamp_seconds{agent=…}` for
  staleness alerts, and `agent_dispatch_wait_seconds` p95 to capacity-plan
  `MAX_JOBS`.

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
