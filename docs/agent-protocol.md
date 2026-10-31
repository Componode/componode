# Agent wire protocol (v2)

Implementer reference for the Import Agent control channel (spec 025,
ADR-116). The normative schema lives in
`packages/core/src/contracts/agent-protocol.ts`; this document explains the
flow and semantics.

## Transport

- One **outbound** `wss://` WebSocket per agent:
  `GET {HUB_URL}/api/v1/agent/stream` with
  `Authorization: Bearer <durable-credential>`.
- `ws://` is permitted only for loopback hubs (local dev).
- All frames are JSON text: `{ "type": string, "runId"?: string, "payload": object }`.
- Enrollment is a separate one-shot POST:
  `POST {HUB_URL}/api/v1/agent/enroll` with `{ "token": "<enrollment-token>" }`
  → `{ "agentToken": "<durable-credential>", "agent": ImportAgent }`.

## Handshake (lockstep)

1. Hub authenticates the upgrade (unknown/revoked credential → `401`; no
   audit row is written for rejections).
2. Agent's **first frame must be `hello`** within `AGENT_HELLO_TIMEOUT_MS`:

   ```ts
   {
     type: "hello",
     payload: {
       protocolVersion: 3,                                  // AGENT_PROTOCOL_VERSION
       agentVersion: "<semver>",
       importers: [{ name: "github", version: "1.0.0" }, …], // compiled manifest set
       capabilities: { maxConcurrentJobs: 1 },
     },
   }
   ```

3. Hub validates: schema → `protocolVersion` equality → **exact**
   importer name+version parity with the hub's manifest set. Failure →
   `error` frame (`AGENT_VERSION_MISMATCH` for parity drift, `INVALID_HELLO`
   for a malformed/missing/timed-out hello) then `close`
   `{reason: "protocol_mismatch" | "importer_mismatch" | "invalid_hello"}`.
4. On success the hub supersedes any incumbent session for the agent
   (old socket gets `close{reason:"superseded"}`), inserts an
   `agent_sessions` row, marks the agent `CONNECTED`, and replies:

   ```ts
   {
     type: "hello.ok",
     payload: {
       protocolVersion: 3,
       agentId: "<uuidv7>",
       name: "<agent-name>",
       allowedImporters: ["github", …],   // hub-managed policy (ADR-116)
       heartbeatIntervalMs: 30000,
       maxConcurrentJobs: 1,
       serverTime: "<ISO>",
     },
   }
   ```

## Steady state

- Agent sends `heartbeat` every `heartbeatIntervalMs` (30 s default):

  ```ts
  {
    type: "heartbeat",
    payload: {
      currentJobs: 0,
      maxConcurrentJobs: 1,
      activeRunIds: [],
      // ops snapshot (spec 028, protocol v2) — optional; agents that send
      // none degrade to "not reported by this agent" on hub read surfaces
      ops: {
        reportedAt: "<ISO>",
        uptimeSeconds: 61,
        activeJobs: 1,
        jobs: { assigned: 4, completed: 2, failed: 1, cancelled: 1 },
        assetsStreamed: 87,
        credentialTests: { dispatched: 2, succeeded: 1, failed: 1 },
        secretResolutionFailures: 1,
        reconnects: 2,
      },
    },
  }
  ```

  `ops` carries process-lifetime counters (they reset on agent restart)
  sampled at send time — `jobs`/`credentialTests` are cumulative totals,
  never secret material. The hub persists the latest snapshot verbatim to
  `import_agents."reportedStatus"` (replace-on-write) with a hub-stamped
  `receivedAt`, and exposes it on `GET /agents/{id}` labeled
  agent-reported. The snapshot survives disconnects — freshness is the
  separate `lastHeartbeatAt`/`lastSeenAt` signal.

  Each frame (heartbeat or otherwise) refreshes the hub's `lastContactAt`
  and persists `import_agents.lastSeenAt`. There is **no ack** — silence is
  normal.

- Sessions silent for `> AGENT_STALE_AFTER_MS` (90 s) are swept:
  `close{reason:"shutdown"}` then socket close; recorded as
  `heartbeat_timeout`.

## Close semantics

`close` frame payload:

```ts
{
  reason: "normal" | "invalid_hello" | "protocol_mismatch"
        | "importer_mismatch" | "superseded" | "replaced"
        | "revoked" | "shutdown",
  detail?: string,
  supportedVersions?: number[],
}
```

Agent-side reaction:

| Reason                                                    | Agent behavior                                      |
| --------------------------------------------------------- | --------------------------------------------------- |
| `superseded`, `replaced`                                  | Exit 3 — another live session holds this credential |
| `invalid_hello`, `protocol_mismatch`, `importer_mismatch` | Exit 2 — rebuild in lockstep with the hub           |
| `revoked`                                                 | Exit 1 — credential dead                            |
| `shutdown`, `normal`                                      | Reconnect with backoff                              |
| (no close frame) network drop                             | Reconnect with backoff                              |
| HTTP `401`/`403` at upgrade                               | Exit 1 — credential revoked or agent deleted        |
| HTTP `429`/other                                          | Reconnect with backoff                              |

Agent → hub `close` is optional; a clean socket close records
`client_close`, and `close{reason:"shutdown"}` records `shutdown`.

## `error` frame

```ts
{ type: "error", payload: { code: string, message: string, runId?: string } }
```

Protocol-level failures (`AGENT_VERSION_MISMATCH`, `INVALID_HELLO`,
`BAD_FRAME`, `UNSUPPORTED_FRAME`, hello timeout). Fatal errors are followed by a
terminal `close` frame and/or WebSocket close code `1008`. Rejected handshakes
write **no** audit rows; only metrics (`agent_stream_rejected_total`). The
rule is symmetric: an agent that receives an unparseable or reserved frame
from the hub answers `error` + socket close and exits terminally
(`protocol_mismatch` → exit 2).

## Credential test (spec 026)

Remote test of an `AGENT_MANAGED` credential — the hub never sends secret
values, only reference names the agent resolves locally.

Hub → agent:

```ts
{
  type: "credential.test",
  payload: {
    testId: "<uuid>",        // correlation id
    credentialId: "<uuid>",
    importerName: "github",
    scope?: { … },            // optional importer scope overrides
    secretRefMap: { token: { env: "GH_TOKEN" } },  // refs only — never values
  },
}
```

Agent → hub:

```ts
{ type: "credential.test.result", payload: { testId: "<uuid>", ok: true, error?: "…" } }
```

Semantics:

- The agent resolves each ref against its env / `SECRETS_DIR` (identical
  semantics to hub-side `env`/`file` refs — shared code in
  `packages/core/src/utils/secrets.ts`), loads the importer by
  `importerName`, and calls its `testSecrets` hook.
- Refs carry source names only; resolved values never cross the wire in
  either direction. `error` must name the failing key and source type,
  never a value, and never an absolute filesystem path — a missing
  `testSecrets` hook replies `error:"MANIFEST_NO_TEST: …"`.
- The hub correlates results by `testId`; results with unknown ids are
  ignored. One outstanding test per dispatch — a hub-side timer
  (`AGENT_CREDENTIAL_TEST_TIMEOUT_MS`, 30 s) fails the request with
  `AGENT_TEST_TIMEOUT`; a disconnect mid-test rejects the pending request.
- An agent that cannot run the test (unknown importer, no `testSecrets`
  hook, unresolvable ref) still answers `credential.test.result` with
  `ok:false` — it must not silently drop the frame.

## Session records

Every accepted session persists: `connectedAt`, `disconnectedAt`,
`disconnectReason` (`client_close` | `heartbeat_timeout` | `revoked` |
`shutdown` | `superseded` | `replaced`), `remoteAddress`, `agentVersion`,
`protocolVersion`, `importerVersions`. Deleting an agent cascades this
history.

## Remote job execution (spec 027)

A remote run is one `job.assign` → `job.ack` → stream → `run.complete`
conversation over the same session. `runId` in the envelope correlates
every job frame; one job = one `import_runs` row.

Hub → agent:

```ts
{
  type: "job.assign",
  runId: "<uuid>",
  payload: {
    importerName: "kubernetes",
    scope: { /* importer_configs.scope verbatim */ },
    secretRefMap: { token: { env: "PROD_TOKEN" } },  // refs merged across
    // the config's AGENT_MANAGED credentials — names, never values;
    // absent when no credentials are linked
  },
}
```

Agent → hub:

```ts
{ type: "job.ack", runId, payload: { accepted: true } }
{ type: "job.ack", runId, payload: { accepted: false, reason: "…" } }  // NACK
{ type: "asset.batch", runId, payload: { assets: [DiscoveredAsset, …] } }
{ type: "phase", runId, payload: { name: "Fetching nodes" } }            // ≤200 chars
{ type: "run.error", runId, payload: { assetExternalId?, errorType, errorMessage } }
{ type: "run.complete", runId, payload: { result: "COMPLETED" | "CANCELLED"
    | "FAILED", errorType?, errorMessage? } }
```

Hub → agent (cancellation):

```ts
{ type: "cancel", runId, payload: { runId } }
```

Semantics:

- `job.ack{accepted:false}` fails the run: a reason beginning
  `SECRET_RESOLUTION_FAILED` → `FAILED` with that errorType; a reason
  beginning `AGENT_UNAVAILABLE` (transient refusals like capacity) →
  `FAILED`/`AGENT_UNAVAILABLE`; any other → `FAILED`/`AGENT_INCOMPATIBLE`
  with the reason echoed. No ack within `AGENT_JOB_ACK_TIMEOUT_MS` (15 s)
  → `FAILED`/`AGENT_UNAVAILABLE`, and the hub sends `cancel` so the
  unacknowledged job aborts agent-side.
- `asset.batch` — ≤100 assets or ~1 MB serialized per frame, whichever
  comes first (agent-side duty). A single asset exceeding the frame cap
  is reported via `run.error{errorType:"ASSET_TOO_LARGE"}` and skipped —
  the run continues.
- `run.error` inserts one `import_run_errors` row; non-fatal.
- `run.complete` is terminal: `COMPLETED` triggers the same reconcile +
  edge-suggestion pass as in-process runs; `CANCELLED`/`FAILED` finalize
  directly. `FAILED` error text is `maskSecretValues`-scrubbed agent-side
  before send.
- `cancel` aborts the agent's job token; the agent's
  `run.complete{result:"CANCELLED"}` is the confirmation. A queued
  (not yet assigned) run cancels hub-side immediately.

Ordering & violation rules:

```text
hub:   job.assign ───────────────▶ agent
agent: job.ack (accepted) ───────▶ hub → RUNNING
agent: {phase | asset.batch | run.error}*   (any order, only while ACKED)
agent: run.complete ─────────────▶ hub → terminal
hub:   cancel (any time after assign) → agent aborts → run.complete{CANCELLED}
```

- The hub processes agent→hub frames **serially per session** — a batch's
  writes fully land before a following `run.complete` finalizes.
- `asset.batch`/`phase`/`run.error`/`run.complete` for a run the hub never
  assigned on that session → `error` + close `1008` — same rule as
  unhandled frames.
- The same frames for a run the hub **already finalized** on that session
  (ack-timeout, cancel, dead-run) → discarded (warn-log) — a zombie agent
  job must not take down the session and its collateral runs.
- `job.ack` for an unassigned or dead runId → ignored (warn-log); a late
  ack after ack-timeout/disconnect must not resurrect anything.
- An agent receiving `job.assign`/`cancel` frames it does not implement is
  a drifted hub — `error` + exit, same as other unhandled frames.
- Disconnect → hub fails every in-flight run on that session
  `AGENT_LOST`; the agent aborts every local job. No resume in v1 —
  hub-restart recovery also fails remote runs `AGENT_LOST` instead of
  `INTERRUPTED`.
- Queued (not yet assigned) runs survive a disconnect — the dispatch
  deadline (`AGENT_DISPATCH_TIMEOUT_MS`, 10 min) bounds their wait and
  fails them `AGENT_UNAVAILABLE` on expiry.
- Heartbeat carries real `currentJobs`/`activeRunIds` (informational;
  dispatch gating uses the hub's in-flight map, not heartbeat contents).

## Metrics

`import_agents_connected` (gauge), `agent_sessions_total{agent,reason}`,
`agent_stream_rejected_total{reason}`,
`agent_credential_tests_total{agent,result}` — `result` is `ok` |
`error` | `offline` | `timeout`;
`agent_jobs_total{agent,result}` — `result` is `completed` | `failed` |
`cancelled` | `lost` | `unavailable` | `incompatible`;
`agent_assets_received_total{agent,importer}`.

Ops observability series (spec 028): `agent_dispatch_wait_seconds{agent}`
(run created → `job.assign` sent),
`agent_remote_job_duration_seconds{agent,importer}` (assign → finalize),
`agent_session_duration_seconds{agent,reason}` (session lifetime at close),
`agent_last_contact_timestamp_seconds{agent}` (gauge — unix time of the
last accepted frame).

The agent process also exposes its own Prometheus surface — see
`docs/agents.md` § Operations observability.

## Protocol v3 — source.identity (spec 044)

`AGENT_PROTOCOL_VERSION` is 3. Adopting importers (`manifest.reportsSourceIdentity`)
report their provider-native Source identity before the first `asset.batch`
via the job-stream frame `source.identity` (`{runId, externalIdentity,
label?}`) — required even for empty inventories. The agent fails the job
`CONTRACT_VIOLATION` on yield-before-report; the hub fails closed likewise
and registers-or-matches the `ImporterSource`, binds the config, and stamps
`import_runs.sourceId`.

Manifests declaring `targetRefKey` get agent-local target preflight:
`${SECRETS_DIR}/{importerName}-targets.json` (envelope `{version: 1,
targets: {<targetId>: {transport, ...}}}`) is the allowlist, loaded fresh
per `job.assign`; failures NACK `TARGET_RESOLUTION_FAILED` before any
network access. `context.resolveTarget(targetId)` returns the resolved
non-secret profile on the agent.
