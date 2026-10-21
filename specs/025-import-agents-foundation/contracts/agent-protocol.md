# Contract — Agent Wire Protocol (spec 025 subset)

The full v1 protocol is ratified in ADR-116 and documented for
implementers in `docs/agent-protocol.md`. **This spec implements only
`hello`, `heartbeat`, and the close/error paths** — job/asset/credential
frames are part of the shared schema (so 026/027 don't rev the contract)
but have no handlers yet.

## Envelope

All frames are JSON text messages, Zod-validated on receipt
(`packages/core/src/contracts/agent-protocol.ts`):

```ts
{ type: string, runId?: string, payload: object }
```

Unknown/malformed frames → send `error` frame → close (1008 policy
violation). Unknown `type` values → `error` frame + close (never
silently ignored — a 026/027 frame reaching this build indicates version
drift).

## Message types

### `hello` — agent → hub, first frame, required

```ts
{
  protocolVersion: number,          // must equal AGENT_PROTOCOL_VERSION (1)
  agentVersion: string,             // agent package version
  importers: { name: string, version: string }[],  // compiled manifest set
  capabilities: { maxConcurrentJobs: number }      // default 1
}
```

Hub validates (in order): schema → `protocolVersion` → each
`importers` entry name+version vs the hub's manifest set (exact match —
lockstep, R11). Any parity mismatch → `error` frame
`{code:"AGENT_VERSION_MISMATCH", message}` + close; a missing/malformed or
non-hello first frame (or hello timeout) → `{code:"INVALID_HELLO"}` +
`close{reason:"invalid_hello"}`. Both paths logged, counted
(`reason="version_mismatch"`), not audited. On success the hub inserts
the `agent_sessions` row, updates the agent record (versions, capacity,
`status=CONNECTED`, `lastSeenAt`), and replies `hello.ok`:

### `hello.ok` — hub → agent

```ts
{
  protocolVersion: number,
  agentId: string,
  name: string,
  allowedImporters: string[],       // hub-managed policy (ADR-116)
  heartbeatIntervalMs: number,      // 30 000 default
  maxConcurrentJobs: number,
  serverTime: string,               // ISO
}
```

After `hello.ok` the session is live; before it, any non-`hello` frame →
`error` + close.

### `heartbeat` — agent → hub, every ~30 s

```ts
{ currentJobs: number, maxConcurrentJobs: number, activeRunIds: string[] }
// job fields are 0/[] in this spec — reserved shape for 027
```

Hub records `lastContactAt` (in-memory) and `import_agents.lastSeenAt`.
No ack frame — silence is normal.

### `close` — hub → agent, before hub-initiated disconnect

```ts
{
  reason: "normal" | "invalid_hello" | "protocol_mismatch"
        | "importer_mismatch" | "superseded" | "replaced"
        | "revoked" | "shutdown",
  detail?: string,
  supportedVersions?: number[],
}
```

Sent before the hub drops a session on revoke, credential-supersede
(second connect wins), handshake rejection, a malformed/non-`hello` first
frame (`invalid_hello`), or server shutdown. Agent
treats it as terminal-for-reason: `revoked`/`superseded`/`replaced` → do
not retry (permanent — a duplicate live credential is a deployment error,
and retrying would flap the session); `invalid_hello` + handshake
mismatches → exit and rebuild in lockstep; `shutdown`/`normal` →
reconnect with normal backoff.
If the close frame is lost in a hard drop, the reconnect attempt's `401`
(or success) is the authoritative signal.

### `error` — either direction

```ts
{ code: string, message: string, runId?: string }
```

Protocol-level errors. Codes: `BAD_FRAME` (unparseable), `UNSUPPORTED_FRAME`
(parsed but unhandled/reserved type), `INVALID_HELLO` (malformed/missing
hello), `AGENT_VERSION_MISMATCH` (protocol/importer parity). Followed by
socket close when fatal — and applies in **both directions**: an agent
receiving a reserved/unknown/malformed frame from the hub likewise sends
`error` + closes (drift signal).

## Reserved v1 types (schema-defined, unhandled until 026/027)

`job.assign`, `job.ack`, `asset.batch`, `phase`, `run.complete`,
`run.error`, `cancel`, `credential.test`, `credential.test.result`.
Receiving one in this spec → `error` + close (drift signal).

## Session lifecycle (hub)

```text
upgrade auth (bearer) → await hello (5 s timeout / malformed /
non-hello first frame → error + close{invalid_hello})
→ validate hello (protocol + importer parity → error + close{mismatch})
→ supersede check (close existing, "superseded") → session row INSERT
→ live: heartbeats update lastContactAt
→ close paths:
    clean socket close        → disconnectedAt=now, "client_close"
    sweep: >90 s no contact   → close socket, "heartbeat_timeout"
    admin revoke              → close socket, "revoked"
    second connect same cred  → old socket closed, "superseded"
    server shutdown           → "shutdown"
→ status: CONNECTED → OFFLINE on any close
```
