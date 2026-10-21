# Alibaba Cloud Importer Research

> **Purpose**: Determine how a Componode importer can discover resources from
> an Alibaba Cloud account — which APIs are viable as a discovery backbone,
> which Node.js SDKs support them, how authentication works, and how the
> discovered data maps onto the `DiscoveredAsset` contract.
>
> **Scope**: Primary sources only (Alibaba Cloud documentation, npm registry).
> Where a primary source could not be retrieved, this is stated explicitly.
>
> **Relationship to existing work**: Extends the v1 importer scope
> ([ADR-026](./adrs/ADR-026-v1-importer-scope-7-importers.md), 7 importers)
> with an eighth in-tree importer. The importer contract
> ([ADR-056](./adrs/ADR-056-importer-registry-in-tree-code-registered.md),
> [ADR-057](./adrs/ADR-057-discoveredasset-contract.md)) is unchanged.
> Ratified decisions from the grilling session are recorded in
> [ADR-115](./adrs/ADR-115-alibaba-cloud-importer.md).

---

## Executive Summary

1. **Three viable discovery backbones exist**: Resource Center
   `SearchResources` (single account-wide, cross-region query), Cloud Config
   `ListDiscoveredResources` (aggregated inventory with status), and
   per-service `Describe*` APIs (richest data, heaviest cost). Resource Center
   is the best fit for v1: one lightweight SDK dependency, one paginated
   loop, cross-region coverage for free.
2. **Resource Center must be enabled in the account** — a precondition the
   importer can probe cheaply (`GetResourceCenterServiceStatus`) and surface
   as a clear, actionable run failure.
3. **Alibaba's Node.js SDK is Darabonba-generated, one package per service**
   (`@alicloud/<service><apiversion>`). Per-service SDKs are large (ECS is
   ~16 MB unpacked); the Resource Center package is ~1.3 MB.
4. **`sts:GetCallerIdentity` requires no RAM authorization** — the ideal
   minimal authenticated probe for `testSecrets` and a free source of the
   account identity needed for an ACCOUNT-category component.
5. **Cost and detail enrichment are additive, not part of discovery**:
   `GetResourceConfiguration` (same SDK) fetches per-resource configuration;
   BSS OpenAPI `DescribeInstanceBill` (`@alicloud/bssopenapi20171214`) returns
   per-instance billing. Both fit the established opt-in capability pattern
   from the GitHub importer.

---

## 1. Discovery backbone options

### 1a. Resource Center `SearchResources` — recommended

**API**: `ResourceCenter/2022-12-01`, RPC signature style.
**SDK**: `@alicloud/resourcecenter20221201` (v1.6.0, Feb 2026, ~1.3 MB
unpacked, deps `@darabonba/typescript` + `@alicloud/openapi-core`).
Docs: <https://www.alibabacloud.com/help/en/resource-management/resource-center/developer-reference/api-resourcecenter-2022-12-01-searchresources>

- Searches **all resources in the current account the caller is permitted to
  access**, across every supported service and region — a single call
  replaces per-service, per-region enumeration.
- Pagination: `NextToken` cursor; `MaxResults` 1–500 (default 20).
- Filters (`Filter[]`, AND between conditions, OR within values):
  `ResourceType`, `RegionId`, `ResourceId`, `ResourceGroupId`,
  `ResourceName`, `Tag`, `VpcId`, `VSwitchId` — with `Equals`, `Prefix`,
  `Contains`, `Exists`, `NotExists` match types per key.
- Rate limit: ~20 QPS per account for the older RMC variant; the
  Resource Center variant documents per-account throttling that returns
  `Throttling` errors — the importer should retry with backoff.
- **Precondition**: Resource Center must be enabled in the account.
  `GetResourceCenterServiceStatus` reports it; `EnableResourceCenter` turns
  it on (a console/operator action, not something the importer should do).
  API catalog: <https://www.alibabacloud.com/help/en/resource-management/resource-center/developer-reference/api-resourcecenter-2022-12-01-overview>
- RAM permission needed: `resourcecenter:SearchResources` (access level
  `list`, all resources).
- Companion calls in the same SDK:
  - `GetResourceCounts` — resource totals grouped by `ResourceType`,
    `RegionId`, or `ResourceGroupId`; supports the same filters and an
    `IncludeDeletedResources` flag; **requires no RAM authorization**
    (<https://help.aliyun.com/en/resource-management/resource-center/developer-reference/api-resourcecenter-2022-12-01-getresourcecounts>).
    Ideal for coverage reporting (discovered-vs-total per type).
  - `GetResourceConfiguration` — full configuration of a single resource
    (per-resource enrichment; one call per resource).

**Limits**: search records carry identity/metadata (resource type, ID, name,
region, resource group, tags, creation time) but **not live operational
status** — status must come from `GetResourceConfiguration` or per-service
Describe calls.

### 1b. Cloud Config `ListDiscoveredResources`

**API**: `Config/2020-09-07`.
Docs: <https://www.alibabacloud.com/help/en/cloud-config/latest/api-config-2020-09-07-listdiscoveredresources>

- Returns cross-region aggregated resources including `ResourceType`
  (`ACS::ECS::Instance`), `Region`, `ResourceId`, `ResourceName`, `Tags`
  (JSON string), `ResourceStatus` (e.g. `Running`/`Stopped` for ECS), and
  `ResourceDeleted`.
- **Precondition**: Cloud Config is a compliance/audit service that must be
  enabled and configured first — a heavier onboarding burden than Resource
  Center.
- Covers "only specific Alibaba Cloud services and resource types" — the
  support matrix is similar in spirit to Resource Center's.

**Verdict**: richer per-record status, but the enablement prerequisite makes
it a poor default. Reasonable future alternative/addition.

### 1c. Per-service `Describe*` APIs

Each service exposes its own list operation (`ecs:DescribeInstances`,
`rds:DescribeDBInstances`, `oss:ListBuckets`, `slb:DescribeLoadBalancers`,
`r-kvstore:DescribeInstances`, `cs:DescribeClustersV1`, …) on a regional
endpoint — so complete coverage needs N service SDKs × M regions.

- SDKs exist per service: `@alicloud/ecs20140526` (v7.x, ~16 MB unpacked),
  `@alicloud/rds20140815` (v15.x, ~13.8 MB), etc.
- Richest per-resource data (live status, full config) — at the price of
  many large dependencies and a region fan-out loop.

**Verdict**: correct enrichment path for a later phase (per-service detail
for high-value types), wrong backbone.

### 1d. Cloud Control API

A unified resource-management API Alibaba advertises in the V2 SDK docs.
Younger ecosystem; the Resource Center search model is better documented for
read-only inventory. Not evaluated further for v1.

---

## 2. Authentication and identity

- **AccessKey pair** (`accessKeyId` + `accessKeySecret`) is the standard
  credential for SDK use; Alibaba recommends a RAM user with least-privilege
  policies over the root account key.
- **STS token** (`securityToken`) is an optional third field for temporary
  credentials.
- SDK client config: `@alicloud/openapi-client` `Config` accepts
  `accessKeyId`, `accessKeySecret`, `securityToken`, `endpoint`. A richer
  `@alicloud/credentials` package supports RAM roles / OIDC — unnecessary
  for v1 (credentials come from the Componode `credentials` table per
  ADR-107).
- **`sts:GetCallerIdentity`** (`@alicloud/sts20150401` v1.2.0) returns
  `IdentityType`, `AccountId`, `PrincipalId`, `Arn` — and documents
  "**No authorization for this operation**"
  (<https://www.alibabacloud.com/help/en/ram/developer-reference/api-sts-2015-04-01-getcalleridentity>).
  This is the `testSecrets` probe and the source of the ACCOUNT component's
  identity, mirroring `aws sts get-caller-identity`.

**Minimum RAM policy for a run**:

| Action | Why |
|---|---|
| `sts:GetCallerIdentity` | implicit — no authorization required |
| `resourcecenter:SearchResources` | discovery backbone |
| `resourcecenter:GetResourceCounts` | implicit — no authorization required |
| `resourcecenter:GetResourceConfiguration` | only when `enrichResources` |
| `bss:DescribeInstanceBill` | only when `includeCosts` |

Missing optional permissions surface as `FORBIDDEN` capability markers per
`docs/importer-development.md`, never as run failures.

---

## 3. Cost data (opt-in capability)

**API**: `BssOpenApi/2017-12-14` — `DescribeInstanceBill` returns per-instance
billing line items for a billing cycle (`YYYY-MM`), keyed by `instanceID`.
(`QueryAccountBill` exists but aggregates at product level — useless for
per-resource attribution.)
**SDK**: `@alicloud/bssopenapi20171214` (v4.1.1, Jan 2026, ~3.8 MB unpacked).

- Granularity fits the GitHub importer's billing pattern: aggregate line
  items by resource ID, attach to each component's `details.billing`.
- Billing data lags (previous closed period is the safe default); the config
  takes an explicit `billingPeriod`.
- Requires BSS read permission → degrades to a `FORBIDDEN` marker.

---

## 4. Resource type → category mapping

`SearchResources` returns Alibaba-native type codes `ACS::<Service>::<Type>`.
The importer maps known codes to `ComponentCategory`; unmapped codes are
skipped with a warning and counted in a coverage summary (there is no
`OTHER` category — every asset must map to one of the 26 categories or be
skipped).

Indicative mapping (extendable without contract changes):

| `ACS::*::*` code | Category |
|---|---|
| `ECS::Instance`, `ECS::DedicatedHost` | `COMPUTE` |
| `FC::Function`, `FC::Service` | `SERVERLESS` |
| `CS::Cluster` (ACK) | `CONTAINER_ORCHESTRATION` |
| `CR::Instance`, `CR::Repository` | `PACKAGE_REGISTRY` |
| `RDS::DBInstance`, `KVStore::Instance` (Redis/Tair), `DDS::DBInstance` (MongoDB), `PolarDB::DBCluster`, `SelectDB::DBInstance` | `DATABASE` |
| `OSS::Bucket`, `NAS::FileSystem`, `EBS::Disk` | `STORAGE` |
| `VPC::VPC`, `VPC::VSwitch`, `SLB::LoadBalancer`, `EIP::EipAddress`, `NAT::NatGateway` | `NETWORK` |
| `MNS::Queue`/`Topic`, `Kafka::Instance`, `RocketMQ::Instance`, `RabbitMQ::Instance` | `QUEUE` |
| `CDN::Domain`, `DCDN::Domain` | `CDN` |
| `DNS::Domain`, `PVTZ::Zone` | `DNS` |
| `SSL::Certificate` | `CERTIFICATE` |
| `KMS::Key`, `KMS::Instance` | `KMS_KEY` |
| `KMS::Secret`, `SecretManager::Secret` | `SECRET` |
| `RAM::User`, `RAM::Role`, `RAM::Group`, `IM::Application` | `IDENTITY` |
| `SLS::Project`, `SLS::Logstore`, `CMS::*` (CloudMonitor) | `OBSERVABILITY` |
| `ApiGateway::Api`, `ApiGateway::App`, `ApiGateway::Instance` | `API` |
| `OTS::Instance` (Tablestore), `Lindorm::Instance`, `HBase::Cluster` | `DATABASE` |
| `SchedulerX::*`, `MSE::*` | `JOB`/`IDENTITY` (case-by-case) |

The authoritative supported-type list is Alibaba's "Services that work with
Resource Center" doc:
<https://www.alibabacloud.com/help/en/resource-management/resource-center/product-overview/services-that-work-with-resource-center>
— the mapping table should be built against that list at implementation
time, not treated as exhaustive here.

---

## 5. Modeling onto `DiscoveredAsset`

- **ACCOUNT component**: one per run from `sts:GetCallerIdentity`
  (`externalId` = `AccountId`, `category: "ACCOUNT"`) — the GitHub org
  component precedent. Carries `details.capabilities` (enrichment/costs
  markers) and `details.coverage` (discovered/mapped/skipped counts +
  `skippedTypes`).
- **One component per discovered resource**: `externalId` = `acs:` ARN when
  the record carries one, else `<resourceType>:<resourceId>` (stable — the
  provider ID, not the name); `resourceType` = the raw `ACS::*::*` code;
  `slug` = slugified name + short ID suffix.
- **One instance per resource**: `region` = `regionId`, `status` mapped
  best-effort when enrichment is on (else unset), `rawConfig` = the raw
  search record (or `GetResourceConfiguration` payload when enriched),
  `environment` from config (default `PRODUCTION`).
- **Tags** land in `details.tags` — `DiscoveredAsset` has no tag field.
- Deleted resources stay excluded in v1 (backend reconciliation owns GONE
  semantics); `IncludeDeletedResources` remains a possible later option.

---

## 6. Risks and open notes

- **Enablement gate**: Resource Center off → every search fails. Mitigated
  by the upfront `GetResourceCenterServiceStatus` probe + actionable error.
- **Coverage drift**: Alibaba's supported-type list grows; the category map
  will lag — acceptable because unmapped types are skipped visibly, not
  silently (coverage summary + warn log).
- **QPS**: ~20/s shared with other account traffic. `MaxResults=100`
  pagination is conservative; `enrichResources` multiplies call volume 1:1
  with resources — document the cost.
- **Endpoint variance**: China vs. international endpoints differ; the
  config's optional `endpoint` override (`urlSafetyError`-guarded per
  ADR-106/importer guide §8) covers private/VPC endpoints.
- **Multi-account** (Resource Directory): out of scope for v1 — one account
  per credential set.
