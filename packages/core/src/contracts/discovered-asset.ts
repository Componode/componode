import type {
  BomDependencyScope,
  BomEvidenceSource,
  BomCdxType,
  ComponentCategory,
  ComponentProvider,
  DiscoveredRelationshipType,
  Environment,
  InstanceStatus,
} from "../constants/index.js";

// ADR-057 Amendment 1 — package/software/firmware inventory. Factual
// observational data (like `details`/`rawConfig`), NOT a graph-edge
// declaration (graph edges are declared via `relationships[]` under
// ADR-133, behind per-config opt-in).
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

// ADR-133 — importer-declared component edges (v2 contract, spec 076).
// Opted-in importers may assert component-level edges within a run;
// `targetExternalId` resolves only against assets yielded in the SAME
// run (cross-run targets are silently dropped). Unlike `bomEntries`
// this IS a graph-edge declaration — permitted only because ADR-133
// lifted the v1 prohibition behind opt-in + provenance + suppression.
export interface DiscoveredAssetRelationship {
  type: DiscoveredRelationshipType;
  targetExternalId: string;
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
  // ADR-133 — component-level edge declarations (DEPENDS_ON, SOURCES_FROM,
  // EXPOSES). Processed only when the run's config opts in via the
  // manifest-declared key; targets resolve within this run's yielded
  // assets only. Product edges (COMPOSES, CONSUMES_FROM) remain
  // human-curated and are NOT declarable here (ADR-019/ADR-109).
  relationships?: DiscoveredAssetRelationship[];
}

// Backward-compatible alias for consumers still referencing the old name
export type DiscoveredAssetEnvironment = DiscoveredAssetInstance;
