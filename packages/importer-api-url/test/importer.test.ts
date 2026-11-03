import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const uuidv7 = () => crypto.randomUUID();
import { ApiUrlImporter } from "../src/importer.js";
import { apiUrlConfigSchema } from "../src/config.js";
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
  url: "https://api.example.com/status",
  check: checkDef(),
  ...overrides,
});

const scope = (overrides: Record<string, unknown> = {}) => ({
  sourceKey: uuidv7(),
  components: [
    {
      componentKey: uuidv7(),
      name: "Payments API",
      instances: [instance()],
    },
  ],
  ...overrides,
});

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

  it("reports collection:<sourceKey> identity and yields one asset per profile", async () => {
    const s = scope();
    const assets = [];
    const context = makeContext();

    for await (const asset of new ApiUrlImporter().run(s, {}, context)) {
      assets.push(asset);
    }

    expect(context.reportSourceIdentity).toHaveBeenCalledTimes(1);
    expect(
      (context.reportSourceIdentity as ReturnType<typeof vi.fn>).mock.calls[0][0].externalIdentity,
    ).toBe(`collection:${s.sourceKey}`);

    expect(assets).toHaveLength(1);
    const asset = assets[0];
    expect(asset.category).toBe("API");
    expect(asset.provider).toBe("API_URL");
    expect(asset.resourceType).toBe("api:url");
    expect(asset.name).toBe("Payments API");
    expect(asset.externalId).toBe(s.components[0].componentKey);
    expect(asset.instances[0].externalId).toBe(s.components[0].instances[0].instanceKey);
    expect(asset.instances[0].status).toBe("RUNNING");
    expect(validateDiscoveredAsset(asset)).toBe(true);
  });

  it("probes each instance independently — transport errors yield ERROR, siblings continue", async () => {
    const s = scope({
      components: [
        {
          componentKey: uuidv7(),
          name: "Payments API",
          instances: [
            instance({ url: "https://down.example.com" }),
            instance({ url: "https://up.example.com" }),
          ],
        },
      ],
    });
    fetchSpy.mockImplementation((url: unknown) =>
      url === "https://down.example.com"
        ? Promise.reject(new Error("timeout"))
        : Promise.resolve(new Response("{}", { status: 200 })),
    );

    const assets = [];
    for await (const asset of new ApiUrlImporter().run(s, {}, makeContext())) {
      assets.push(asset);
    }

    expect(assets[0].instances[0].status).toBe("ERROR");
    expect(assets[0].instances[1].status).toBe("RUNNING");
    expect(validateDiscoveredAsset(assets[0])).toBe(true);
  });

  it("accepts authenticated check definitions on API endpoints", () => {
    const s = scope({
      components: [
        {
          componentKey: uuidv7(),
          name: "x",
          instances: [
            instance({
              check: checkDef({
                authMode: "BASIC",
                credentialId: uuidv7(),
                authConfig: { usernameKey: "user", passwordKey: "pass" },
              }),
            }),
          ],
        },
      ],
    });
    const result = apiUrlConfigSchema.safeParse(s);
    expect(result.success).toBe(true);
  });

  it("requires a credentialId for non-NONE auth modes", () => {
    const s = scope({
      components: [
        {
          componentKey: uuidv7(),
          name: "x",
          instances: [instance({ check: checkDef({ authMode: "BEARER" }) })],
        },
      ],
    });
    expect(apiUrlConfigSchema.safeParse(s).success).toBe(false);
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
      for await (const asset of importer.run(scope(), {}, makeContext())) {
        assets.push(asset);
      }
      expect(envSpy).not.toHaveBeenCalled();
      for (const asset of assets) {
        expect(asset).not.toHaveProperty("relationships");
      }
    } finally {
      process.env = original;
    }
  });
});
