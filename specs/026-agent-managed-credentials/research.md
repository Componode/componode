# Research: Agent-Managed Credentials (spec 026)

**Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md) |
**Ratified anchors**: ADR-117, ADR-116 (Amendment 1), ADR-107

All spec-level decisions are ratified. This document resolves the remaining
implementation-level choices; anything that extends an enumerated ADR
surface (error codes, audit actions, metrics, wire frames) is flagged for
**ADR-117 Amendment 1** in the same change (per the repo's ADR-fidelity
rule).

## R1 — `secretRefMap` shape

**Decision**: `credentials.secretRefMap` (jsonb) =
`Record<keyName, SecretRef>` where `SecretRef` is exactly one of
`{ "env": "<VAR_NAME>" }` or `{ "file": "<name>" }` — zod `.strict()`
object with a refine enforcing exactly one source key, key names reuse the
existing `secretKeyPattern` (`^[a-zA-Z][a-zA-Z0-9_]{0,63}$`), and the map is
capped like `secrets` (≥1 entry, ≤64 KB serialized).

**Rationale**: the ADR's canonical examples are keyed maps; keying by
declared key name makes `assertSecretCoverage`/`checkKeyCollisions` read
keys identically to stored credentials and makes per-credential ref
ownership unambiguous (the multi-credential collision the ADR calls out).

**Alternatives**: tuple array `{key, env|file}[]` — duplicates the key
outside the map and invites duplicate-key states the map form makes
unrepresentable. Opaque string refs — rejected in ADR-117 (defeats
coverage/pre-checks).

## R2 — `keyHints` content for `AGENT_MANAGED`

**Decision**: `keyHints[keyName] = <source type>` — `"env"` or `"file"`.
Key names remain the declared-keys source everywhere; the value carries a
displayable, non-secret hint (which source family resolves it).

**Rationale**: `Object.keys(keyHints)` is already how
`validateSecretSources` derives provided keys and how the UI lists covered
keys — unchanged mechanically (ADR-117 #3). `"env"`/`"file"` values give
the credential list something meaningful to render where stored creds show
last-4; never a value fragment.

**Alternatives**: empty-string values — works, but discards free metadata
the UI can badge. A second `sourceTypes` column — duplicated source of
truth for zero gain.

## R3 — `credential.test` / `credential.test.result` frames

**Decision**: promote both from `FUTURE_AGENT_MESSAGE_TYPES` to real
schemas in `agent-protocol.ts`:

- `credential.test` payload: `{ testId: uuid, credentialId: uuid,
  importerName: string, scope?: Record<string,unknown>,
  secrets: Record<keyName, SecretRef> }`
- `credential.test.result` payload: `{ testId: uuid, ok: boolean,
  error?: string }`

Correlation is the payload `testId` (uuid v7, hub-generated). The envelope
`runId` is NOT used — a credential test is not an import run; reusing it
would corrupt run-correlation queries. Result carries `ok`/`error` only —
no secret material, no resolved values.

**Alternatives**: correlate via envelope `runId` — rejected (semantic
collision with `import_runs`). Sequential one-test-at-a-time without ids —
couples correctness to dispatch ordering.

## R4 — Hub-side dispatch mechanics

**Decision**: `AgentSessionService` gains
`dispatchCredentialTest(agentId, payload) → Promise<{ok, error?}>`:

- Looks up the live session (none → `AGENT_OFFLINE`).
- Sends `credential.test`; registers `testId` in a pending-request map with
  a timeout (`AGENT_CREDENTIAL_TEST_TIMEOUT_MS`, default 30 000, env-tunable
  like the other timing constants).
- `onFrame` learns `credential.test.result` — resolves the pending entry.
  The current "unhandled frame → close" rule stays for genuinely unknown
  types.
- `closeSession` rejects all pending entries so a mid-test disconnect fails
  fast instead of hanging.

Bound-agent selection: `credential-service.testCredential` (AGENT_MANAGED
branch) loads configs referencing the credential via
`importer_config_credentials`, restricted to `agentId IS NOT NULL` **and**
`importerName === input.importerName` (the test must exercise the importer
that will actually run); among those, the first (earliest-created) config
whose agent is CONNECTED. None bound → `CREDENTIAL_NO_BOUND_AGENT` (400);
bound but all offline → `AGENT_OFFLINE` (503).

Audit per ADR-116 #12: `credential_test_dispatched` (new
`AGENT_AUDIT_ACTIONS` entry — ratify in the amendment) on the `import_agent`
entity with the acting admin as actor; the existing `tested` action on the
credential entity gains `agent` in `changes`. `lastUsedAt` stamps on
dispatch.

**Alternatives**: admin picks the target agent in the test dialog —
rejected for v1 (spec US3.5: refs are agent-relative, any bound host is a
valid probe; a selector adds UI for no semantic gain). Fan-out to all bound
agents — rejected (surprising N× external calls from one button).

## R5 — Kind enforcement at config save

**Decision**: `validateSecretSources` selects `kind` too and compares it to
the config's `agentId`:

- `AGENT_MANAGED` credential + `agentId IS NULL` → `CREDENTIAL_KIND_MISMATCH`
  (400, "requires a config bound to an import agent").
- `STORED` credential + `agentId` set → `CREDENTIAL_KIND_MISMATCH` (400,
  "agent-bound configs require agent-managed credentials").
- OIDC `clientSecretCredentialId` setter rejects `kind !== 'STORED'` with
  the same code.

In 026 `agentId` is unsettable through the API (027), so the first rule is
immediately live and the second is exercised by direct-DB tests — exactly
the spec-025 `AGENT_IN_USE` pattern.

**Defense-in-depth**: `resolveImportSecrets`'s `CredentialRecord` gains
`kind`; an `AGENT_MANAGED` record reaching in-process resolution fails fast
(`CREDENTIAL_KIND_MISMATCH`) rather than decrypting a NULL payload.

## R6 — Shared secret-ref resolver in `packages/core`

**Decision**: move `SecretRef` + `EnvSecretResolver` + `redactSecrets` from
`packages/backend/src/utils/secret-resolver.ts` into
`packages/core/src/utils/secrets.ts`; backend re-exports for existing
imports. The agent instantiates the same resolver class with its own
`SECRETS_DIR` (default `/run/secrets` — same as hub).

**Rationale**: ADR-117 amends ADR-055 so ref semantics are *identical* on
both sides — a shared implementation makes drift structurally impossible.
Core is a leaf and the resolver depends only on `node:fs`/`node:path`.

The **resolver seam** (future `vault`/`ssm` refs) is the `SecretRef`
union — a new key adds a source type both sides parse once. No abstract
factory needed in v1.

**Alternatives**: duplicate the resolver in `packages/agent` — rejected
(drift risk on a security boundary, and 025 already centralized the
importer registry in core for the same reason).

## R7 — Agent-side `credential.test` handling

**Decision**: `client.ts` learns the frame: on `credential.test`, resolve
`payload.secrets` via the shared resolver (agent's `SECRETS_DIR`), call
`importer.testSecrets(secrets, scope)` (registry lookup by `importerName`,
same injected loader as the hello manifest list), reply
`credential.test.result`. Resolution events log `{key, source}` only —
never values — and `redactSecrets` wraps any structured fields that could
carry values.

Missing env var / path escape / unknown ref type → `{ok:false, error}`
naming key + source type. Importer lacks `testSecrets` → `{ok:false}`
with the `MANIFEST_NO_TEST` message (the hub-side 400 check stays for the
in-process path; the agent can't 400 — it reports in-band).

**Alternatives**: hub resolves which importer keys to send — rejected; the
manifest already declares them and the agent holds the compiled set.

## R8 — API surface changes

**Decision**:

- `Credential` contract gains `kind: "STORED" | "AGENT_MANAGED"` and
  `secretRefMap?: Record<keyName, SecretRef>` (present for AGENT_MANAGED;
  references are names, not secret — readable).
- `createCredentialSchema` becomes a discriminated union on `kind`
  (default `STORED`): stored → `secrets`; agent-managed → `secretRefMap`.
  `updateCredentialSchema` gains `secretRefMap` (AGENT_MANAGED only) —
  kind immutability is enforced by absence of `kind` on the update schema.
- `testCredential` branches on kind (in-process path untouched).
- No `?kind=` list filter yet — the 027 Execution selector adds it when it
  needs it (YAGNI); responses carry `kind` so client-side filtering works.

New `ERROR_CODES` entries (ratify in the same change — enumerated surface):
`AGENT_OFFLINE` (503), `CREDENTIAL_NO_BOUND_AGENT` (400),
`CREDENTIAL_KIND_MISMATCH` (400), `AGENT_TEST_TIMEOUT` (504).

New metric (ratify — ADR-116 #10 enumerates the series):
`agent_credential_tests_total{agent,result}`.

## R9 — Migration shape (017)

**Decision**: `017_agent_managed_credentials.ts`:

- `credentials.kind text NOT NULL DEFAULT 'STORED'` + CHECK against a new
  `CREDENTIAL_KINDS` constant in core (`credential-kind.ts`).
- `credentials.secretRefMap jsonb NULL`.
- `encryptedPayload` drops NOT NULL.
- Coherence CHECK: `(kind='STORED' AND encryptedPayload IS NOT NULL AND
  secretRefMap IS NULL) OR (kind='AGENT_MANAGED' AND secretRefMap IS NOT
  NULL AND encryptedPayload IS NULL)`.
- `keyVersion` stays NOT NULL DEFAULT 1 — meaningless-but-harmless for
  agent-managed rows; relaxing it buys nothing.

`CredentialRow` gains `kind: string`, `secretRefMap: Record<string,
{env?:string; file?:string}> | null`; `encryptedPayload` becomes
`string | null`.

## R10 — UX surface

**Decision**: credential create/edit dialog gains the mode selector
("Stored in Componode" | "Resolved on an Import Agent") — agent-managed
mode renders per-key rows (key + env|file + reference name) replacing the
value inputs; list gains an `Agent-managed` badge on kind; detail dialog
renders the ref map read-only-ish (editable via the same row editor for
updates). The Test button is unchanged — its remote path is transparent.
Non-goal for 026: Execution selector in the config form (027 binding UI).

`docs/ux.md` updated in the same change per ADR-103.

## Ratification checklist (lands in the same PR)

ADR-117 **Amendment 1** records: the four new error codes, the
`credential_test_dispatched` audit action on `import_agent`,
`agent_credential_tests_total` metric, `testId` correlation field, and the
keyHints-source-type convention. Back-pointer edits: none needed beyond the
amendment itself (ADR-116's amends-list entry for "spec 026 codes" is
already phrased as 026/027).
