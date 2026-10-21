# Data Model — Alibaba Cloud Importer

## Importer config schema (`alibabaCloudConfigSchema`)

| Field | Type | Default | Notes |
|---|---|---|---|
| `regionIds` | `string[]` | `[]` (all) | `Filter{Key:"RegionId",MatchType:"Equals",Value:[...]}` |
| `resourceTypes` | `string[]` | `[]` (all) | allowlist of `ACS::<Service>::<Type>` codes → `ResourceType` filter |
| `resourceGroupId` | `string?` | unset | `Filter{Key:"ResourceGroupId",MatchType:"Equals"}` |
| `environment` | `Environment` enum | `"PRODUCTION"` | applied to every produced instance |
| `enrichResources` | `boolean` | `false` | per-resource `GetResourceConfiguration` |
| `includeCosts` | `boolean` | `false` | BSS `DescribeInstanceBill` (per-instance, keyed by `instanceID`) |
| `billingPeriod` | `string?` (`YYYY-MM`) | latest closed cycle | required-shape when `includeCosts`; rejected format → config error |
| `endpoint` | `string?` (URL) | unset | `.superRefine(urlSafetyError)`; overrides SDK endpoint (VPC/private/intl) |

Zod `.strict()` — unknown fields rejected per ADR-095 (schema sits inside the
importer-config payload validated at the route boundary).

## Declared secrets (`manifest.secrets`)

| Key | Label | Required |
|---|---|---|
| `accessKeyId` | AccessKey ID | yes |
| `accessKeySecret` | AccessKey Secret | yes |
| `securityToken` | STS security token (temporary credentials) | no |

## Entity mapping

### ACCOUNT component (one per run)

| DiscoveredAsset field | Value |
|---|---|
| `category` | `ACCOUNT` |
| `provider` | `ALIBABA_CLOUD` |
| `resourceType` | `alibaba-cloud:account` |
| `name` | `Alibaba Cloud account <AccountId>` |
| `externalId` | `AccountId` from `GetCallerIdentity` |
| `slug` | `alibaba-cloud-account-<accountId>` |
| `details` | `{ arn, identityType, principalId, capabilities, coverage, billing? }` |
| `instances[0]` | `{ environment: config.environment, externalId: "<AccountId>", status: "RUNNING" }` |

### Resource component (one per discovered resource)

| DiscoveredAsset field | Value |
|---|---|
| `category` | mapped from `resourceType` via the `ACS::*::*` table (unmapped → skip) |
| `provider` | `ALIBABA_CLOUD` |
| `resourceType` | raw code, e.g. `ACS::ECS::Instance` |
| `name` | `resourceName` (fallback `resourceId`) |
| `externalId` | `acs:` ARN when present, else `<resourceType>:<resourceId>` |
| `slug` | slugified name + `-` + last 8 chars of `resourceId` (rename-stable, collision-safe) |
| `details` | `{ resourceGroupId, zoneId, tags, service, createTime, billing?, capabilities? }` |
| `instances[0]` | `{ environment, region: regionId, status?, externalId: resourceId, rawConfig: <search record \| GetResourceConfiguration body> }` |

### Coverage summary (`accountAsset.details.coverage`)

```ts
{
  discoveredCount: number,   // resources returned by search
  mappedCount: number,       // yielded as components
  skippedCount: number,
  skippedTypes: string[],    // unmapped ACS::*::* codes
  totals?: Record<string, number> // GetResourceCounts GroupBy=ResourceType (guarded)
}
```

### Capability markers (`details.capabilities` on owning component)

`Record<string, {status: "OK"|"FORBIDDEN"|"UNAVAILABLE"|"ERROR", message?}>`
per `docs/importer-development.md`; keys: `costs`, `enrichment`,
`resourceCounts`.

## Status mapping (enrichment on)

Provider status strings → `InstanceStatus` via a per-family table
(`Running|InUse|Available|Active → RUNNING`, `Stopped|Stopped* → STOPPED`,
`*Error*|*Fail* → ERROR`, `Deleted|Released → GONE`); unknown → `null`
(unset) rather than a wrong guess.

## DB impact

- Migration `015_alibaba_cloud_provider.ts`: drop +
  `addCheckConstraint("components_provider_check", provider IN (...COMPONENT_PROVIDERS))`;
  `down` re-adds without `ALIBABA_CLOUD` (fails safely if rows exist —
  same pattern as `010_account_category.ts`).
- No new tables, no column changes, no API surface changes.
