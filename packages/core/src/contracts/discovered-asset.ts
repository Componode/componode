import type { ComponentCategory, ComponentProvider, Environment, InstanceStatus } from "../constants/index.js";

export interface DiscoveredAssetInstance {
  environment: Environment;
  url?: string | null;
  region?: string | null;
  status?: InstanceStatus | null;
  version?: string | null;
  deployedAt?: string | null;
  externalId: string;
  rawConfig?: Record<string, unknown> | null;
  // Source-specific facts for the Source→ComponentInstance membership's
  // `details` (ADR-120). Ignored on legacy (non-adopting) runs.
  sourceDetails?: Record<string, unknown> | null;
}

export interface DiscoveredAsset {
  category: ComponentCategory;
  provider: ComponentProvider;
  resourceType: string;
  name: string;
  externalId: string;
  slug?: string;
  instances: DiscoveredAssetInstance[];
  details?: Record<string, unknown> | null;
  // Source-specific facts for the Source→Component membership's `details`
  // (ADR-120). `details` keeps writing canonical components.details;
  // sourceDetails prevents last-writer-wins across Sources. Ignored on
  // legacy (non-adopting) runs.
  sourceDetails?: Record<string, unknown> | null;
  // NOTE: relationships[] is NOT part of the v1 contract (ADR-057, Constitution Principle V).
  // Importer-declared product edges are a v2 feature. Component-to-component edges
  // (DEPENDS_ON, SOURCES_FROM, EXPOSES) are reserved for v2 per ADR-019 and ADR-057.
}

// Backward-compatible alias for consumers still referencing the old name
export type DiscoveredAssetEnvironment = DiscoveredAssetInstance;
