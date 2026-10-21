### ADR-115 — Alibaba Cloud importer: Resource Center discovery

> **Status:** Ratified

**Context**: Componode's v1 importer scope ([ADR-026](./ADR-026-v1-importer-scope-7-importers.md))
ships seven in-tree importers; the AWS and Azure entries are stubs that emit
placeholder assets without SDK calls. Adding Alibaba Cloud coverage is the
first opportunity to build a real cloud-provider importer against the
`DiscoveredAsset` contract. Alibaba exposes three viable inventory APIs —
Resource Center `SearchResources` (account-wide, cross-region search), Cloud
Config `ListDiscoveredResources` (aggregated audit inventory), and
per-service `Describe*` APIs (richest data, one heavy SDK per service) — and
they differ sharply in prerequisites, data richness, and dependency cost.
Findings: `researches/alibaba-cloud-importer_research.md`.

**Decision**:

1. **Discovery backbone is Resource Center `SearchResources`** via
   `@alicloud/resourcecenter20221201`. The importer checks
   `GetResourceCenterServiceStatus` up front and fails the run fast with an
   actionable message when the service is disabled. `GetResourceCounts`
   (same SDK, no RAM authorization required) produces the per-type coverage
   report; `GetResourceConfiguration` powers opt-in per-resource
   enrichment.
2. **Discover-all with visible skips.** The importer enumerates every
   resource type Resource Center returns by default (`resourceTypes`
   allowlist in config narrows scope). Known `ACS::<Service>::<Type>` codes
   map to `ComponentCategory`; unmapped codes are skipped with a warning and
   reported in a `details.coverage` summary on the account component — never
   silently dropped, never fatal.
3. **Provider constant**: `ALIBABA_CLOUD` is added to `COMPONENT_PROVIDERS`
   (with label/meta) and the DB CHECK constraint migrates accordingly —
   consistent with treating each cloud vendor as a first-class provider
   rather than `OTHER`.
4. **Credentials**: `accessKeyId` + `accessKeySecret` (required) +
   `securityToken` (optional, STS) via the `credentials` table per
   [ADR-107](./ADR-107-credential-store.md). `testSecrets` probes
   `sts:GetCallerIdentity` — the only call that requires no RAM
   authorization.
5. **Modeling**: one ACCOUNT component per run (from `GetCallerIdentity`,
   carrying `details.capabilities` + `details.coverage`) plus one component
   per resource with a single instance (`region`, best-effort `status`,
   `rawConfig`). Environment defaults to `PRODUCTION`, overridable in
   config. Opt-in `includeCosts` attaches BSS `DescribeInstanceBill` billing to
   `details.billing` (GitHub `includeBilling` precedent); opt-in
   `enrichResources` adds `GetResourceConfiguration` payloads. Both degrade
   to `FORBIDDEN`/`ERROR` capability markers per the importer guide.
6. **Out of scope**: multi-account (Resource Directory), deleted-resource
   ingestion (`IncludeDeletedResources`), per-service Describe enrichment.
   Revisit per-service enrichment if inventory-level data proves
   insufficient — the backbone decision does not block it.

**Consequences**: new package `@componode/importer-alibaba-cloud`
(`name: "alibaba-cloud"`, manifest secrets `accessKeyId`,
`accessKeySecret`, `securityToken`); dependencies
`@alicloud/resourcecenter20221201`, `@alicloud/sts20150401`, and
`@alicloud/bssopenapi20171214` (costs path); `ALIBABA_CLOUD` provider
constant + CHECK-constraint migration + frontend meta; backend registry
entry. AWS/Azure stubs remain stubs — this importer does not retrofit them.

**Rationale**: Resource Center is the only option that is account-wide and
cross-region in a single call with a single ~1.3 MB SDK. Cloud Config's
richer per-record status does not justify making users provision an audit
service before their first import. Per-service SDKs would multiply
dependency weight (~16 MB for ECS alone) and region fan-out code for data
the v1 catalog does not need. The enablement gate is the accepted cost —
detected upfront and reported as an actionable failure.

**Alternatives considered**: Cloud Config `ListDiscoveredResources` —
rejected (requires provisioning the audit service first; keep as a possible
second source if users demand record-level status at scale). Per-service
`Describe*` fan-out — rejected for v1 (N heavy SDKs, per-region loops,
version churn; may return as targeted enrichment later). Cloud Control API —
rejected (younger ecosystem, weaker docs for read-only inventory).
Stub-parity with AWS/Azure — rejected (a placeholder yields no user value).
Curated default allowlist — rejected (discover-all + visible skips serves
catalog completeness without hiding coverage gaps).
