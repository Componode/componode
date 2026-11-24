import { buildLibraryAsset, canonicalizeSourceIdentity, dependsOnRels, indexBomEntries, qualifyExternalId, slugify, SPDX_EDGE_SUBJECT, validateDiscoveredAsset, type DiscoveredAsset, type DiscoveredBomEntry, type Importer, type ImporterContext, type SpdxEdge } from "@componode/core";
import { kubernetesConfigSchema } from "./config.js";
import { collectPodImageBoms, type PodImageBom } from "./k8s-pods.js";

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
  readonly version = "1.1.0";

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

    // Spec 079 / ADR-133 — declared-edge carrier 4. Run-level library
    // maps fed during the workload loop and drained after it so each
    // once-per-identity LIBRARY yield carries the run-wide edge union
    // (docker T013 shape).
    const libraryEntries = new Map<string, DiscoveredBomEntry>();
    const libraryEdges = new Map<string, SpdxEdge>();

    context.reportPhase("Listing resources");
    for (const resourceType of parsed.resourceTypes) {
      if (context.signal.aborted) {
        return;
      }

      context.reportPhase(`Processing ${resourceType}`);
      const asset = buildAsset(resourceType, parsed.namespace, parsed.endpoint, identity);
      const bom = podBoms?.get(resourceType);
      if (bom) {
        if (bom.entries) {
          asset.bomEntries = bom.entries;
          if (parsed.importDeclaredEdges) {
            // `relationships` present (possibly []) exactly when bomEntries
            // is — field presence is the edge pass's authority signal.
            // Source-position SUBJECT → this workload; target-side SUBJECT
            // already resolved to docker-image:{digestRef} at collection.
            asset.relationships = dependsOnRels(
              (bom.edges ?? []).map((e) => ({
                from: e.from === SPDX_EDGE_SUBJECT ? asset.externalId : e.from,
                to: e.to,
              })),
              asset.externalId,
            );
            for (const [purlIdentity, entry] of indexBomEntries(bom.entries)) {
              if (!libraryEntries.has(purlIdentity)) libraryEntries.set(purlIdentity, entry);
            }
            for (const e of bom.edges ?? []) {
              const key = `${e.from} ${e.to}`;
              if (!libraryEdges.has(key)) libraryEdges.set(key, e);
            }
          }
        }
        (asset.details as Record<string, unknown>).capabilities = {
          bomInventory: bom.marker,
        };
      }
      if (!validateDiscoveredAsset(asset)) {
        throw new Error(`Invalid discovered asset for resource type ${resourceType}`);
      }
      yield asset;
    }

    // Libraries drain here — after every bom-bearing carrier — so each
    // per-identity yield carries the run-wide edge union.
    if (parsed.importDeclaredEdges) {
      const allEdges = [...libraryEdges.values()];
      for (const [purlIdentity, entry] of libraryEntries) {
        if (context.signal.aborted) return;
        const lib = buildLibraryAsset(
          purlIdentity,
          entry,
          dependsOnRels(allEdges, purlIdentity),
        );
        if (!validateDiscoveredAsset(lib)) {
          throw new Error(`Invalid library asset for ${identity}`);
        }
        yield lib;
      }
    }

    context.reportPhase("Completed");
  }
}
