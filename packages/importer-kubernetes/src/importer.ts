import { canonicalizeSourceIdentity, qualifyExternalId, validateDiscoveredAsset, type DiscoveredAsset, type Importer, type ImporterContext } from "@componode/core";
import { kubernetesConfigSchema } from "./config.js";
import { collectPodImageBoms, type PodImageBom } from "./k8s-pods.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildAsset(resourceType: string, namespace: string, endpoint: string | undefined, identity: string): DiscoveredAsset {
  const name = `${resourceType}:${namespace}`;
  const localId = `${namespace}:${resourceType}`;
  const externalId = qualifyExternalId(canonicalizeSourceIdentity(identity), localId);

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
        externalId: `${localId}:0`,
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
    secrets: Record<string, string>,
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
      // Unreachable — schema refine enforces endpoint|sourceKey — but
      // narrows `string | undefined` and fails closed if that drifts.
      throw new Error("kubernetes importer requires endpoint or sourceKey (ADR-120).");
    }
    await context.reportSourceIdentity({ externalIdentity: identity });

    // Spec 073 / FR-016 — pod image SBOMs. Collected once per run; each
    // workload asset gets its pods' image packages (component scope).
    // Degradation writes `bomInventory` onto the asset's capability map —
    // the field stays absent, never empty (FR-004).
    let podBoms: Map<string, PodImageBom> | null = null;
    if (parsed.includePodImageSbom) {
      if (!parsed.endpoint) {
        podBoms = new Map(
          parsed.resourceTypes.map((rt) => [
            rt,
            {
              marker: {
                status: "UNAVAILABLE" as const,
                message: "includePodImageSbom requires an API endpoint (sourceKey mode has no cluster to query)",
              },
            },
          ]),
        );
      } else {
        context.reportPhase("Collecting pod image SBOMs");
        try {
          const collected = await collectPodImageBoms({
            endpoint: parsed.endpoint,
            namespace: parsed.namespace,
            resourceTypes: parsed.resourceTypes,
            token: secrets.token,
            signal: context.signal,
          });
          podBoms = collected.perWorkload;
        } catch (err) {
          const status = (err as { status?: number }).status;
          const marker = {
            status:
              status === 401 || status === 403
                ? ("FORBIDDEN" as const)
                : ("UNAVAILABLE" as const),
            message: err instanceof Error ? err.message : String(err),
          };
          podBoms = new Map(parsed.resourceTypes.map((rt) => [rt, { marker }]));
        }
      }
    }

    context.reportPhase("Listing resources");
    for (const resourceType of parsed.resourceTypes) {
      if (context.signal.aborted) {
        return;
      }

      context.reportPhase(`Processing ${resourceType}`);
      const asset = buildAsset(resourceType, parsed.namespace, parsed.endpoint, identity);
      const bom = podBoms?.get(resourceType);
      if (bom) {
        if (bom.entries) asset.bomEntries = bom.entries;
        (asset.details as Record<string, unknown>).capabilities = {
          bomInventory: bom.marker,
        };
      }
      if (!validateDiscoveredAsset(asset)) {
        throw new Error(`Invalid discovered asset for resource type ${resourceType}`);
      }
      yield asset;
    }

    context.reportPhase("Completed");
  }
}
