# Contracts: Credential Store

**Feature**: `013-credential-store` | **Date**: 2026-09-18

All endpoints under `/api/v1`, authenticated via `verifySession`, errors as
`{code, message, details?}`. **ADR-104**: every endpoint below must be added to
`docs/openapi.yaml` with matching `x-permission` / `security` in the same
change.

## Credential resource

`Credential` response shape (never contains plaintext):

```json
{
  "id": "uuid",
  "slug": "string",
  "label": "string",
  "status": "ACTIVE | REVOKED",
  "keyHints": { "token": "…wxyz" },
  "expiresAt": "iso | null",
  "lastUsedAt": "iso | null",
  "createdBy": "uuid | null", "createdAt": "iso",
  "updatedBy": "uuid | null", "updatedAt": "iso"
}
```

### `GET /credentials`

List credentials (metadata only).
**Permission**: `credential:read` → `200 { credentials: Credential[] }`.

### `POST /credentials`

Create. Body:

```json
{ "label": "GitHub prod PAT", "expiresAt": "2027-01-01T00:00:00Z",
  "secrets": { "token": "ghp_…" } }
```

**Permission**: `credential:create` → `201 { credential }`. The `secrets`
object is accepted once and never returned.

### `GET /credentials/:id`

Detail + dependents:

```json
{ "credential": {…}, "dependents": {
    "importerConfigs": [{ "id": "…", "label": "…" }],
    "oidc": false } }
```

**Permission**: `credential:read` → `200` | `404 CREDENTIAL_NOT_FOUND`.

### `PATCH /credentials/:id`

Update metadata and/or rotate values. Body (all optional):

```json
{ "label": "…", "expiresAt": "iso|null", "status": "REVOKED",
  "secrets": { "token": "new-value" } }
```

`secrets` present = rotation: payload replaced in place, `keyHints`
recomputed, audit `rotated`. `status: "REVOKED"` is one-way (re-activation =
new credential).
**Permission**: `credential:update` → `200 { credential }` |
`404 CREDENTIAL_NOT_FOUND` | `400 VALIDATION_FAILED`.

### `DELETE /credentials/:id`

**Permission**: `credential:delete` → `204` | `404` |
`409 CREDENTIAL_IN_USE { dependents: { importerConfigs: [...], oidc: bool } }`.

### `POST /credentials/:id/test`

Dry-run the credential against an importer's auth check. Body:
`{ "importerName": "github", "scope": {…optional config overrides…} }`.

Calls the importer manifest's optional `testSecrets(secrets, config)` hook;
`400 MANIFEST_NO_TEST` if the importer doesn't implement it. Response:

```json
{ "ok": true }  |  { "ok": false, "error": "auth failed: …" }
```

**Permission**: `credential:update` → `200` (result in body, never a 4xx for
upstream auth failure) | `404 CREDENTIAL_NOT_FOUND`.

## Importer config changes

`POST/PATCH /importer-configs` bodies gain:

```json
{ "credentialIds": ["uuid", …], "secretRefs": [{ "key": "…", "env": "…" }] }
```

- `credentialIds` — new; order irrelevant; each must exist → `404
  CREDENTIAL_NOT_FOUND`.
- `secretRefs` — still accepted; **deprecated**: responses return
  `"secretRefsDeprecated": true` when non-empty; resolve-time warning logged.
- Save-time validation (backend decrypts referenced credentials):
  - required manifest key uncovered → `400 CREDENTIAL_MISSING_KEY
    { credentialLabel, key }`
  - same key from two sources (credential∩credential or credential∩legacy) →
    `400 CREDENTIAL_KEY_COLLISION { sources: [...], key }`

### `POST /importer-configs/:id/convert-secrets`

One-click migration. Resolves current `secretRefs` → creates one bundle
credential `{label: "<config label> secrets", secrets: <resolved map>}` →
clears `secretRefs`, links the credential → audits both.
**Permission**: `importer:config:update` → `201 { credential, config }` |
`400 CONVERSION_NOTHING_TO_CONVERT` | `502 LEGACY_SECRET_UNRESOLVABLE`.

## OIDC settings change

`PUT /settings/oidc` body gains `clientSecretCredentialId: "uuid|null"`.
Resolution prefers the credential; `clientSecretRef` (env name) remains
accepted and deprecated. Permission unchanged: `oidc:configure`.

## Importer manifest contract addition

Each importer manifest gains an optional `secrets` declaration (default `[]`)
listing only the keys the importer **actually reads** — ambient credential
chains (AWS instance roles, kubeconfig, Azure identity) are not declared:

```ts
secrets?: Array<{ key: string; label: string; required: boolean }>
```

| Importer | `secrets` declaration | `testSecrets` |
|---|---|---|
| github | `[{ key: "token", label: "Personal access token", required: true }]` | Yes — auth probe via Octokit (`GET /rate_limit` or `GET /user`) |
| aws | `[]` (ambient credential chain today) | No → `MANIFEST_NO_TEST` |
| azure | `[]` (ambient identity today) | No → `MANIFEST_NO_TEST` |
| kubernetes | `[]` (kubeconfig/in-cluster via config) | No → `MANIFEST_NO_TEST` |
| api-url | `[]` | No → `MANIFEST_NO_TEST` |
| web-url | `[]` | No → `MANIFEST_NO_TEST` |
| mcp-server | `[]` | No → `MANIFEST_NO_TEST` |

Importers add keys to `secrets` when they start consuming them — declaring
unread keys is prohibited (the declaration drives save-time coverage
validation, so false requirements would break configs).

Optional manifest method:

```ts
testSecrets?(secrets: Record<string, string>, config?: Record<string, unknown>):
  Promise<{ ok: boolean; error?: string }>
```

Both fields surface through `GET /importers` (manifest listing) so the
frontend can render credential key fields and the test button.

## New error codes (`packages/core`)

`CREDENTIAL_NOT_FOUND`, `CREDENTIAL_IN_USE`, `CREDENTIAL_REVOKED`,
`CREDENTIAL_MISSING_KEY`, `CREDENTIAL_KEY_COLLISION`,
`CREDENTIAL_KEY_UNAVAILABLE` (no master key at boot/resolution),
`MANIFEST_NO_TEST`, `CONVERSION_NOTHING_TO_CONVERT`,
`LEGACY_SECRET_UNRESOLVABLE`.

## RBAC additions

`credential:create`, `credential:read`, `credential:update`,
`credential:delete` → all `ADMIN` (credential management is more sensitive
than `importer:config:*`; referencing a credential only needs
`importer:config:update`).

## Log/audit masking (ADR-090)

Add to Pino redaction paths: `encryptedPayload`, `secrets`, `secrets.*`,
`keyHints` is non-secret (allowed). `entity_changes` for credentials record
metadata only.
