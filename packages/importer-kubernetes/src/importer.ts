import { canonicalizeSourceIdentity, qualifyExternalId, validateDiscoveredAsset, type DiscoveredAsset, type Importer, type ImporterContext } from "@componode/core";
import { kubernetesConfigSchema } from "./config.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildAsset(resourceType: string, namespace: string, endpoint: string | undefined, identity: string): DiscoveredAsset {
  const name = `${resourceType}:${namespace}`;
  const externalId = qualifyExternalId(identity, `${namespace}:${resourceType}`);

  return {
    category: "CONTAINER_ORCHESTRATION",
    provider: "KUBERNETES",
    resourceType,
    name,
    externalId,
    slug: slugify(name),
    details: { namespace, endpoint: endpoint ?? null },
    instances: [
      {
        environment: "PRODUCTION",
        externalId: `${externalId}:0`,
        url: endpoint ?? null,
        status: "RUNNING",
        version: "1.0.0",
        deployedAt: new Date().toISOString(),
        rawConfig: { namespace, resourceType, endpoint },
      },
    ],
  };
}

export class KubernetesImporter implements Importer {
  readonly name = "kubernetes";
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
    const parsed = kubernetesConfigSchema.parse(config);
    const identity = parsed.endpoint
      ? canonicalizeSourceIdentity(parsed.endpoint)
      : parsed.sourceKey;
    if (!identity) {
      throw new Error(
        "kubernetes importer requires scope.endpoint or scope.sourceKey — a stable identity for the cluster (ADR-120).",
      );
    }
    await context.reportSourceIdentity({ externalIdentity: identity });

    context.reportPhase("Listing resources");
    for (const resourceType of parsed.resourceTypes) {
      if (context.signal.aborted) {
        return;
      }

      context.reportPhase(`Processing ${resourceType}`);
      const asset = buildAsset(resourceType, parsed.namespace, parsed.endpoint, identity);
      if (!validateDiscoveredAsset(asset)) {
        throw new Error(`Invalid discovered asset for resource type ${resourceType}`);
      }
      yield asset;
    }

    context.reportPhase("Completed");
  }
}
