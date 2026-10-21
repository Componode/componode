import ResourceCenter20221201, * as $ResourceCenter20221201 from "@alicloud/resourcecenter20221201";
import Sts20150401 from "@alicloud/sts20150401";
import BssOpenApi20171214, * as $BssOpenApi20171214 from "@alicloud/bssopenapi20171214";
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

function buildSdkConfig(
  secrets: Record<string, string>,
  endpoint: string | undefined,
): $OpenApiUtil.Config {
  return new $OpenApiUtil.Config({
    accessKeyId: secrets.accessKeyId,
    accessKeySecret: secrets.accessKeySecret,
    securityToken: secrets.securityToken,
    ...(endpoint ? { endpoint } : {}),
  });
}

export function buildClients(
  secrets: Record<string, string>,
  config: AlibabaCloudConfig,
): AlibabaClients {
  // Alibaba endpoints are per-product — a single override can only target
  // one service, so `config.endpoint` scopes to Resource Center (the
  // discovery backbone where VPC/private routing actually varies). STS and
  // BSS keep default endpoint resolution, which already handles
  // international vs. China; BSS is a global endpoint anyway.
  const rc = new ResourceCenter20221201(buildSdkConfig(secrets, config.endpoint));
  const sts = new Sts20150401(buildSdkConfig(secrets, undefined));
  const bss = new BssOpenApi20171214(buildSdkConfig(secrets, undefined));

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
