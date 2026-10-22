# Contract — Agent Wire Protocol (spec 026 additions)

Extends the 025 contract (`specs/025-import-agents-foundation/contracts/
agent-protocol.md`). This spec promotes two reserved frame types to
implemented: `credential.test` and `credential.test.result`. Everything
else in the envelope/handshake/close semantics is unchanged. The job/asset
frames remain reserved for 027.

Correlation uses a **payload `testId`**, not the envelope `runId` — a
credential test is not an import run (research R3).

## `credential.test` — hub → agent

```ts
{
  testId: string,                              // uuid v7, hub-generated
  credentialId: string,                        // uuid — audit/label context
  importerName: string,                        // importer to probe with
  scope?: Record<string, unknown>,             // optional test scope
  secretRefMap: Record<string, SecretRef>,     // the credential's ref map
}

type SecretRef = { env: string } | { file: string };  // exactly one key
```

The payload carries **references, never values** (ADR-117 — the one
property the whole feature exists for). `secretRefMap` is the credential's
stored map verbatim.

Agent behavior:

1. Resolve each ref agent-side — `env` → `process.env[name]`, non-empty;
   `file` → file under `SECRETS_DIR` (default `/run/secrets`), absolute
   paths, `..` escapes, and symlink escapes (realpath confinement) rejected.
2. On any resolution failure → reply `{ok:false, error}` naming the key +
   source type, never a value and never an absolute path
   (`SecretResolutionError`: `secret reference for key "K" (env|file)
   failed: …`).
3. Otherwise invoke `importer.testSecrets(secrets, scope)` from the
   compiled registry; missing hook → `{ok:false, error:"MANIFEST_NO_TEST…"}`.
4. Log resolution events as `{key, source:"env"|"file"}` only; the agent
   logger mirrors the hub's pino `redact` paths (FR-013).

## `credential.test.result` — agent → hub

```ts
{ testId: string, ok: boolean, error?: string }
```

Hub matches `testId` against its pending-request map; unknown/expired ids
are ignored (the timeout already failed the caller). Results carry no
secret material by construction.

## Hub-side failure modes (surfaced as API errors, not frames)

| Condition | Code | Status |
|---|---|---|
| Credential referenced by no agent-bound config | `CREDENTIAL_NO_BOUND_AGENT` | 400 |
| Bound agent(s) all offline | `AGENT_OFFLINE` | 503 |
| No result within `AGENT_CREDENTIAL_TEST_TIMEOUT_MS` (30 s) | `AGENT_TEST_TIMEOUT` | 504 |
| Session closes mid-test | `AGENT_OFFLINE` (pending rejected on close) | 503 |

## Frame handling changes from 025

- Hub `onFrame`: `credential.test.result` is now handled (resolves the
  pending entry); all other reserved/unknown types still → `error` frame +
  close(1008).
- Agent `message` handler: `credential.test` is now handled; all other
  reserved/unknown types still → `rejectFrame` (`UNSUPPORTED_FRAME`) +
  close.
