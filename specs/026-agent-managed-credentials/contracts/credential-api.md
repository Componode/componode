# Contract — Credential API delta (spec 026)

All routes unchanged in number and shape — `/api/v1/credentials[...]` per
ADR-070/104. This is the payload-contract delta; `docs/openapi.yaml` is
updated in the same change (FR-022).

## `Credential` response object (detail & mutation responses)

```ts
{
  // …existing fields (id, slug, label, status, keyHints, expiresAt,
  //   lastUsedAt, createdBy/updatedBy, timestamps)
  kind: "STORED" | "AGENT_MANAGED",
  secretRefMap?: Record<string, { env?: string; file?: string }>,
  //        present for AGENT_MANAGED only — references are names, not
  //        secret material, so they are readable (ADR-117 #2)
}
```

**List vs detail**: `GET /credentials` (list) omits `secretRefMap` —
`keyHints` carries the `{env|file}` source types so the UI can render
source badges without exposing reference names in list views
(ADR-117 Amendment 1). Detail and mutation responses (`GET /{id}`,
`POST`, `PATCH`) include the map — the openapi schema splits this as
`Credential` (list) vs `CredentialDetail` (detail/mutation).

`keyHints` convention: STORED → last-4 fragments (unchanged);
AGENT_MANAGED → `{keyName: "env"|"file"}` source-type hints (research R2).

## `POST /credentials` — create

Discriminated union on `kind` (absent ⇒ `STORED`, backward compatible):

```ts
// stored (unchanged)
{ kind?: "STORED", label, secrets: Record<key,string>, expiresAt? }

// agent-managed (new)
{ kind: "AGENT_MANAGED", label,
  secretRefMap: Record<key, {env:string} | {file:string}>, expiresAt? }
```

- `secrets` on an AGENT_MANAGED create → `400 VALIDATION_FAILED`.
- `secretRefMap` on a STORED create → `400 VALIDATION_FAILED`.

## `PATCH /credentials/{id}` — update

Unchanged fields (`label`, `expiresAt`, `status:"REVOKED"`) plus:

```ts
{ secretRefMap?: Record<key, SecretRef> }   // AGENT_MANAGED only
```

- `secretRefMap` on a STORED credential → `400` kind-mismatch validation.
- `secrets` on an AGENT_MANAGED credential → `400` kind-mismatch validation.
- `kind` is not updatable — immutable post-create (FR-005).
- Ref-map edits do NOT re-validate dependent configs' coverage (spec
  clarification); a broken config fails `CREDENTIAL_MISSING_KEY` at next
  run/test.

## `POST /credentials/{id}/test` — behavior delta

Request unchanged: `{ importerName, scope? }`. Response gains one optional
field: `{ ok, error?, agent?: string }` — `agent` is set when the test ran
remotely, naming the executing agent (spec US3.5).

- STORED → existing in-process path, untouched.
- AGENT_MANAGED → routed to a bound agent over the stream (see
  `contracts/agent-protocol.md`); new error codes:
  `CREDENTIAL_NO_BOUND_AGENT` (400), `AGENT_OFFLINE` (503),
  `AGENT_TEST_TIMEOUT` (504). The credential's `lastUsedAt` stamps on
  dispatch; audits: `credential_test_dispatched` on the agent entity +
  `tested` on the credential entity.
- Remote `CREDENTIAL_MISSING_KEY` coverage is evaluated over the bound
  config's **full provided-keys union** (legacy `secretRefs` + every linked
  credential's keys), not the tested credential's map alone — so a key this
  credential dropped but another credential on the same config still
  provides yields a passing coverage check, and the dispatched probe ships
  only the tested credential's own `secretRefMap`. Coverage-broken configs
  are skipped in favor of another bound config that covers (US3.5);
  `CREDENTIAL_MISSING_KEY` surfaces only when no bound config can dispatch.

## Importer-config save (no contract change — validation only)

`credentialIds` gains executor-kind checks in `validateSecretSources`:

- AGENT_MANAGED credential on a config with no `agentId` →
  `400 CREDENTIAL_KIND_MISMATCH`.
- STORED credential on an `agentId`-bound config →
  `400 CREDENTIAL_KIND_MISMATCH`.

## OIDC config (no contract change — validation only)

`clientSecretCredentialId` rejects non-STORED credentials →
`400 CREDENTIAL_KIND_MISMATCH`.

## New error codes (core `ERROR_CODES`)

| Code | Status | Meaning |
|---|---|---|
| `AGENT_OFFLINE` | 503 | Remote dispatch target has no live session |
| `AGENT_TEST_TIMEOUT` | 504 | Agent didn't answer `credential.test` in ~30 s |
| `CREDENTIAL_NO_BOUND_AGENT` | 400 | Test requires ≥1 agent-bound config referencing the credential |
| `CREDENTIAL_KIND_MISMATCH` | 400 | Credential kind incompatible with the binding target |

All ratified via ADR-117 Amendment 1 in the same change.
