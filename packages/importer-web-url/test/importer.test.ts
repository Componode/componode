import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebUrlImporter } from "../src/importer.js";
import { validateDiscoveredAsset, NOOP_LOGGER, type ImporterContext } from "@componode/core";

function makeContext(): ImporterContext {
  return {
    runId: "run-1",
    logger: NOOP_LOGGER,
    signal: new AbortController().signal,
    reportPhase: vi.fn(),
  };
}

describe("WebUrlImporter", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("yields a DiscoveredAsset with a PRODUCTION instance", async () => {
    const importer = new WebUrlImporter();
    const assets = [];

    for await (const asset of importer.run({ url: "https://example.com" }, {}, makeContext())) {
      assets.push(asset);
    }

    expect(assets).toHaveLength(1);
    expect(assets[0].provider).toBe("WEB_URL");
    expect(assets[0].resourceType).toBe("web:url");
    expect(assets[0].instances).toHaveLength(1);
    expect(assets[0].instances[0].environment).toBe("PRODUCTION");
    expect(assets[0].instances[0].status).toBe("RUNNING");
    expect(validateDiscoveredAsset(assets[0])).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com", { signal: expect.any(AbortSignal) });
  });

  it.each([
    "http://localhost/",
    "http://127.0.0.1/admin",
    "http://10.0.0.1/internal",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "ftp://example.com/",
  ])("refuses internal/unsafe URL %s without fetching", async (url) => {
    const importer = new WebUrlImporter();
    await expect(async () => {
      for await (const _asset of importer.run({ url }, {}, makeContext())) {
        // never reached
      }
    }).rejects.toThrow(/not allowed/);
    expect(fetchSpy).not.toHaveBeenCalled();
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
      const importer = new WebUrlImporter();
      const assets = [];
      for await (const asset of importer.run({ url: "https://example.com" }, {}, makeContext())) {
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
