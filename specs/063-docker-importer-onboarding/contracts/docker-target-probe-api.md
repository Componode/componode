# API Contract: Docker target probe + wizard-facing deltas

All routes are session-authenticated under `/api/v1`. This feature adds
exactly one operation; every other endpoint the wizard calls already
exists and is unchanged.

## `POST /docker-targets/probe` (NEW)

Permission: `importer:target:test` (ADMIN) — identical to the existing
target test.

Stateless connectivity check: validates the profile, resolves secret
material (inline or from a STORED credential), and runs the importer's
minimal `/version` probe. **Persists nothing, writes no audit event.**

### Request

```json
{
  "profile": { "transport": "tcp", "host": "docker.example.com", "port": 2376,
               "clientCertKey": "clientCert", "clientKeyKey": "clientKey" },
  "secrets": { "clientCert": "-----BEGIN CERTIFICATE-----\n…", "clientKey": "-----BEGIN…" }
}
```

or, when reusing an existing credential (values never leave the store):

```json
{
  "profile": { "transport": "ssh", "host": "…", "user": "…",
               "hostKeySha256": "SHA256:…", "privateKeyKey": "sshPrivateKey" },
  "credentialId": "019a…-uuid"
}
```

Schema (core `probeDockerTargetSchema`, `.strict()`):

| Field | Type | Rules |
|---|---|---|
| `profile` | object | required; validated against the docker manifest `targetProfileSchema` before any network access |
| `secrets` | record<string,string> | optional; ≤64 KB serialized; mutually exclusive with `credentialId` |
| `credentialId` | uuid | optional; must be an existing `STORED` credential |

### Responses

- `200` — `{ "ok": true }` or `{ "ok": false, "error": "<sanitized reason>" }`.
  All probe outcomes (unreachable engine, TLS failure, missing secret key,
  bad host-key pin) return 200 with `ok:false`; `error` never contains
  secret values.
- `400 VALIDATION_FAILED` — malformed envelope (missing `profile`, both
  `secrets` and `credentialId`, unknown fields) or a profile that fails
  the transport schema (rejected before any network access).
- `401` / `403` — unauthenticated / non-admin.
- `404 CREDENTIAL_NOT_FOUND` — `credentialId` does not resolve to a
  credential.
- `409 CREDENTIAL_REVOKED` — `credentialId` resolves to a revoked
  credential.
- `503 CREDENTIAL_KEY_UNAVAILABLE` — the credential store key is
  unavailable for decrypting the referenced credential.
- `400 CREDENTIAL_MISSING_KEY` — `credentialId` credential exists but its
  key set does not cover the profile's `*Key` references.

### Semantics

- Exactly one secret source: inline `secrets` XOR `credentialId`; neither
  is required when the profile references no `*Key` names.
- The probe runs the same code path as `POST /docker-targets/:id/test`
  (`importer.testSecrets` → Docker `/version` only, never inventory).
- Repeated calls are safe; there is no rate-limit or state beyond normal
  request logging (which never includes body secret values).

## Wizard-consumed existing endpoints (unchanged)

| Step | Call | Notes |
|---|---|---|
| Probe | `POST /docker-targets/probe` | above |
| Create target | `POST /docker-targets` | `{targetId, label, description?, profile}` → 201; `409 CONFLICT` on duplicate selector |
| Create credential | `POST /credentials` | `{kind:"STORED", label, secrets}` → 201; skipped when reusing or secret-free |
| Create config | `POST /importer-configs` | `{importerName:"docker", label, scope:{targetId}, credentialIds:[…], agentId:null, schedule, enabled:true, secretRefs:[]}` → 201 |

Error surfaces the wizard must render: `400 VALIDATION_FAILED` (field
errors), `409 CONFLICT` (duplicate targetId), credential-store unavailable
(`CREDENTIAL_KEY_UNAVAILABLE`-class failure), and the probe's `ok:false`
error text.
