import type { DiscoveredAsset, Importer, ImporterContext } from "@componode/core";
import { sbomFileConfigSchema } from "./config.js";

export class SbomFileImporter implements Importer {
  readonly name = "sbom-file";
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
    const parsed = sbomFileConfigSchema.parse(config);
    const resolved = parsed.resolvedComponent;
    if (!resolved) {
      throw new Error(
        "sbom-file: no resolved component identity in scope — componentSlug could not be resolved at dispatch",
      );
    }

    await context.reportSourceIdentity({
      externalIdentity: `sbom-file:${parsed.sbomUrl}`,
      label: `SBOM file ${parsed.sbomUrl}`,
    });

    // Phase 5 (spec 073 US3): fetch parsed.sbomUrl, auto-detect CycloneDX vs
    // SPDX, parse to DiscoveredBomEntry tree, yield the asset with
    // `bomEntries`. Stub yields the component so targeting is exercisable.
    yield {
      category: resolved.category,
      provider: resolved.provider,
      resourceType: "sbom:document",
      name: resolved.name,
      externalId: resolved.externalId,
      slug: resolved.slug,
      instances: [],
      bomEntries: [],
    };
  }
}
