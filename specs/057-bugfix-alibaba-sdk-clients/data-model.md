# Data Model: Alibaba Cloud importer SDK client fixes

**Feature**: `057-bugfix-alibaba-sdk-clients` | **Date**: 2026-11-02

No database or persistence changes — the only "model" surface is the
importer's zod config schema (`AlibabaCloudConfig`) and the SDK Config
wiring derived from it.

## `AlibabaCloudConfig` — schema delta

Existing fields unchanged (`regionIds`, `resourceTypes`,
`resourceGroupId`, `environment`, `enrichResources`, `includeCosts`,
`billingPeriod`, `endpoint`). Additions:

| Field | Type | Required | Default | Semantics |
|---|---|---|---|---|
| `region` | string (min 1) | no | — | SDK `regionId` for **all three** clients — connectivity pinning, e.g. `cn-hangzhou`. Distinct from `regionIds`, which only filters discovery. |
| `stsEndpoint` | URL | no | — | STS endpoint override (VPC gateway / mock). Wins over `region` for the STS client. Same `urlSafetyError` validation as `endpoint`. |
| `bssEndpoint` | URL | no | — | BSS OpenAPI endpoint override (VPC gateway / mock). Wins over `region` for the BSS client. Same `urlSafetyError` validation as `endpoint`. |

`endpoint` keeps its existing scope: Resource Center only.

## Client wiring mapping

| Client | `endpoint` on SDK Config | `regionId` on SDK Config |
|---|---|---|
| Resource Center (`rc`) | `config.endpoint` | `config.region` |
| STS (`sts`) | `config.stsEndpoint` — else `"sts.aliyuncs.com"` when `region` is also unset | `config.region` |
| BSS (`bss`) | `config.bssEndpoint` — else `"business.aliyuncs.com"` when `region` is also unset | `config.region` |

Precedence per client: explicit endpoint override → `region` → SDK
default/global resolution. The STS/BSS fallbacks exist because both SDKs
use a *regional* endpoint rule and throw at construction when neither
`regionId` nor `endpoint` is set — the documented global endpoints are
their resolvable default. Endpoint config values arrive as URLs and are
normalized to `host[:port]` + `protocol` for the SDK. Unset fields are
omitted from the Config object entirely (never sent as `undefined`
placeholders — matches the existing spread pattern).

## Validation rules

- `region`: `z.string().min(1).optional()` — a region *code*, not a URL;
  no further format constraint (Alibaba region codes vary and are
  provider-validated at call time).
- `stsEndpoint` / `bssEndpoint`: `z.string().url()` +
  `superRefine(urlSafetyError)` — identical to the existing `endpoint`
  field; blocks SSRF to literal private IPs/localhost while permitting
  named hosts (e.g. a compose mock service).
- Schema stays `.strict()` — unknown fields still rejected.

## Invariants

- `regionIds` (filter) and `region` (connectivity) never feed each other.
- No field combination is invalid — `endpoint` + `region` on the RC client
  is meaningful (endpoint wins).
- Empty/absent values fall back to default endpoint resolution: Resource
  Center resolves `resourcecenter.aliyuncs.com` via its non-regional rule;
  STS/BSS receive their documented global endpoints (`sts.aliyuncs.com`,
  `business.aliyuncs.com`) since their regional rule cannot construct
  without a region or endpoint — previously this threw at construction.
