import { probeEndpoint, validateDiscoveredAsset, type DiscoveredAsset, type DiscoveredAssetInstance, type Importer, type ImporterContext } from "@componode/core";
import { webUrlConfigSchema, type WebUrlConfig } from "./config.js";

// One one-shot discovery request per configured instance (spec 058): the
// result seeds the initial ComponentInstance status until its managed URL
// Check's first observation. An endpoint-level failure yields an ERROR
// instance — sibling rows continue.
async function probeInstance(
  instance: WebUrlConfig["components"][number]["instances"][number],
  signal: AbortSignal,
): Promise<DiscoveredAssetInstance> {
  const base: DiscoveredAssetInstance = {
    environment: instance.environment,
    externalId: instance.instanceKey,
    url: instance.url,
    region: instance.region ?? null,
    version: instance.version ?? null,
    deployedAt: null,
    rawConfig: { url: instance.url },
  };
  try {
    const response = await probeEndpoint(instance.url, signal);
    const body = await response.text();
    return {
      ...base,
      status: response.ok ? "RUNNING" : "ERROR",
      rawConfig: {
        url: instance.url,
        statusCode: response.status,
        bodyPreview: body.slice(0, 200),
      },
    };
  } catch (err) {
    if (signal.aborted) throw err;
    return {
      ...base,
      status: "ERROR",
      rawConfig: {
        url: instance.url,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export class WebUrlImporter implements Importer {
  readonly name = "web-url";
  readonly version = "2.0.0";

  async *run(
    config: Record<string, unknown>,
    _secrets: Record<string, string>,
    context: ImporterContext,
  ): AsyncGenerator<DiscoveredAsset> {
    if (context.signal.aborted) {
      return;
    }

    context.reportPhase("Initializing");
    const parsed = webUrlConfigSchema.parse(config);
    // The generated collection key — never a URL set or label — is the
    // durable Source identity (ADR-126, ADR-119 A2). Reported before the
    // first yield, including an empty inventory.
    await context.reportSourceIdentity({
      externalIdentity: `collection:${parsed.sourceKey}`,
    });

    for (const profile of parsed.components) {
      if (context.signal.aborted) {
        return;
      }
      context.reportPhase(`Probing ${profile.name}`);
      const instances: DiscoveredAssetInstance[] = [];
      for (const instance of profile.instances) {
        instances.push(await probeInstance(instance, context.signal));
      }
      const asset: DiscoveredAsset = {
        category: "WEB_ENDPOINT",
        provider: "WEB_URL",
        resourceType: "web:url",
        name: profile.name,
        externalId: profile.componentKey,
        details: {
          componentKey: profile.componentKey,
          instanceCount: instances.length,
        },
        instances,
      };
      if (!validateDiscoveredAsset(asset)) {
        throw new Error(`Invalid discovered asset for ${profile.name}`);
      }
      yield asset;
    }

    context.reportPhase("Completed");
  }
}
