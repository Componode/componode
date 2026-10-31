import { canonicalizeSourceIdentity, validateDiscoveredAsset, type DiscoveredAsset, type Importer, type ImporterContext } from "@componode/core";
import { azureConfigSchema } from "./config.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildAsset(resourceType: string, subscriptionId: string | undefined, endpoint: string | undefined, identity: string): DiscoveredAsset {
  const identityPrefix = canonicalizeSourceIdentity(identity);
  const name = `${resourceType}:${identityPrefix}`;
  const externalId = `${identityPrefix}:${resourceType}`;

  return {
    category: "COMPUTE",
    provider: "AZURE",
    resourceType,
    name,
    externalId,
    slug: slugify(name),
    details: { subscriptionId: subscriptionId ?? null, endpoint: endpoint ?? null },
    instances: [
      {
        environment: "PRODUCTION",
        externalId: `${externalId}:0`,
        url: endpoint ?? null,
        status: "RUNNING",
        version: "1.0.0",
        deployedAt: new Date().toISOString(),
        rawConfig: { resourceType, subscriptionId, endpoint },
      },
    ],
  };
}

export class AzureImporter implements Importer {
  readonly name = "azure";
  readonly version = "1.0.0";

  async *run(
    config: Record<string, unknown>,
    _secrets: Record<string, string>,
    context: ImporterContext,
  ): AsyncGenerator<DiscoveredAsset> {
    if (context.signal.aborted) {
      return;
    }

    context.reportPhase("Initializing");
    const parsed = azureConfigSchema.parse(config);
    const identity = parsed.subscriptionId ?? parsed.sourceKey;
    if (!identity) {
      // Unreachable — the schema refine enforces one of the pair — but
      // narrows `string | undefined` and fails closed if that ever drifts.
      throw new Error("azure importer requires subscriptionId or sourceKey (ADR-120).");
    }
    await context.reportSourceIdentity({ externalIdentity: identity });

    context.reportPhase("Listing resources");
    for (const resourceType of parsed.resourceTypes) {
      if (context.signal.aborted) {
        return;
      }

      context.reportPhase(`Processing ${resourceType}`);
      const asset = buildAsset(resourceType, parsed.subscriptionId, parsed.endpoint, identity);
      if (!validateDiscoveredAsset(asset)) {
        throw new Error(`Invalid discovered asset for resource type ${resourceType}`);
      }
      yield asset;
    }

    context.reportPhase("Completed");
  }
}
