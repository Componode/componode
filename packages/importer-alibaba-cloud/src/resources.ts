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
  skippedReasons: { deleted: number; incomplete: number; unmappedType: number };
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

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
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
  // DiscoveredAsset caps name at 255 chars.
  const name = (record.resourceName || resourceId).slice(0, 255);
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
          await sleep(100 * 2 ** attempt + Math.floor(Math.random() * 100), context.signal);
          if (context.signal.aborted) return;
          continue;
        }
        throw err;
      }
    }

    for (const record of page.resources) {
      if (context.signal.aborted) return;
      coverage.discoveredCount++;

      // Deleted resources are excluded by default server-side; skip any that
      // still arrive rather than importing tombstones.
      if (record.deleted === true) {
        coverage.skippedCount++;
        coverage.skippedReasons.deleted++;
        continue;
      }

      // Without both identifiers we can't build a stable externalId — skip
      // rather than colliding on "ACS::Unknown:unknown".
      if (!record.resourceId || !record.resourceType) {
        coverage.skippedCount++;
        coverage.skippedReasons.incomplete++;
        if (!warnedTypes.has("__incomplete__")) {
          warnedTypes.add("__incomplete__");
          context.logger.warn("Skipping Alibaba Cloud record missing resourceId/resourceType", {
            resourceType: record.resourceType ?? null,
            resourceId: record.resourceId ?? null,
          });
        }
        continue;
      }

      const resourceType = record.resourceType;
      const resourceId = record.resourceId;
      const category = mapResourceType(resourceType);
      if (!category) {
        coverage.skippedCount++;
        coverage.skippedReasons.unmappedType++;
        coverage.skippedTypes.add(resourceType);
        if (!warnedTypes.has(resourceType)) {
          warnedTypes.add(resourceType);
          context.logger.warn("Skipping unmapped Alibaba Cloud resource type", {
            resourceType,
          });
        }
        continue;
      }
      coverage.mappedCount++;

      let enrichmentMarker: CapabilityMarker | undefined;
      let enrichedConfig: Record<string, unknown> | undefined;
      if (config.enrichResources) {
        const result = await withCapability(() =>
          client.getResourceConfiguration({
            resourceType,
            resourceId,
            resourceRegionId: record.regionId,
          }),
        );
        // Markers exist to flag degraded capability — success isn't a marker.
        if (result.status !== "OK") enrichmentMarker = capabilityMarker(result);
        else if (result.data.configuration) enrichedConfig = result.data.configuration;
      }

      yield buildResourceAsset(record, config, category, {
        billing: billing?.get(resourceId),
        enrichmentMarker,
        enrichedConfig,
      });
    }

    nextToken = page.nextToken || undefined;
  } while (nextToken);
}
