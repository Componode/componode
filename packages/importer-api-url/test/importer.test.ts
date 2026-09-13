import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiUrlImporter } from "../src/importer.js";
import { validateDiscoveredAsset, NOOP_LOGGER, type ImporterContext } from "@componode/core";

function makeContext(): ImporterContext {
  return {
    runId: "run-1",
    logger: NOOP_LOGGER,
    signal: new AbortController().signal,
    reportPhase: vi.fn(),
  };
}

describe("ApiUrlImporter", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("yields a DiscoveredAsset with a PRODUCTION instance", async () => {
    const importer = new ApiUrlImporter();
    const assets = [];

    for await (const asset of importer.run({ url: "https://api.example.com/health" }, {}, makeContext())) {
      assets.push(asset);
    }

    expect(assets).toHaveLength(1);
    expect(assets[0].provider).toBe("API_URL");
    expect(assets[0].resourceType).toBe("api:url");
    expect(assets[0].instances).toHaveLength(1);
    expect(assets[0].instances[0].environment).toBe("PRODUCTION");
    expect(assets[0].instances[0].status).toBe("RUNNING");
    expect(validateDiscoveredAsset(assets[0])).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("https://api.example.com/health", { signal: expect.any(AbortSignal) });
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
    const importer = new ApiUrlImporter();
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
      const importer = new ApiUrlImporter();
      const assets = [];
      for await (const asset of importer.run({ url: "https://api.example.com/health" }, {}, makeContext())) {
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
