### ADR-073 — OIDC configuration

> **Status:** Ratified

**Context**: [ADR-027](./ADR-027-authentication-built-in-local-optional-oidc.md) defines optional OIDC with JIT + claim-based role
mapping. How is it configured?

**Decision**: **Env vars for connection config (`OIDC_ISSUER`,
`OIDC_CLIENT_ID`) + `clientSecretRef` resolved via `SecretResolver` (not raw
env var) + role mapping in single-row `oidc_config` table (UI-editable).**
`oidc_config(enabled, issuer, clientId, clientSecretRef, roleClaimPath,
claimValueField, roleMapping jsonb)`. The `default` key in `roleMapping`
handles JIT provisioning ([ADR-027](./ADR-027-authentication-built-in-local-optional-oidc.md): "default role Viewer" — if no claim
matches, use `default`).

**Rationale**: Fully [ADR-023](./ADR-023-importer-credentials-external-secret-stores.md) compliant (secret is a reference, resolved via
the same `SecretResolver` as importer credentials — one secret-handling
pattern). Role mapping is UI-editable (the part that changes as the deployer's
IdP groups evolve); env-var-only would require a restart for every mapping
change. The `oidc_config` table is structured (not key-value) because
`roleMapping` is JSONB and the shape is fixed.
---

**Amended by ADR-107**: `clientSecretRef` (env-only) is superseded by
`clientSecretCredentialId` referencing the credential store; the env ref is
kept as a deprecated fallback that logs a deprecation warning.
