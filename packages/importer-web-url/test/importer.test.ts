import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const uuidv7 = () => crypto.randomUUID();
import { WebUrlImporter } from "../src/importer.js";
import { webUrlConfigSchema } from "../src/config.js";
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

const checkDef = (overrides: Record<string, unknown> = {}) => ({
  checkKey: uuidv7(),
  name: "Availability",
  method: "GET",
  enabled: true,
  authMode: "NONE",
  ...overrides,
});

const instance = (overrides: Record<string, unknown> = {}) => ({
  instanceKey: uuidv7(),
  environment: "PRODUCTION",
  url: "https://example.com",
  check: checkDef(),
  ...overrides,
});

const scope = (overrides: Record<string, unknown> = {}) => ({
  sourceKey: uuidv7(),
  components: [
    {
      componentKey: uuidv7(),
      name: "Storefront",
      instances: [instance()],
    },
  ],
  ...overrides,
});

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

  it("reports collection:<sourceKey> identity and yields one asset per profile", async () => {
    const s = scope();
    const importer = new WebUrlImporter();
    const assets = [];
    const context = makeContext();

    for await (const asset of importer.run(s, {}, context)) {
      assets.push(asset);
    }

    // Stable generated collection key is the Source identity (ADR-126).
    expect(context.reportSourceIdentity).toHaveBeenCalledTimes(1);
    expect(
      (context.reportSourceIdentity as ReturnType<typeof vi.fn>).mock.calls[0][0].externalIdentity,
    ).toBe(`collection:${s.sourceKey}`);

    expect(assets).toHaveLength(1);
    const asset = assets[0];
    expect(asset.category).toBe("WEB_ENDPOINT");
    expect(asset.provider).toBe("WEB_URL");
    expect(asset.resourceType).toBe("web:url");
    expect(asset.name).toBe("Storefront");
    expect(asset.externalId).toBe(s.components[0].componentKey);
    expect(asset.instances).toHaveLength(1);
    expect(asset.instances[0].environment).toBe("PRODUCTION");
    expect(asset.instances[0].externalId).toBe(s.components[0].instances[0].instanceKey);
    expect(asset.instances[0].status).toBe("RUNNING");
    expect(validateDiscoveredAsset(asset)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com", {
        redirect: "manual",
        signal: expect.any(AbortSignal),
        headers: { "user-agent": "Componode-Discovery/1.0" },
      });
  });

  it("probes each instance independently — a failure yields ERROR, siblings continue", async () => {
    const s = scope({
      components: [
        {
          componentKey: uuidv7(),
          name: "Storefront",
          instances: [
            instance({ url: "https://down.example.com" }),
            instance({ url: "https://up.example.com" }),
          ],
        },
      ],
    });
    fetchSpy.mockImplementation((url: unknown) =>
      url === "https://down.example.com"
        ? Promise.reject(new Error("connect refused"))
        : Promise.resolve(new Response("ok", { status: 200 })),
    );

    const assets = [];
    for await (const asset of new WebUrlImporter().run(s, {}, makeContext())) {
      assets.push(asset);
    }

    expect(assets).toHaveLength(1);
    expect(assets[0].instances[0].status).toBe("ERROR");
    expect(assets[0].instances[1].status).toBe("RUNNING");
    expect(validateDiscoveredAsset(assets[0])).toBe(true);
  });

  it("records non-2xx responses as ERROR with the status code", async () => {
    fetchSpy.mockResolvedValue(new Response("not found", { status: 404 }));
    const assets = [];
    for await (const asset of new WebUrlImporter().run(scope(), {}, makeContext())) {
      assets.push(asset);
    }
    expect(assets[0].instances[0].status).toBe("ERROR");
    expect(validateDiscoveredAsset(assets[0])).toBe(true);
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
      for await (const _asset of importer.run(
        scope({ components: [{ componentKey: uuidv7(), name: "x", instances: [instance({ url })] }] }),
        {},
        makeContext(),
      )) {
        // never reached
      }
    }).rejects.toThrow(/not allowed/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects authenticated checks — web endpoints carry no auth", () => {
    const bad = scope({
      components: [
        {
          componentKey: uuidv7(),
          name: "x",
          instances: [instance({ check: checkDef({ authMode: "BASIC", credentialId: uuidv7() }) })],
        },
      ],
    });
    const result = webUrlConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
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
      for await (const asset of importer.run(scope(), {}, makeContext())) {
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
