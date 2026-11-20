import type {
  BomDependencyScope,
  BomEvidenceSource,
  BomCdxType,
  ComponentCategory,
  ComponentProvider,
  Environment,
  InstanceStatus,
} from "../constants/index.js";

// ADR-057 Amendment 1 — package/software/firmware inventory. Factual
// observational data (like `details`/`rawConfig`), NOT a graph-edge
// declaration. The `relationships[]` prohibition is unchanged.
export interface DiscoveredBomEntry {
  purl: string; // required: canonical Package URL
  name: string; // required: human-readable name
  evidenceSource: BomEvidenceSource; // required
  evidenceDetail?: string | null;
  version?: string | null;
  scope?: BomDependencyScope; // defaults to RUNTIME
  direct?: boolean; // authoritative for directness; default scope !== 'TRANSITIVE'
  licenses?: string[]; // SPDX expressions
  supplier?: string | null;
  cdxType?: BomCdxType | null; // CycloneDX component.type (round-trip)
  cdxBomRef?: string | null; // CycloneDX bomRef
  children?: DiscoveredBomEntry[]; // CycloneDX components[] / SPDX CONTAINS
  details?: Record<string, unknown> | null; // CPE, checksums, etc.
}

export interface DiscoveredAssetInstance {
  environment: Environment;
  url?: string | null;
  region?: string | null;
  status?: InstanceStatus | null;
  version?: string | null;
  deployedAt?: string | null;
  externalId: string;
  rawConfig?: Record<string, unknown> | null;
  // Instance-scoped package inventory — presence means "collection
  // finished" (replace semantics on completed runs); absence preserves the
  // Source's prior set for this instance (ADR-057 A1, ADR-131).
  bomEntries?: DiscoveredBomEntry[];
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
  // ADR-057 Amendment 1 — component-scoped package inventory. Presence
  // (including `[]`) means "collection finished — this is the truth" and
  // replaces the Source's prior set on completed runs; absence means "not
  // attempted or collection failed" and preserves it (ADR-131).
  bomEntries?: DiscoveredBomEntry[];
  // NOTE: relationships[] is NOT part of the v1 contract (ADR-057, Constitution Principle V).
  // Importer-declared product edges are a v2 feature. Component-to-component edges
  // (DEPENDS_ON, SOURCES_FROM, EXPOSES) are reserved for v2 per ADR-019 and ADR-057.
}

// Backward-compatible alias for consumers still referencing the old name
export type DiscoveredAssetEnvironment = DiscoveredAssetInstance;
