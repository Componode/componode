import * as $ResourceCenter20221201 from "@alicloud/resourcecenter20221201";
import * as $Sts20150401 from "@alicloud/sts20150401";
import * as $BssOpenApi20171214 from "@alicloud/bssopenapi20171214";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import type { AlibabaCloudConfig } from "./config.js";
import type { SearchFilter } from "./filters.js";

export interface CallerIdentity {
  accountId?: string;
  arn?: string;
  identityType?: string;
  principalId?: string;
  userId?: string;
  roleId?: string;
}

export interface ServiceStatus {
  serviceStatus?: string;
  initialStatus?: string;
}

export interface ResourceCount {
  groupName?: string;
  count?: number;
}

export interface SearchRecord {
  accountId?: string;
  arn?: string;
  createTime?: string;
  deleted?: boolean;
  expireTime?: string;
  ipAddresses?: string[];
  regionId?: string;
  resourceGroupId?: string;
  resourceId?: string;
  resourceName?: string;
  resourceType?: string;
  tags?: { key?: string; value?: string }[];
  zoneId?: string;
}

export interface SearchPage {
  resources: SearchRecord[];
  nextToken?: string;
}

export interface ResourceConfiguration {
  configuration?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BillItem {
  instanceID?: string;
  pretaxAmount?: number;
  pretaxGrossAmount?: number;
  currency?: string;
  productName?: string;
}

export interface BillPage {
  items: BillItem[];
  nextToken?: string;
  totalCount?: number;
}

export interface AlibabaClients {
  getCallerIdentity(): Promise<CallerIdentity>;
  getServiceStatus(): Promise<ServiceStatus>;
  getResourceCounts(groupByKey: string): Promise<ResourceCount[]>;
  searchResourcesPage(request: {
    filter?: SearchFilter[];
    resourceGroupId?: string;
    maxResults: number;
    nextToken?: string;
  }): Promise<SearchPage>;
  getResourceConfiguration(request: {
    resourceType: string;
    resourceId: string;
    resourceRegionId?: string;
  }): Promise<ResourceConfiguration>;
  describeInstanceBillPage(request: {
    billingCycle: string;
    nextToken?: string;
    maxResults?: number;
  }): Promise<BillPage>;
}

// Alibaba SDK packages are CJS-only: each dist/client.js marks __esModule
// and exports the client class on `default`. Interop differs by runtime —
// Node's ESM namespace exposes `default = module.exports` (the exports
// object, itself carrying `.default = Client`), while bundled CJS runtimes
// can bind a default import to that namespace directly. Either way `new X()`
// on the wrapper throws "X is not a constructor", so unwrap `.default`
// until a callable constructor surfaces.
type CtorOf<M> = M extends { default: infer C } ? (C extends { default: infer D } ? D : C) : M;

export function sdkCtor<M>(mod: M): CtorOf<M> {
  let current: unknown = mod;
  while (typeof current !== "function" && current !== null && typeof current === "object" && "default" in current) {
    current = (current as { default: unknown }).default;
  }
  return current as CtorOf<M>;
}

const ResourceCenterClient = sdkCtor($ResourceCenter20221201);
const StsClient = sdkCtor($Sts20150401);
const BssClient = sdkCtor($BssOpenApi20171214);

// Config endpoint fields arrive as validated URLs ("https://host:port")
// while the SDK wants host[:port] plus a `protocol` field — the wire URL is
// `${protocol}://${endpoint}`, so a scheme-bearing endpoint would double it.
// Bare hosts (the global defaults below) pass through untouched.
function normalizeEndpoint(value: string): { endpoint: string; protocol?: string } {
  const url = value.includes("://") ? new URL(value) : undefined;
  return { endpoint: url?.host ?? value, protocol: url?.protocol.replace(":", "") };
}

interface ClientOpts {
  endpoint?: string;
  regionId?: string;
}

export function buildSdkConfig(
  secrets: Record<string, string>,
  opts: ClientOpts,
): $OpenApiUtil.Config {
  const normalized = opts.endpoint ? normalizeEndpoint(opts.endpoint) : undefined;
  return new $OpenApiUtil.Config({
    accessKeyId: secrets.accessKeyId,
    accessKeySecret: secrets.accessKeySecret,
    securityToken: secrets.securityToken,
    ...(normalized?.endpoint ? { endpoint: normalized.endpoint } : {}),
    ...(normalized?.protocol ? { protocol: normalized.protocol } : {}),
    ...(opts.regionId ? { regionId: opts.regionId } : {}),
  });
}

// Alibaba endpoints are per-product — each service keeps its own override
// (`endpoint` scopes to Resource Center; `stsEndpoint`/`bssEndpoint` to STS
// and BSS). `region` pins Config.regionId on all three; an explicit
// endpoint wins for its client. STS and BSS resolve endpoints with a
// *regional* rule and throw at construction when neither regionId nor
// endpoint is set — hence the documented global-endpoint fallbacks below.
// Resource Center's rule resolves its global endpoint on its own.
const DEFAULT_STS_ENDPOINT = "sts.aliyuncs.com";
const DEFAULT_BSS_ENDPOINT = "business.aliyuncs.com";

export function buildClientOpts(config: AlibabaCloudConfig): {
  rc: ClientOpts;
  sts: ClientOpts;
  bss: ClientOpts;
} {
  return {
    rc: { endpoint: config.endpoint, regionId: config.region },
    sts: {
      endpoint: config.stsEndpoint ?? (config.region ? undefined : DEFAULT_STS_ENDPOINT),
      regionId: config.region,
    },
    bss: {
      endpoint: config.bssEndpoint ?? (config.region ? undefined : DEFAULT_BSS_ENDPOINT),
      regionId: config.region,
    },
  };
}

export function buildClients(
  secrets: Record<string, string>,
  config: AlibabaCloudConfig,
): AlibabaClients {
  const opts = buildClientOpts(config);
  const rc = new ResourceCenterClient(buildSdkConfig(secrets, opts.rc));
  const sts = new StsClient(buildSdkConfig(secrets, opts.sts));
  const bss = new BssClient(buildSdkConfig(secrets, opts.bss));

  return {
    async getCallerIdentity() {
      const res = await sts.getCallerIdentity();
      return res.body ?? {};
    },
    async getServiceStatus() {
      const res = await rc.getResourceCenterServiceStatus();
      return res.body ?? {};
    },
    async getResourceCounts(groupByKey) {
      const res = await rc.getResourceCounts(
        new $ResourceCenter20221201.GetResourceCountsRequest({ groupByKey }),
      );
      return res.body?.resourceCounts ?? [];
    },
    async searchResourcesPage(request) {
      const res = await rc.searchResources(
        new $ResourceCenter20221201.SearchResourcesRequest({
          filter: request.filter?.map(
            (f) =>
              new $ResourceCenter20221201.SearchResourcesRequestFilter({
                key: f.key,
                matchType: f.matchType,
                value: f.value,
              }),
          ),
          resourceGroupId: request.resourceGroupId,
          maxResults: request.maxResults,
          nextToken: request.nextToken,
        }),
      );
      return {
        resources: (res.body?.resources ?? []).map((r) => ({
          ...r,
          // Resource Center spells the ARN field "ResourceARN" on some API
          // versions; normalize to `arn` when present.
          arn: r.arn ?? (r as unknown as { resourceARN?: string }).resourceARN,
        })),
        nextToken: res.body?.nextToken,
      };
    },
    async getResourceConfiguration(request) {
      const res = await rc.getResourceConfiguration(
        new $ResourceCenter20221201.GetResourceConfigurationRequest({
          resourceType: request.resourceType,
          resourceId: request.resourceId,
          resourceRegionId: request.resourceRegionId,
        }),
      );
      return (res.body ?? {}) as ResourceConfiguration;
    },
    async describeInstanceBillPage(request) {
      const res = await bss.describeInstanceBill(
        new $BssOpenApi20171214.DescribeInstanceBillRequest({
          billingCycle: request.billingCycle,
          nextToken: request.nextToken,
          maxResults: request.maxResults ?? 300,
          isHideZeroCharge: false,
        }),
      );
      const data = res.body?.data;
      return {
        items: data?.items ?? [],
        nextToken: data?.nextToken,
        totalCount: data?.totalCount,
      };
    },
  };
}
