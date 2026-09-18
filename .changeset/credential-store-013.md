---
"@componode/backend": minor
"@componode/core": minor
"@componode/frontend": minor
"@componode/importer-github": minor
"@componode/importer-aws": minor
"@componode/importer-azure": minor
"@componode/importer-kubernetes": minor
"@componode/importer-web-url": minor
"@componode/importer-api-url": minor
"@componode/importer-mcp-server": minor
---

Application credential store for integration secrets (spec `013-credential-store`, ADR-107):

- New `Credential` entity stores encrypted key/value bundles in PostgreSQL (AES-256-GCM, `v1` envelope) with metadata, key hints, expiry, last-used tracking, and audit — values are write-only and never appear in API responses, logs, or audit payloads.
- Master key resolved from `COMPONODE_SECRETS_KEY`, `SECRETS_DIR/master.key`, or auto-generated into an existing `SECRETS_DIR`; empty-store degraded mode and dual-key rotation via `COMPONODE_SECRETS_KEY_PREVIOUS`. Back up the database and `master.key` as a single recovery unit.
- Importer configs accept `credentialIds` alongside legacy `secretRefs`; importer manifests declare required `secrets` keys. Runs stamp used credential IDs and update `lastUsedAt`. Duplicate keys, missing credentials, revoked credentials, and uncovered required keys fail before execution.
- `POST /credentials/{id}/test` probes credentials through an optional importer `testSecrets` hook (GitHub ships a minimal authenticated rate-limit probe).
- OIDC client secret can reference a stored credential via `clientSecretCredentialId`; the env `clientSecretRef` remains as a deprecated fallback.
- **Deprecation notice**: `env`/`file` `secretRefs` on importer configs and the OIDC `clientSecretRef` are deprecated. Use `POST /importer-configs/{id}/convert-secrets` to migrate legacy references into stored credentials.
