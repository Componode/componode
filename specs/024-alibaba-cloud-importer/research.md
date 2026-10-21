# Phase 0 Research — Alibaba Cloud Importer

All questions were resolved in the pre-spec grilling session (ratified as
`researches/adrs/ADR-115-alibaba-cloud-importer.md`) against primary
sources consolidated in `researches/alibaba-cloud-importer_research.md`.
This file condenses those into the plan-workflow format.

## Decisions

### D1 — Discovery backbone

- **Decision**: Resource Center `SearchResources`
  (`@alicloud/resourcecenter20221201`), `MaxResults=100`, `NextToken`
  pagination, retry-with-backoff on `Throttling`.
- **Rationale**: single account-wide, cross-region call; ~1.3 MB SDK;
  filters for `ResourceType`/`RegionId`/`ResourceGroupId` map directly to
  config fields.
- **Alternatives**: Cloud Config `ListDiscoveredResources` (requires
  provisioning an audit service first — rejected); per-service `Describe*`
  fan-out (N heavy SDKs, M regions — rejected for v1, possible later
  enrichment); Cloud Control API (young ecosystem — rejected).

### D2 — Enablement gate

- **Decision**: call `GetResourceCenterServiceStatus` before discovery;
  disabled → throw actionable error before any yield.
- **Rationale**: every search fails otherwise; a named-service error is the
  only honest failure mode.

### D3 — Coverage model

- **Decision**: discover-all by default; `ACS::<Service>::<Type>` →
  `ComponentCategory` map; unmapped types skip + `logger.warn` +
  `details.coverage` (`{discoveredCount, mappedCount, skippedCount,
  skippedTypes[]}`) on the account asset; `GetResourceCounts` (no auth
  needed) supplies the totals.
- **Rationale**: catalog completeness + honest gaps; no `OTHER` category
  exists to absorb unknowns.
- **Alternatives**: curated default allowlist (hides coverage — rejected);
  required explicit `resourceTypes` (hostile onboarding — rejected).

### D4 — Identity & credential probe

- **Decision**: `sts:GetCallerIdentity` (`@alicloud/sts20150401`) for both
  `testSecrets` and the ACCOUNT component's `externalId`/`Arn`.
- **Rationale**: the only documented call requiring no RAM authorization —
  always works when keys are valid.

### D5 — Modeling

- **Decision**: 1 ACCOUNT component/run + 1 component per resource
  (`externalId` = ARN or `type:resourceId`, `slug` = name + short-ID) + 1
  instance (`region`, best-effort `status`, `rawConfig`); `environment`
  defaults `PRODUCTION`.
- **Rationale**: matches DiscoveredAsset contract + stubs' env convention;
  provider IDs are rename-stable.

### D6 — Optional capabilities

- **Decision**: `enrichResources` (default off) → `GetResourceConfiguration`
  per resource, guarded per-resource → capability markers on the owning
  component; `includeCosts` (default off) → BSS `DescribeInstanceBill`
  (`@alicloud/bssopenapi20171214`), period = `billingPeriod` or latest
  closed cycle, attached to `details.billing`.
- **Rationale**: GitHub `includeBilling`/capability precedent; both
  degrade to `FORBIDDEN`/`ERROR` markers, never run failures.

### D7 — Provider taxonomy

- **Decision**: add `ALIBABA_CLOUD` to `COMPONENT_PROVIDERS` + meta; three-
  way update per constitution III (taxonomy research already proposed it
  §12.3 → core constant → migration 015 drop/re-add of
  `components_provider_check`).
- **Alternatives**: reuse `OTHER` — rejected (vendor deserves first-class
  provider; research already anticipated it).

### D8 — Secrets & endpoint

- **Decision**: `accessKeyId`+`accessKeySecret` required, `securityToken`
  optional; optional `endpoint` URL override guarded by `urlSafetyError`
  `.superRefine`.
- **Rationale**: ADR-107 credential store; ADR-106/importer guide §8 SSRF
  guard on URL fields.

### D9 — Test seams

- **Decision**: all SDK construction behind `src/client.ts`; unit tests
  `vi.mock("../src/client.js")`; integration test mocks `getImporter` per
  `import-runs.test.ts`.
- **Rationale**: Darabonba clients are generated and wide; a narrow seam is
  easier to fake than `vi.mock`ing three SDK packages.

### Out of scope (recorded)

Multi-account Resource Directory; `IncludeDeletedResources`; per-service
Describe enrichment; Cloud Config as alternate source; AWS/Azure stub
upgrades.
