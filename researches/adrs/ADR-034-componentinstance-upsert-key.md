### ADR-034 — ComponentInstance upsert key

> **Status:** Ratified

**Context**: [ADR-025](./ADR-025-importer-interface-pull-only-asyncgenerator.md) defines component upsert by `(category, provider,
externalId)` but is silent on instance matching across runs.

**Decision**: **`(componentId, instanceExternalId)`.** Importers provide a
stable per-instance `externalId` (e.g. AWS API Gateway Stage ARN, K8s pod
name, web URL hash). `environment` is an attribute, not part of the key.

**Rationale**: Scales to multiple instances per environment (an API Gateway
with three `PRODUCTION` stages); doesn't force a display attribute (`region`/
`url`) into the identity role; mirrors the component's own upsert key pattern.
---

## Amendment 1 — Human environment override (spec 071)

`environment` remains the importer-reported attribute — never part of the
upsert key, and import reconciliation keeps rewriting it every run. A human
may override the *effective* environment per instance via
`PATCH /component-instances/{id}`: the override lives in three nullable
columns (`environmentOverride`, `environmentOverriddenBy`,
`environmentOverriddenAt`) beside the reported `environment`, and the API
effective value is `override ?? reported` computed at serialization. The
importer contract is untouched — overrides are backend/domain data, not
`DiscoveredAsset` fields. `environment: null` on the PATCH clears the
override so the instance follows the latest reported value again.
