import { z } from "zod";
import type { DiscoveredAsset, DiscoveredBomEntry } from "../contracts/discovered-asset.js";
import {
  BOM_CDX_TYPES,
  BOM_DEPENDENCY_SCOPES,
  BOM_EVIDENCE_SOURCES,
  COMPONENT_CATEGORIES,
  COMPONENT_PROVIDERS,
  DISCOVERED_RELATIONSHIP_TYPES,
  ENVIRONMENTS,
  INSTANCE_STATUS,
} from "../constants/index.js";
import { isValidPurl } from "../utils/purl.js";

// ADR-057 Amendment 1 — package inventory is factual observational data.
// `bomEntries` stays OPTIONAL and presence-preserving: absent = "not
// attempted / collection failed" (prior set preserved), `[]` = "finished,
// truth is empty" (scope replaced). Never default the field in.
const discoveredBomEntrySchema: z.ZodType<DiscoveredBomEntry> = z.lazy(() =>
  z.object({
    purl: z.string().min(1).refine(isValidPurl, { message: "must be a valid Package URL" }),
    name: z.string().min(1),
    evidenceSource: z.enum(BOM_EVIDENCE_SOURCES),
    evidenceDetail: z.string().nullable().optional(),
    version: z.string().nullable().optional(),
    scope: z.enum(BOM_DEPENDENCY_SCOPES).optional(),
    direct: z.boolean().optional(),
    licenses: z.array(z.string()).optional(),
    supplier: z.string().nullable().optional(),
    cdxType: z.enum(BOM_CDX_TYPES).nullable().optional(),
    cdxBomRef: z.string().nullable().optional(),
    children: z.array(discoveredBomEntrySchema).optional(),
    details: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
) as z.ZodType<DiscoveredBomEntry>;

const discoveredAssetInstanceSchema = z.object({
  environment: z.enum(ENVIRONMENTS),
  url: z.string().url().nullable().optional(),
  region: z.string().nullable().optional(),
  status: z.enum(INSTANCE_STATUS).nullable().optional(),
  version: z.string().nullable().optional(),
  deployedAt: z.string().datetime().nullable().optional(),
  externalId: z.string().min(1),
  rawConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  bomEntries: z.array(discoveredBomEntrySchema).optional(),
  sourceDetails: z.record(z.string(), z.unknown()).nullable().optional(),
});

// ADR-133 — importer-declared component edges. A malformed entry fails the
// whole asset, like every other contract field.
const discoveredAssetRelationshipSchema = z
  .object({
    type: z.enum(DISCOVERED_RELATIONSHIP_TYPES),
    targetExternalId: z.string().min(1),
  })
  .strict();

const discoveredAssetSchema = z.object({
  category: z.enum(COMPONENT_CATEGORIES),
  provider: z.enum(COMPONENT_PROVIDERS),
  resourceType: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  externalId: z.string().min(1),
  slug: z.string().max(100).optional(),
  instances: z.array(discoveredAssetInstanceSchema),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
  bomEntries: z.array(discoveredBomEntrySchema).optional(),
  sourceDetails: z.record(z.string(), z.unknown()).nullable().optional(),
  relationships: z.array(discoveredAssetRelationshipSchema).optional(),
});

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validateDiscoveredAsset(asset: unknown): asset is DiscoveredAsset {
  return discoveredAssetSchema.safeParse(asset).success;
}

export function validateDiscoveredAssetDetailed(asset: unknown): ValidationResult {
  const result = discoveredAssetSchema.safeParse(asset);
  if (result.success) {
    return { valid: true };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
