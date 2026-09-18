### ADR-055 — Importer secret resolution

> **Status:** Ratified

**Context**: [ADR-023](./ADR-023-importer-credentials-external-secret-stores.md) defines a `SecretResolver` interface. [ADR-025](./ADR-025-importer-interface-pull-only-asyncgenerator.md)'s signature
passes `secretResolver` to the importer. Q23 decided the importer receives
pre-resolved secrets, not a resolver. These are inconsistent.

**Decision**: **`secretRefs: [{key, env? | file?}]` on `importer_configs`.**
The core dispatches on which field is present (`env` → env resolver, `file` →
file resolver), resolves all `secretRefs` before invoking the importer, and
passes `secrets: Record<string, string>` to the importer. The importer never
knows which resolver was used.

**Rationale**: Importer is simpler (no resolver dependency, just a map lookup).
The core enforces the allow-list (only declared `secretRefs` are resolved).
Secrets are resolved once, not per-importer-call. Avoids string parsing
(fragile on Windows paths). Extends cleanly (a future `vault` resolver adds a
`vault` field).
---

**Amended by ADR-107**: importer configs gain `credentialIds` (stored
credential references) beside `secretRefs`; both resolve through the unified
`resolveSecrets` path. Importer manifests may declare required `secrets` keys.
