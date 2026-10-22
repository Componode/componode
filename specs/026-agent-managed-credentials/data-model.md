# Data Model: Agent-Managed Credentials (spec 026)

**Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md) |
**Decisions**: [research.md](./research.md)

## Schema delta — migration `017_agent_managed_credentials.ts`

### `credentials` (existing table, altered)

| Column | Change |
|---|---|
| `kind` | NEW `text NOT NULL DEFAULT 'STORED'` + CHECK `kind IN ('STORED','AGENT_MANAGED')` — values from `CREDENTIAL_KINDS` in `packages/core/src/constants/credential-kind.ts` |
| `secretRefMap` | NEW `jsonb NULL` — `Record<keyName, {env?: string; file?: string}>`; exactly one source key per ref enforced by zod, not the DB |
| `encryptedPayload` | `text` → **nullable** (AGENT_MANAGED rows store no payload) |
| `keyVersion` | column unchanged (`NOT NULL DEFAULT 1`); AGENT_MANAGED rows insert `0` — inert, no payload exists to encrypt |

New coherence CHECK `credentials_kind_payload_check`:

```sql
(kind = 'STORED'        AND encryptedPayload IS NOT NULL AND secretRefMap IS NULL) OR
(kind = 'AGENT_MANAGED' AND secretRefMap IS NOT NULL AND encryptedPayload IS NULL)
```

All existing rows migrate as `STORED` — the default plus existing
NOT NULL payload make the CHECK true for every current row.

### `CredentialRow` (db/types.ts)

```ts
export interface CredentialRow {
  // ... existing fields
  kind: string;                                        // 'STORED' | 'AGENT_MANAGED'
  encryptedPayload: string | null;                     // null for AGENT_MANAGED
  secretRefMap: Record<string, SecretRefShape> | null; // null for STORED
}
```

### `keyHints` convention (no schema change)

`AGENT_MANAGED` rows store `keyHints[keyName] = "env" | "file"` — the
source type as a non-secret display hint (research R2). Key names remain
the coverage source, so `assertSecretCoverage` / `checkKeyCollisions` /
the UI key list are mechanically unchanged.

## Contract types (core)

```ts
// constants/credential-kind.ts
export const CREDENTIAL_KINDS = ["STORED", "AGENT_MANAGED"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

// contracts/credential.ts (extended)
export interface Credential {
  // ... existing fields
  kind: CredentialKind;
  secretRefMap?: Record<string, SecretRef>;  // AGENT_MANAGED only
}

// SecretRef — exactly one source key (zod-refined at boundaries)
type SecretRef = { env: string } | { file: string };
```

## Validation rules

| Rule | Enforced where |
|---|---|
| Kind immutable post-create | `updateCredentialSchema` has no `kind` field |
| `secrets` rejected on AGENT_MANAGED create/update; `secretRefMap` rejected on STORED | discriminated-union create schema + service-level check on update |
| `secretRefMap` ≥1 entry, key pattern `^[a-zA-Z][a-zA-Z0-9_]{0,63}$`, exactly one of `env`/`file` per ref | zod schema (core) |
| AGENT_MANAGED link requires `importer_configs.agentId` set; STORED link requires it unset | `validateSecretSources` → `CREDENTIAL_KIND_MISMATCH` |
| OIDC `clientSecretCredentialId` requires `kind = 'STORED'` | OIDC service save path → `CREDENTIAL_KIND_MISMATCH` |
| `AGENT_MANAGED` never reaches `resolveImportSecrets` decryption | defense-in-depth `kind` check → `CREDENTIAL_KIND_MISMATCH` |
| Delete blocked while referenced | unchanged (`CREDENTIAL_IN_USE`, FK RESTRICT) |

## State transitions

`status` (`ACTIVE`/`REVOKED`) and lifecycle (create → edit refs → revoke →
delete) are identical for both kinds. `kind` has no transitions — it is
fixed at insert.

## Unchanged tables

`importer_config_credentials` (junction, no columns added — kind
enforcement is a validation rule, not a schema rule).
`import_agents`, `agent_sessions`, `import_runs` — untouched in this spec.
