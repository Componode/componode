# Agent wire protocol (v1)

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
       protocolVersion: 1,                                  // AGENT_PROTOCOL_VERSION
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
       protocolVersion: 1,
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
  { type: "heartbeat", payload: { currentJobs: 0, maxConcurrentJobs: 1, activeRunIds: [] } }
  ```

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

## Reserved types (027)

Schema-defined but unhandled in this spec — receiving one yields `error` +
close (version drift signal):

`job.assign`, `job.ack`, `asset.batch`, `phase`, `run.complete`,
`run.error`, `cancel`.

## Metrics

`import_agents_connected` (gauge), `agent_sessions_total{agent,reason}`,
`agent_stream_rejected_total{reason}`,
`agent_credential_tests_total{agent,result}` — `result` is `ok` |
`error` | `offline` | `timeout`.
