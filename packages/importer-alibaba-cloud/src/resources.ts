import type { DiscoveredAsset, ImporterContext } from "@componode/core";
import type { AlibabaClients, SearchRecord } from "./client.js";
import type { AlibabaCloudConfig } from "./config.js";
import { buildSearchFilters } from "./filters.js";
import { capabilityMarker, withCapability, type CapabilityMarker } from "./capabilities.js";
import {
  componentSlug,
  externalIdFor,
  mapResourceType,
  mapStatus,
  statusFromConfiguration,
} from "./mapping.js";

const MAX_RESULTS = 100;
const MAX_THROTTLE_RETRIES = 3;

export interface SearchCoverage {
  discoveredCount: number;
  mappedCount: number;
  skippedCount: number;
  skippedTypes: Set<string>;
}

export interface BillingMap {
  get(resourceId: string): unknown | undefined;
}

function isThrottling(err: unknown): boolean {
  const code = String(
    (err as { code?: string; name?: string })?.code ??
      (err as { name?: string })?.name ??
      "",
  );
  return /throttl/i.test(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildResourceAsset(
  record: SearchRecord,
  config: AlibabaCloudConfig,
  category: NonNullable<ReturnType<typeof mapResourceType>>,
  extras: {
    billing?: unknown;
    enrichmentMarker?: CapabilityMarker;
    enrichedConfig?: Record<string, unknown>;
  },
): DiscoveredAsset {
  const resourceType = record.resourceType ?? "ACS::Unknown";
  const resourceId = record.resourceId ?? "unknown";
  const name = record.resourceName || resourceId;
  const status =
    extras.enrichedConfig !== undefined
      ? mapStatus(statusFromConfiguration(extras.enrichedConfig))
      : null;

  const details: Record<string, unknown> = {
    resourceGroupId: record.resourceGroupId ?? null,
    zoneId: record.zoneId ?? null,
    service: resourceType.split("::")[1] ?? null,
    createTime: record.createTime ?? null,
    tags: (record.tags ?? []).map((t) => ({ key: t.key ?? "", value: t.value ?? "" })),
    ...(extras.billing !== undefined ? { billing: extras.billing } : {}),
    ...(extras.enrichmentMarker ? { capabilities: { enrichment: extras.enrichmentMarker } } : {}),
  };

  return {
    category,
    provider: "ALIBABA_CLOUD",
    resourceType,
    name,
    externalId: externalIdFor(record),
    slug: componentSlug(name, resourceId),
    details,
    instances: [
      {
        environment: config.environment,
        region: record.regionId ?? null,
        status,
        externalId: resourceId,
        rawConfig: extras.enrichedConfig ?? (record as unknown as Record<string, unknown>),
      },
    ],
  };
}

export async function* iterResourceAssets(
  client: AlibabaClients,
  config: AlibabaCloudConfig,
  context: ImporterContext,
  billing: BillingMap | undefined,
  coverage: SearchCoverage,
): AsyncGenerator<DiscoveredAsset> {
  const { filter, resourceGroupId } = buildSearchFilters(config);
  let nextToken: string | undefined;
  const warnedTypes = new Set<string>();

  do {
    if (context.signal.aborted) return;

    let page;
    for (let attempt = 0; ; attempt++) {
      try {
        page = await client.searchResourcesPage({
          filter: filter.length > 0 ? filter : undefined,
          resourceGroupId,
          maxResults: MAX_RESULTS,
          nextToken,
        });
        break;
      } catch (err) {
        if (isThrottling(err) && attempt < MAX_THROTTLE_RETRIES) {
          await sleep(100 * 2 ** attempt + Math.floor(Math.random() * 100));
          continue;
        }
        throw err;
      }
    }

    for (const record of page.resources) {
      if (context.signal.aborted) return;
      coverage.discoveredCount++;

      const resourceType = record.resourceType ?? "";
      const category = mapResourceType(resourceType);
      if (!category) {
        coverage.skippedCount++;
        coverage.skippedTypes.add(resourceType || "UNKNOWN");
        if (!warnedTypes.has(resourceType)) {
          warnedTypes.add(resourceType);
          context.logger.warn("Skipping unmapped Alibaba Cloud resource type", {
            resourceType,
          });
        }
        continue;
      }
      coverage.mappedCount++;

      context.reportPhase(`Processing ${resourceType} ${record.resourceId ?? ""}`.trim());

      let enrichmentMarker: CapabilityMarker | undefined;
      let enrichedConfig: Record<string, unknown> | undefined;
      if (config.enrichResources && record.resourceId && resourceType) {
        const result = await withCapability(() =>
          client.getResourceConfiguration({
            resourceType,
            resourceId: record.resourceId!,
            resourceRegionId: record.regionId,
          }),
        );
        enrichmentMarker = capabilityMarker(result);
        if (result.status === "OK" && result.data.configuration) {
          enrichedConfig = result.data.configuration;
        }
      }

      yield buildResourceAsset(record, config, category, {
        billing: record.resourceId ? billing?.get(record.resourceId) : undefined,
        enrichmentMarker,
        enrichedConfig,
      });
    }

    nextToken = page.nextToken || undefined;
  } while (nextToken);
}
