import { canonicalizeSourceIdentity, qualifyExternalId, validateDiscoveredAsset, type DiscoveredAsset, type Importer, type ImporterContext } from "@componode/core";
import { mcpServerConfigSchema } from "./config.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildAsset(resourceType: string, endpoint: string | undefined, identity: string): DiscoveredAsset {
  const name = `mcp:${resourceType}`;
  // The pre-migration local id — `unqualifyExternalId` strips the
  // `{identity}::` prefix back to exactly this form for adoption matching.
  // Canonicalized so credential material never lands in durable ids.
  const localId = endpoint
    ? `${canonicalizeSourceIdentity(endpoint)}:${resourceType}`
    : `mcp:${resourceType}`;
  const externalId = qualifyExternalId(canonicalizeSourceIdentity(identity), localId);

  return {
    category: "MCP_SERVER",
    provider: "MCP_SERVER",
    resourceType,
    name,
    externalId,
    slug: slugify(name),
    details: { endpoint: endpoint ?? null },
    instances: [
      {
        environment: "PRODUCTION",
        externalId: `${localId}:0`,
        url: endpoint ?? null,
        status: "RUNNING",
        version: "1.0.0",
        deployedAt: new Date().toISOString(),
        rawConfig: { resourceType, endpoint },
      },
    ],
  };
}

export class McpServerImporter implements Importer {
  readonly name = "mcp-server";
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
    const parsed = mcpServerConfigSchema.parse(config);
    const identity = parsed.endpoint
      ? canonicalizeSourceIdentity(parsed.endpoint)
      : parsed.sourceKey;
    await context.reportSourceIdentity({ externalIdentity: identity });

    context.reportPhase("Listing resources");
    for (const resourceType of parsed.resourceTypes) {
      if (context.signal.aborted) {
        return;
      }

      context.reportPhase(`Processing ${resourceType}`);
      const asset = buildAsset(resourceType, parsed.endpoint, identity);
      if (!validateDiscoveredAsset(asset)) {
        throw new Error(`Invalid discovered asset for resource type ${resourceType}`);
      }
      yield asset;
    }

    context.reportPhase("Completed");
  }
}
