# Data Model: Credential Store

**Feature**: `013-credential-store` | **Date**: 2026-09-18
**Migration**: `packages/backend/src/db/migrations/011_credential_store.ts`

## New table: `credentials`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, UUID v7 (param) | ADR-045 |
| `slug` | `text` | UNIQUE NOT NULL | Human-readable ref (ADR-046); derived from label, suffixed on collision |
| `label` | `text` | NOT NULL, ≤100 chars | Display name |
| `status` | `text` | NOT NULL DEFAULT `'ACTIVE'`, CHECK IN (`ACTIVE`,`REVOKED`) | From `core` constant `CREDENTIAL_STATUSES` |
| `encryptedPayload` | `text` | NOT NULL | Envelope: `v1.<keyVersion>.<nonce_b64url>.<ct+tag_b64url>` — AES-256-GCM of `{key: value}` JSON |
| `keyVersion` | `integer` | NOT NULL DEFAULT 1 | Master-key generation used for this row |
| `keyHints` | `jsonb` | NOT NULL | `{<secretKey>: "<last4>"}` — display hints only, non-reversible; values shorter than 8 chars are masked entirely (`****`) so the hint never reveals the secret |
| `expiresAt` | `timestamptz` | NULL | Advisory expiry; warn when past or within **14 days**; never blocks a run |
| `lastUsedAt` | `timestamptz` | NULL | Updated when resolved for a run |
| `createdBy` | `uuid` | NULL → persons.id | Audit |
| `updatedBy` | `uuid` | NULL → persons.id | Audit |
| `createdAt` | `timestamptz` | NOT NULL DEFAULT now() | |
| `updatedAt` | `timestamptz` | NOT NULL DEFAULT now() | |

Indexes: `credentials(status)`, `credentials(expiresAt)` (for warning queries).

## New table: `importer_config_credentials`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `configId` | `uuid` | NOT NULL, FK → `importer_configs.id` ON DELETE CASCADE | Part of PK |
| `credentialId` | `uuid` | NOT NULL, FK → `credentials.id` ON DELETE RESTRICT | Part of PK; enforces FR-014 at DB layer |
| `createdAt` | `timestamptz` | NOT NULL DEFAULT now() | |

PK: `(configId, credentialId)`. Indexes: `(credentialId)` for dependent lookups.

**Naming note**: the config→credential link is called `credentialIds` in API
payloads, `importer_config_credentials` in the schema, and "credential
reference" in domain language — same concept, three layers.

## Altered: `importer_configs`

- `secretRefs` (jsonb `{key, env?, file?}[]`) — **retained, deprecated**. Still
  resolves during the deprecation window; masked in responses (ADR-106).
- No new columns — credential linkage lives in the junction table.

## Altered: `import_runs`

- `credentialIds` `jsonb` NULL — array of credential UUIDs resolved for the
  run. Historical record; no FK (survives credential deletion).

## Altered: `oidc_config`

- `clientSecretCredentialId` `uuid` NULL, FK → `credentials.id` ON DELETE
  RESTRICT.
- `clientSecretRef` (env var name) — retained, deprecated; resolution prefers
  the credential when both are set.

## `entity_changes` usage

`entityType: "credential"`, actions: `created`, `updated` (label/expiry),
`rotated`, `revoked`, `deleted`. `changes` payload MUST contain only
metadata (label, status, expiresAt, key names) — never values or ciphertext.

## Validation rules (Zod, `packages/core`)

- `createCredentialSchema`: `label` (1–100), `secrets: Record<string, string>`
  (≥1 entry; keys `[a-zA-Z][a-zA-Z0-9_]{0,63}`, values non-empty, total
  payload ≤ 64 KB), `expiresAt` optional ISO datetime.
- `updateCredentialSchema`: partial — `label`, `expiresAt` (nullable),
  `secrets` (full replace = rotation), `status` (`REVOKED` only; re-activation
  is a new credential).
- `importer-config` schemas: add `credentialIds: uuid[]` (default `[]`);
  `secretRefs` still accepted, flagged deprecated; both `secretRefs` and
  `credentialIds` may be empty for importers that declare no required
  secrets.
- OIDC settings schema: add `clientSecretCredentialId` (uuid, nullable).

## State transitions

```text
Credential: ACTIVE --rotate--> ACTIVE (new payload, same id)
            ACTIVE --revoke--> REVOKED (terminal; resolution fails)
            ACTIVE|REVOKED --delete--> gone (only when unreferenced)
```

## Resolution algorithm (run start / OIDC init)

1. Collect `credentialIds` from config (junction) — for OIDC, the config's
   `clientSecretCredentialId`.
2. For each id: load row; if missing → `CREDENTIAL_NOT_FOUND`; if `REVOKED` →
   `CREDENTIAL_REVOKED`. Decrypt payload → `{key: value}`.
3. Merge all credential maps + legacy `secretRefs` values into one `secrets`
   record. **Any duplicate key across any source → `CREDENTIAL_KEY_COLLISION`**
   naming the sources (validated earlier at config save, re-checked at run).
4. Importer manifest `secrets` declaration: every `required` key must be
   present → else `CREDENTIAL_MISSING_KEY` naming credential label + key.
5. Stamp `import_runs.credentialIds` + update `credentials.lastUsedAt`.
6. `expiresAt` past/near → run warning + UI flag; never blocks.
