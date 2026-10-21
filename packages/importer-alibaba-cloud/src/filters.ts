import type { AlibabaCloudConfig } from "./config.js";

export interface SearchFilter {
  key: string;
  matchType: string;
  value: string[];
}

// ResourceGroupId is a dedicated top-level SearchResources field, not a
// Filter key — returned separately so the caller sets both.
export function buildSearchFilters(config: AlibabaCloudConfig): {
  filter: SearchFilter[];
  resourceGroupId?: string;
} {
  const filter: SearchFilter[] = [];
  if (config.regionIds.length > 0) {
    filter.push({ key: "RegionId", matchType: "Equals", value: config.regionIds });
  }
  if (config.resourceTypes.length > 0) {
    filter.push({ key: "ResourceType", matchType: "Equals", value: config.resourceTypes });
  }
  return { filter, resourceGroupId: config.resourceGroupId };
}
