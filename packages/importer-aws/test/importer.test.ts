import { describe, it, expect, vi } from "vitest";
import { AwsImporter } from "../src/importer.js";
import { validateDiscoveredAsset, NOOP_LOGGER, type ImporterContext } from "@componode/core";

function makeContext(): ImporterContext {
  return {
    runId: "run-1",
    logger: NOOP_LOGGER,
    signal: new AbortController().signal,
    reportPhase: vi.fn(),
    reportSourceIdentity: vi.fn(),
    resolveTarget: vi.fn(),
  };
}

describe("AwsImporter", () => {
  it("yields a DiscoveredAsset with a PRODUCTION instance", async () => {
    const importer = new AwsImporter();
    const assets = [];

    for await (const asset of importer.run(
      { region: "us-east-1", resourceTypes: ["ec2:instance"] },
      {},
      makeContext(),
    )) {
      assets.push(asset);
    }

    expect(assets).toHaveLength(1);
    expect(assets[0].provider).toBe("AWS");
    expect(assets[0].resourceType).toBe("ec2:instance");
    expect(assets[0].instances).toHaveLength(1);
    expect(assets[0].instances[0].environment).toBe("PRODUCTION");
    expect(validateDiscoveredAsset(assets[0])).toBe(true);
  });

  it("does not access process.env and yields no component-to-component edges", async () => {
    const envSpy = vi.fn();
    const original = process.env;
    process.env = new Proxy(original, {
      get(target, prop) {
        envSpy(prop);
        return target[prop as string];
      },
    });
    try {
      const importer = new AwsImporter();
      const assets = [];
      for await (const asset of importer.run(
        { region: "us-east-1", resourceTypes: ["ec2:instance"] },
        {},
        makeContext(),
      )) {
        assets.push(asset);
      }
      expect(envSpy).not.toHaveBeenCalled();
      for (const asset of assets) {
        expect(asset).not.toHaveProperty("relationships");
      }
      const serialized = JSON.stringify(assets).toUpperCase();
      expect(serialized).not.toContain("DEPENDS_ON");
      expect(serialized).not.toContain("SOURCES_FROM");
      expect(serialized).not.toContain("EXPOSES");
    } finally {
      process.env = original;
    }
  });
});
