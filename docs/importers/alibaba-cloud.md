# Alibaba Cloud importer

Imports an Alibaba Cloud account's resource inventory via **Resource Center**
`SearchResources` — one account component plus one component+instance per
discovered resource (ECS instances, OSS buckets, RDS databases, VPC/network
objects, and more).

## What it creates

- One **account component** (`ACCOUNT` category) carrying the coverage
  summary: discovered/mapped/skipped counts, skipped types, per-type totals,
  and capability markers.
- One **component per mapped resource** with one **instance** carrying
  region, environment, operational status (when enrichment is enabled), and
  the raw provider record.
- Resources whose `ACS::<Service>::<Type>` has no category mapping are
  **skipped, warned, and counted** — never silently dropped, never fatal.

## Prerequisites in Alibaba Cloud

1. **Enable Resource Center** on the account (console → Resource Center →
   enable). The run fails fast with an actionable message if it isn't —
   this is the most common setup failure. If it was just enabled, the index
   may still be building; the importer logs a warning (`initialStatus:
   Pending`) and the first run may undercount.
2. **Create a RAM user** (or role) with an AccessKey pair — least privilege.
   Root account keys work but are not recommended.
3. **Attach permissions**:
   - Required: Resource Center read access (`resourcecenter:SearchResources`,
     `resourcecenter:GetResourceCenterServiceStatus`) and
     `sts:GetCallerIdentity` (used for the credential test and account ID).
   - Optional — coverage totals: `resourcecenter:GetResourceCounts`.
   - Optional — enrichment (`enrichResources`):
     `resourcecenter:GetResourceConfiguration`.
   - Optional — costs (`includeCosts`): BSS bill read,
     `bss:DescribeInstanceBill` (e.g. the `AliyunBSSReadOnlyAccess` policy).
4. For **STS temporary credentials** (role assumption), also store the
   `securityToken`.

## Credentials

| Secret key | Required | How to get it |
|---|---|---|
| `accessKeyId` | Yes | RAM console → user → AccessKey |
| `accessKeySecret` | Yes | Shown once at AccessKey creation |
| `securityToken` | No | STS session token for temporary credentials |

Use the credential **Test** action — it calls `GetCallerIdentity`, the
smallest authenticated call.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `regionIds` | string[] | all regions | Restrict discovery to these regions |
| `resourceTypes` | string[] | all types | Restrict to `ACS::*::*` types (e.g. `ACS::OSS::Bucket`) |
| `resourceGroupId` | string | all groups | Restrict to a resource group |
| `environment` | enum | `PRODUCTION` | Environment tag on every instance (`DEV`/`TEST`/`STAGING`/`DEMO`/`PRODUCTION`/`OTHER`) |
| `enrichResources` | bool | `false` | One `GetResourceConfiguration` call per resource — adds full config + status. Costs ~1 call per resource |
| `includeCosts` | bool | `false` | Attach `details.billing` per resource (needs BSS read) |
| `billingPeriod` | `YYYY-MM` | latest closed month | Billing cycle to read |
| `endpoint` | URL | Alibaba default | Resource Center endpoint override (VPC/private gateway). Applies to Resource Center **only** — Alibaba endpoints are per-product; STS/BSS use default resolution |

## Behavior notes

- The account component is emitted **last** so its coverage summary is final.
- `details.billing` entries include `billingPeriod`, `pretaxAmount`,
  `pretaxGrossAmount`, `currency`, `productName`, `lineItems`.
- Enrichment markers appear per component only when the enrichment call was
  degraded (`capabilities.enrichment`); account-level markers cover
  `resourceCounts` and `costs`.
- One credential set = one account. Resource Directory multi-account
  aggregation is out of scope for v1.
- `component_instances.status` is non-nullable in the platform schema; an
  importer-emitted `null` status persists as `RUNNING` (see
  `specs/024-alibaba-cloud-importer/data-model.md` platform note).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Resource Center is not enabled" | Enable Resource Center in the console for this account |
| Warning about the index still building | Resource Center was just enabled — wait, then re-run |
| `capabilities.costs` = `FORBIDDEN` | RAM user lacks `bss:DescribeInstanceBill` |
| `capabilities.enrichment` markers on every component | RAM user lacks `resourcecenter:GetResourceConfiguration` |
| Credential test fails | Wrong key pair, or missing `sts:GetCallerIdentity` |

## Source identity

Identity is the `AccountId` returned by STS `GetCallerIdentity` — fetched
before any asset is yielded, so an empty inventory still registers the Source.
`externalId`s are ARN-based and already globally unique; they are unchanged.
No migration backfill (the identity needs a live STS call) — existing accounts
adopt on their next run. Resource and account assets carry `sourceDetails`
(ARN, identity type, resource group, zone) that persist on the Source
membership rather than the shared component row.
