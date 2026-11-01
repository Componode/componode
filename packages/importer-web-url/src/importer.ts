import { canonicalizeSourceIdentity, validateDiscoveredAsset, type DiscoveredAsset, type Importer, type ImporterContext } from "@componode/core";
import { webUrlConfigSchema } from "./config.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class WebUrlImporter implements Importer {
  readonly name = "web-url";
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
    const parsed = webUrlConfigSchema.parse(config);
    const identity = canonicalizeSourceIdentity(parsed.url);
    await context.reportSourceIdentity({
      externalIdentity: identity,
      label: identity,
    });

    context.reportPhase(`Probing ${parsed.url}`);
    const doFetch = (globalThis as unknown as { fetch: (...args: unknown[]) => Promise<unknown> }).fetch;
    const response = (await doFetch(parsed.url, { signal: context.signal })) as {
      ok: boolean;
      status: number;
      text: () => Promise<string>;
    };

    if (context.signal.aborted) {
      return;
    }

    const body = await response.text();

    context.reportPhase("Building asset");
    const status = response.ok ? "RUNNING" : "ERROR";

    const asset: DiscoveredAsset = {
      category: "WEB_ENDPOINT",
      provider: "WEB_URL",
      resourceType: "web:url",
      name: parsed.url,
      externalId: identity,
      slug: slugify(parsed.url),
      details: {
        statusCode: response.status,
        bodyPreview: body.slice(0, 200),
      },
      instances: [
        {
          environment: "PRODUCTION",
          externalId: identity,
          url: parsed.url,
          status,
          version: "1.0.0",
          deployedAt: new Date().toISOString(),
          rawConfig: { url: parsed.url },
        },
      ],
    };
    if (!validateDiscoveredAsset(asset)) {
      throw new Error(`Invalid discovered asset for ${parsed.url}`);
    }
    yield asset;

    context.reportPhase("Completed");
  }
}
