import type { DiscoveredAsset } from "@componode/core";
import type { AlibabaCloudConfig } from "./config.js";
import type { CallerIdentity } from "./client.js";
import type { CapabilityMap } from "./capabilities.js";

export interface CoverageSummary {
  discoveredCount: number;
  mappedCount: number;
  skippedCount: number;
  skippedTypes: string[];
  skippedReasons: { deleted: number; incomplete: number; unmappedType: number };
  totals?: Record<string, number>;
}

export function buildAccountAsset(
  identity: CallerIdentity,
  config: AlibabaCloudConfig,
  capabilities: CapabilityMap,
  coverage: CoverageSummary,
): DiscoveredAsset {
  if (!identity.accountId) {
    throw new Error("Cannot build account asset: GetCallerIdentity returned no AccountId");
  }
  const accountId = identity.accountId;
  return {
    category: "ACCOUNT",
    provider: "ALIBABA_CLOUD",
    resourceType: "alibaba-cloud:account",
    name: `Alibaba Cloud account ${accountId}`,
    externalId: accountId,
    slug: `alibaba-cloud-account-${accountId}`,
    details: {
      arn: identity.arn ?? null,
      identityType: identity.identityType ?? null,
      principalId: identity.principalId ?? null,
      capabilities,
      coverage,
    },
    instances: [
      {
        environment: config.environment,
        externalId: accountId,
        status: "RUNNING",
      },
    ],
  };
}
