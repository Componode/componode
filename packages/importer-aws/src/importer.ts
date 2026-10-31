import { qualifyExternalId, validateDiscoveredAsset, type DiscoveredAsset, type Importer, type ImporterContext } from "@componode/core";
import { awsConfigSchema } from "./config.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildAsset(resourceType: string, region: string, endpoint: string | undefined, identity: string): DiscoveredAsset {
  const name = `${resourceType}:${region}`;
  const externalId = qualifyExternalId(identity, `${region}:${resourceType}`);

  return {
    category: "COMPUTE",
    provider: "AWS",
    resourceType,
    name,
    externalId,
    slug: slugify(name),
    details: { region, endpoint: endpoint ?? null },
    instances: [
      {
        environment: "PRODUCTION",
        externalId: `${externalId}:0`,
        url: endpoint ?? null,
        status: "RUNNING",
        version: "1.0.0",
        deployedAt: new Date().toISOString(),
        rawConfig: { region, resourceType, endpoint },
      },
    ],
  };
}

export class AwsImporter implements Importer {
  readonly name = "aws";
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
    const parsed = awsConfigSchema.parse(config);
    if (!parsed.sourceKey) {
      throw new Error(
        "aws importer requires scope.sourceKey — a stable, non-secret key identifying the AWS account (ADR-120).",
      );
    }
    await context.reportSourceIdentity({ externalIdentity: parsed.sourceKey });

    context.reportPhase("Listing resources");
    for (const resourceType of parsed.resourceTypes) {
      if (context.signal.aborted) {
        return;
      }

      context.reportPhase(`Processing ${resourceType}`);
      const asset = buildAsset(resourceType, parsed.region, parsed.endpoint, parsed.sourceKey);
      if (!validateDiscoveredAsset(asset)) {
        throw new Error(`Invalid discovered asset for resource type ${resourceType}`);
      }
      yield asset;
    }

    context.reportPhase("Completed");
  }
}
