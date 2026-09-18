# Research: Credential Store

**Feature**: `013-credential-store` | **Date**: 2026-09-18

All decisions below were resolved in an up-front design-grilling session
against the ratified architecture (ADR-023, ADR-055, ADR-073, ADR-099,
ADR-106). Each entry records the decision, rationale, and alternatives
considered.

## D1 — Replace, not hybrid, for in-app secrets

- **Decision**: Stored credentials **replace** `env`/`file` secret references
  for all in-app integration secrets — importer credentials, OIDC client
  secret, and future outbound API auth. Scope boundary: infrastructure and
  deployment secrets (database password, container registry, monitoring) stay
  external and are never stored.
- **Rationale**: The user explicitly chose replacement over hybrid. A single
  mechanism is simpler to reason about, audit, and document; the
  external-store path remains available during the deprecation window (D9)
  rather than as a permanent parallel feature.
- **Alternatives**: (a) Keep external-only and fix UX differently — rejected,
  doesn't solve paste-a-PAT-in-UI; (b) permanent hybrid — rejected, two secret
  systems forever doubles the security surface and user confusion.

## D2 — Encryption model: AES-256-GCM, single master key

- **Decision**: `node:crypto` AES-256-GCM; 32-byte data key (the "master key"),
  12-byte random nonce per credential, auth tag appended. `keyVersion` column
  on `credentials` tracks which key version encrypted each row. No new
  dependency.
- **Rationale**: GCM gives confidentiality + integrity in one primitive;
  built-in crypto avoids a dependency/audit burden; `keyVersion` enables
  rotation (D8). Single-org scale doesn't justify envelope encryption.
- **Alternatives**: Envelope encryption (per-credential DEK wrapped by KEK) —
  rejected, extra key table and wrap logic buys little at this scale;
  plaintext — rejected, makes every DB dump a credential leak; libsodium —
  rejected, unnecessary dependency.
- **Honest limitation (accepted)**: Protects against DB dump/backup theft and
  API read paths, **not** full host compromise (key lives on the same host).

## D3 — Master key bootstrap

- **Decision**: Resolution order: `COMPONODE_SECRETS_KEY` env (base64/hex,
  32 bytes) → `SECRETS_DIR/master.key` file → auto-generate `master.key` under
  `SECRETS_DIR` (mode 0600) on first boot. Boot **fails** when the
  `credentials` table is non-empty and no key is available; when the table is
  empty and no key can be obtained/generated, the app runs with credential
  features degraded and a loud warning.
- **Rationale**: Zero-config for Compose self-hosters (SECRETS_DIR is already
  mounted); env-provided key for controlled deployments; failing loudly when
  secrets exist prevents silently serving unreadable data.
- **Alternatives**: Required env only — rejected, adds setup friction to the
  default Compose path; derive from DB password — rejected, couples unrelated
  rotations and is infra-adjacent; external KMS — deferred (single-org
  self-hosted v1; extension point noted in ADR-107).

## D4 — Credential = named key/value bundle

- **Decision**: A credential stores an encrypted JSON object `{key: value}` —
  one credential equals one logical login (PAT, AWS key pair, Azure
  client/tenant/secret triplet). `keyHints` stores `{key: last4}` for display.
- **Rationale**: Multi-field logins as separate single-value credentials
  force users to create 2–3 rows per login and scatter rotation; bundles
  match how operators think about "the AWS credential."
- **Alternatives**: Single value per credential + `{key, credentialId}` refs —
  rejected for the UX/joinery cost above; free-form blob — rejected, named
  keys are required for coverage validation (D7).

## D5 — Referencing: junction table, importer contract unchanged

- **Decision**: `importer_config_credentials(configId, credentialId)`
  junction (FKs both sides; credential delete restricted while referenced —
  enforces FR-014 at the DB layer too). At run start the backend decrypts
  each referenced credential and merges keys into the existing
  `secrets: Record<string, string>` passed to `importer.run()`. Importer
  contract unchanged (ADR-056 preserved).
- **Rationale**: ADR-048 — many-to-many uses typed junction tables, no JSONB
  ref arrays for entity relations; the junction gives indexed
  "which configs use this credential" lookups for the 409 dependent list.
- **Alternatives**: `credentialRefs` JSONB array on `importer_configs` —
  rejected, weaker integrity and uglier dependent queries; changing the
  importer signature — rejected, violates Constitution II.

## D6 — Read-back and API contract

- **Decision**: Values are write-only (create + rotate); API responses carry
  metadata + `keyHints` only — never plaintext, no reveal endpoint ever.
  Dedicated `credential:create/read/update/delete` permissions (all ADMIN).
  `POST /credentials/:id/test` dry-runs the target importer's auth check.
- **Rationale**: Write-only + last4 hints matches session-token handling
  (ADR-099 precedent); a test endpoint is required because users can never
  re-verify a typo'd value by reading it.
- **Alternatives**: Reveal-on-demand endpoint — rejected, defeats the point;
  reuse `importer:config:*` — rejected, credential management is more
  sensitive than config management.

## D7 — Manifest `secrets` declaration + collision rules

- **Decision**: Importer manifests gain
  `secrets: [{key, label, required}]`. Config save validates: (a) every
  `required` key is provided by referenced credentials (backend decrypts to
  check coverage — names the credential + missing key on failure); (b) no key
  is defined by two referenced credentials or by a credential plus a legacy
  ref — reject naming the collision.
- **Rationale**: Converts "mysterious midnight run failure" into a save-time
  error; collision silence produces wrong-token bugs.
- **Alternatives**: Ordered last-wins precedence — rejected, silent and
  surprising; no manifest declaration (run-time discovery only) — rejected,
  loses save-time validation and UI field labels.

## D8 — Lifecycle and key rotation

- **Decision**: Credential fields: `label`, `status` (`ACTIVE`/`REVOKED`),
  `keyHints`, `expiresAt` (optional, warn-only — never blocks a run),
  `lastUsedAt`, audit fields. Rotation overwrites the payload in place (no
  value history in v1). `import_runs.credentialIds` (JSONB) records which
  credentials each run resolved; `lastUsedAt` updated at resolve time.
  Master-key rotation: dual-env boot — `COMPONODE_SECRETS_KEY` (new) +
  `COMPONODE_SECRETS_KEY_PREVIOUS` (old); boot re-encrypts rows whose
  `keyVersion` lags, then the operator drops `..._PREVIOUS`.
- **Rationale**: Warn-only expiry — upstream API is the authority on actual
  token validity; dual-env rotation keeps key material off the API and
  reuses existing env plumbing.
- **Alternatives**: Blocking on expiry — rejected, a stale date would kill
  working imports; versioned secret history — deferred, low value vs. audit
  records which already capture rotation events; admin-endpoint rotation —
  rejected, sends key material through the API.

## D9 — Deprecation window and conversion

- **Decision**: `env`/`file` refs keep resolving for one major version —
  flagged `deprecated` in API responses, a UI badge, and a resolve-time log
  warning. `POST /importer-configs/:id/convert-secrets` resolves the legacy
  refs, creates one bundle credential holding all keys, rewrites the config
  (clears `secretRefs`, inserts junction rows), audits both changes. Removal
  of legacy refs is slated for the next major.
- **Rationale**: v1.0.0 shipped with env/file refs — a hard cut punishes
  early adopters; silent auto-migration persists env values without consent.
  The one-click convert is the UX bridge.
- **Alternatives**: Boot-time auto-migration — rejected, silently reads env
  into the DB and fails if vars are gone; hard cut — rejected, breaks running
  deployments; keeping hybrid forever — see D1.

## D10 — OIDC adoption

- **Decision**: `oidc_config` gains `clientSecretCredentialId` (FK, nullable);
  resolution prefers the credential when set, falls back to legacy
  `clientSecretRef` (env name) during the window. Same deprecation flagging.
- **Rationale**: Same resolver pattern (ADR-073), same secret class; user
  confirmed in scope.

## Open risks

- **Key loss = total credential loss.** Mitigated by documentation (backup
  unit = DB + master.key), boot-fail behavior, and auto-generated key
  persisting to the mounted secrets dir. Accepted residual risk for
  self-hosted v1.
- **Importers in-process** (ADR-098 sandboxing is partial): resolved secrets
  exist in backend memory during runs — unchanged from today; the store
  doesn't expand that exposure.
