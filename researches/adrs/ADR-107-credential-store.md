### ADR-107 — Application credential store for integration secrets

> **Status:** Ratified

**Context**: ADR-023 declared the app "not a secret store" and pushed all
importer credentials to external `env`/`file` references. That posture creates
operational gaps: credentials have no lifecycle (no rotation, revocation,
expiry, or audit), no usage tracking (which importer config or run used which
secret), no UI-managed path for self-hosters without secret infrastructure,
and no unified handling for OIDC client secrets. Spec `013-credential-store`
implements a database-backed, application-managed credential store while
keeping infrastructure-only secrets (DB password, registry credentials,
deployment/monitoring secrets) external.

**Decision**:

1. **`Credential` entity.** A dedicated `credentials` table stores named
   bundles of secret key/value pairs (AES-256-GCM encrypted at rest).
   `Credential` is the canonical domain term. Metadata includes `slug`,
   `label`, `status` (`ACTIVE`/`REVOKED`), `keyHints` (non-reversible last-4
   per key), `expiresAt`, `lastUsedAt`, `createdBy`/`updatedBy`, timestamps.

2. **Envelope encryption.** Payloads are `v1.<keyVersion>.<nonce>.<ct+tag>`
   AES-256-GCM with a 12-byte nonce and a 32-byte master key. The master key
   is resolved in order: `COMPONODE_SECRETS_KEY` → `SECRETS_DIR/master.key` →
   auto-generated into an existing `SECRETS_DIR` → absent (degraded mode when
   the store is empty; boot refusal when credentials exist). Rotation is
   dual-key: `COMPONODE_SECRETS_KEY_PREVIOUS` is the retiring key, boot
   re-encrypts all payloads under the current key. Database backup +
   `master.key` backup form a single recovery unit.

3. **Write-only values.** API responses never contain secret material — only
   metadata and `keyHints`. Create/rotate bodies accept values once; audit
   entries, logs, and error messages never carry plaintext. Pino redaction
   covers credential payload paths.

4. **Importer integration.** Importer manifests declare required secret keys
   (`manifest.secrets`); importer configs link credentials via
   `importer_config_credentials` alongside legacy `secretRefs` (deprecated,
   conversion via `POST /importer-configs/{id}/convert-secrets`). Resolution
   fails fast on missing/revoked credentials, duplicate keys across sources,
   and uncovered required keys. Runs stamp `credentialIds` and update
   `lastUsedAt`.

5. **OIDC migration.** `oidc_config.clientSecretCredentialId` supersedes the
   `clientSecretRef` env reference (amends ADR-073). Stored credential wins;
   legacy env fallback logs a deprecation warning.

6. **Lifecycle.** In-place rotation preserves the credential ID and all
   links; revocation is one-way; deletion is blocked with `CREDENTIAL_IN_USE`
   while importer configs or OIDC reference the credential. Expiry warns
   14 days out (advisory only).

7. **Authorization & testing.** Dedicated
   `credential:read|create|update|delete` permissions;
   `POST /credentials/{id}/test` requires `credential:update` and dispatches
   to an optional importer `testSecrets` hook (never a full import).

**Amendments to earlier ADRs**:

- **ADR-023** — the "no secrets at rest in the app DB" clause is superseded
  for *application integration secrets* (importer credentials, OIDC client
  secrets). `env`/`file` resolvers remain supported during the deprecation
  window. Infrastructure-only secrets remain external per the original rule.
- **ADR-055** — importer-config secret reference shape gains `credentialIds`
  (stored credential references) beside `secretRefs`; both resolve through
  the unified `resolveSecrets` path.
- **ADR-073** — the OIDC `clientSecretRef` env-only shape is superseded by
  `clientSecretCredentialId`; env ref kept as deprecated fallback.
- **ADR-099** — the "credentials only in memory/env" clause is amended:
  integration secret *values* may persist, encrypted, in `credentials`; the
  password-handling rules (Argon2id, no plaintext user passwords) are
  unchanged.

**Rationale**: External-only secrets made lifecycle management the deployer's
manual burden and left no audit trail inside the product's own domain. A
single encrypted store with a managed master key, write-only API surface,
and dedicated permissions delivers rotation, revocation, expiry, usage
tracking, and testability without turning Componode into a general-purpose
KMS — scope is deliberately limited to integration credentials.
