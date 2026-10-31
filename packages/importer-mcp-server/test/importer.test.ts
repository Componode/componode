import { describe, it, expect, vi } from "vitest";
import { McpServerImporter } from "../src/importer.js";
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

describe("McpServerImporter", () => {
  it("yields a DiscoveredAsset with a PRODUCTION instance", async () => {
    const importer = new McpServerImporter();
    const assets = [];
    const context = makeContext();

    for await (const asset of importer.run(
      { resourceTypes: ["tools/list"], endpoint: "https://mcp.example.com/sse" },
      {},
      context,
    )) {
      assets.push(asset);
    }

    // Canonical endpoint is the source identity; externalId qualified.
    expect(context.reportSourceIdentity).toHaveBeenCalledTimes(1);
    const reported = (context.reportSourceIdentity as ReturnType<typeof vi.fn>).mock.calls[0][0].externalIdentity;
    expect(reported).toContain("mcp.example.com/sse");
    expect(assets).toHaveLength(1);
    expect(assets[0].externalId).toBe(`${reported}::tools/list`);
    expect(assets[0].provider).toBe("MCP_SERVER");
    expect(assets[0].resourceType).toBe("tools/list");
    expect(assets[0].category).toBe("MCP_SERVER");
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
      const importer = new McpServerImporter();
      const assets = [];
      for await (const asset of importer.run(
        { resourceTypes: ["tools/list"], endpoint: "https://mcp.example.com/sse" },
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
