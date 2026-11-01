import { z } from "zod";
import type { DiscoveredAsset } from "../contracts/discovered-asset.js";
import {
  COMPONENT_CATEGORIES,
  COMPONENT_PROVIDERS,
  ENVIRONMENTS,
  INSTANCE_STATUS,
} from "../constants/index.js";

const discoveredAssetInstanceSchema = z.object({
  environment: z.enum(ENVIRONMENTS),
  url: z.string().url().nullable().optional(),
  region: z.string().nullable().optional(),
  status: z.enum(INSTANCE_STATUS).nullable().optional(),
  version: z.string().nullable().optional(),
  deployedAt: z.string().datetime().nullable().optional(),
  externalId: z.string().min(1),
  rawConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  sourceDetails: z.record(z.string(), z.unknown()).nullable().optional(),
});

const discoveredAssetSchema = z.object({
  category: z.enum(COMPONENT_CATEGORIES),
  provider: z.enum(COMPONENT_PROVIDERS),
  resourceType: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  externalId: z.string().min(1),
  slug: z.string().max(100).optional(),
  instances: z.array(discoveredAssetInstanceSchema),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
  sourceDetails: z.record(z.string(), z.unknown()).nullable().optional(),
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
