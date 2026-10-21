import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateDiscoveredAsset, type DiscoveredAsset } from "@componode/core";
import { AlibabaCloudImporter } from "../src/importer.js";
import { buildClients } from "../src/client.js";
import { makeClients, makeContext, makeSearchRecord, makeSecrets } from "./client-mock.js";

vi.mock("../src/client.js", () => ({
  buildClients: vi.fn(),
}));

const mockBuildClients = vi.mocked(buildClients);

async function collect(
  importer: AlibabaCloudImporter,
  config: Record<string, unknown>,
  context = makeContext(),
): Promise<DiscoveredAsset[]> {
  const assets: DiscoveredAsset[] = [];
  for await (const asset of importer.run(config, makeSecrets(), context)) {
    assets.push(asset);
  }
  return assets;
}

beforeEach(() => {
  mockBuildClients.mockReset();
});

describe("AlibabaCloudImporter — US1 discovery", () => {
  it("yields valid assets: one per mapped record + account last", async () => {
    const clients = makeClients({
      searchResourcesPage: vi.fn(async () => ({
        resources: [makeSearchRecord(), makeSearchRecord({
          resourceId: "bucket-12345",
          resourceName: "logs-bucket",
          resourceType: "ACS::OSS::Bucket",
          zoneId: undefined,
        })],
      })),
      getResourceCounts: vi.fn(async () => [
        { groupName: "ACS::ECS::Instance", count: 1 },
        { groupName: "ACS::OSS::Bucket", count: 1 },
      ]),
    });
    mockBuildClients.mockReturnValue(clients);

    const assets = await collect(new AlibabaCloudImporter(), {});

    expect(assets).toHaveLength(3);
    for (const asset of assets) {
      expect(validateDiscoveredAsset(asset)).toBe(true);
      expect(asset.provider).toBe("ALIBABA_CLOUD");
    }

    const [ecs, oss, account] = assets;
    expect(ecs.category).toBe("COMPUTE");
    expect(ecs.externalId).toBe("ACS::ECS::Instance:i-bp1234567890abcdef");
    expect(ecs.instances[0].region).toBe("cn-hangzhou");
    expect(ecs.instances[0].environment).toBe("PRODUCTION");

    expect(oss.category).toBe("STORAGE");

    expect(account.category).toBe("ACCOUNT");
    expect(account.externalId).toBe("1234567890123456");
    const details = account.details as Record<string, any>;
    expect(details.coverage).toMatchObject({
      discoveredCount: 2,
      mappedCount: 2,
      skippedCount: 0,
      skippedTypes: [],
    });
    expect(details.coverage.totals["ACS::ECS::Instance"]).toBe(1);
    expect(clients.getCallerIdentity).toHaveBeenCalled();
  });

  it("fails fast before any yield when Resource Center is disabled", async () => {
    mockBuildClients.mockReturnValue(makeClients({
      getServiceStatus: vi.fn(async () => ({ serviceStatus: "Disabled" })),
      searchResourcesPage: vi.fn(async () => ({ resources: [makeSearchRecord()] })),
    }));

    await expect(collect(new AlibabaCloudImporter(), {})).rejects.toThrow(
      /Resource Center is not enabled/,
    );
  });

  it("propagates authentication failure from identity call", async () => {
    mockBuildClients.mockReturnValue(makeClients({
      getCallerIdentity: vi.fn(async () => {
        throw Object.assign(new Error("denied"), { code: "InvalidAccessKeyId" });
      }),
    }));

    await expect(collect(new AlibabaCloudImporter(), {})).rejects.toThrow("denied");
  });

  it("stops promptly when aborted mid-pagination", async () => {
    const controller = new AbortController();
    mockBuildClients.mockReturnValue(makeClients({
      searchResourcesPage: vi.fn(async () => {
        controller.abort();
        return { resources: [makeSearchRecord()], nextToken: "t2" };
      }),
    }));

    const assets = await collect(
      new AlibabaCloudImporter(),
      {},
      makeContext({ signal: controller.signal }),
    );
    expect(assets).toHaveLength(0);
  });

  it("retries throttled searches with backoff, then gives up", async () => {
    const throttle = Object.assign(new Error("slow down"), { code: "Throttling" });
    const search = vi
      .fn()
      .mockRejectedValueOnce(throttle)
      .mockResolvedValueOnce({ resources: [makeSearchRecord()] });
    mockBuildClients.mockReturnValue(makeClients({ searchResourcesPage: search }));

    const assets = await collect(new AlibabaCloudImporter(), {});
    expect(search).toHaveBeenCalledTimes(2);
    expect(assets.length).toBeGreaterThan(0);

    const alwaysThrottle = vi.fn().mockRejectedValue(throttle);
    mockBuildClients.mockReturnValue(makeClients({ searchResourcesPage: alwaysThrottle }));
    await expect(collect(new AlibabaCloudImporter(), {})).rejects.toThrow("slow down");
    expect(alwaysThrottle).toHaveBeenCalledTimes(4);
  });

  it("never reads process.env and yields no relationships", async () => {
    const envSpy = vi.fn();
    const original = process.env;
    process.env = new Proxy(original, {
      get(target, prop) {
        envSpy(prop);
        return target[prop as string];
      },
    });
    try {
      mockBuildClients.mockReturnValue(makeClients({
        searchResourcesPage: vi.fn(async () => ({ resources: [makeSearchRecord()] })),
      }));
      const assets = await collect(new AlibabaCloudImporter(), {});
      for (const asset of assets) {
        expect(asset).not.toHaveProperty("relationships");
      }
    } finally {
      process.env = original;
    }
    expect(envSpy).not.toHaveBeenCalled();
  });

  it("skips unmapped types with warn + coverage, never fails", async () => {
    const context = makeContext();
    mockBuildClients.mockReturnValue(makeClients({
      searchResourcesPage: vi.fn(async () => ({
        resources: [
          makeSearchRecord(),
          makeSearchRecord({ resourceType: "ACS::Foo::Bar", resourceId: "foo-1" }),
          makeSearchRecord({ resourceType: "ACS::Foo::Bar", resourceId: "foo-2" }),
        ],
      })),
    }));

    const assets = await collect(new AlibabaCloudImporter(), {}, context);
    expect(assets).toHaveLength(2); // 1 mapped + account
    const account = assets[1].details as Record<string, any>;
    expect(account.coverage.skippedCount).toBe(1);
    expect(account.coverage.skippedTypes).toEqual(["ACS::Foo::Bar"]);
    expect(account.coverage.discoveredCount).toBe(3);
    expect(context.logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("AlibabaCloudImporter — US3 filters", () => {
  it("maps config fields to SearchResources request", async () => {
    const search = vi.fn(async () => ({ resources: [] }));
    mockBuildClients.mockReturnValue(makeClients({ searchResourcesPage: search }));

    await collect(new AlibabaCloudImporter(), {
      regionIds: ["cn-hangzhou", "cn-shanghai"],
      resourceTypes: ["ACS::OSS::Bucket"],
      resourceGroupId: "rg-abc123",
    });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: [
          { key: "RegionId", matchType: "Equals", value: ["cn-hangzhou", "cn-shanghai"] },
          { key: "ResourceType", matchType: "Equals", value: ["ACS::OSS::Bucket"] },
        ],
        resourceGroupId: "rg-abc123",
      }),
    );
  });

  it("sends no filter fields when config is empty", async () => {
    const search = vi.fn(async () => ({ resources: [] }));
    mockBuildClients.mockReturnValue(makeClients({ searchResourcesPage: search }));
    await collect(new AlibabaCloudImporter(), {});
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ filter: undefined, resourceGroupId: undefined }),
    );
  });
});

describe("AlibabaCloudImporter — US4 coverage", () => {
  it("records a capability marker when GetResourceCounts fails", async () => {
    mockBuildClients.mockReturnValue(makeClients({
      getResourceCounts: vi.fn(async () => {
        throw Object.assign(new Error("nope"), { statusCode: 403 });
      }),
    }));

    const assets = await collect(new AlibabaCloudImporter(), {});
    const account = assets[0].details as Record<string, any>;
    expect(account.capabilities.resourceCounts.status).toBe("FORBIDDEN");
    expect(account.coverage.totals).toBeUndefined();
  });
});

describe("AlibabaCloudImporter — US5 enrichment", () => {
  it("enriches instances with configuration + mapped status when enabled", async () => {
    const getConfig = vi.fn(async () => ({
      configuration: { Status: "Running", Cpu: 4 },
    }));
    mockBuildClients.mockReturnValue(makeClients({
      searchResourcesPage: vi.fn(async () => ({ resources: [makeSearchRecord()] })),
      getResourceConfiguration: getConfig,
    }));

    const [asset] = await collect(new AlibabaCloudImporter(), { enrichResources: true });
    expect(getConfig).toHaveBeenCalledWith({
      resourceType: "ACS::ECS::Instance",
      resourceId: "i-bp1234567890abcdef",
      resourceRegionId: "cn-hangzhou",
    });
    expect(asset.instances[0].status).toBe("RUNNING");
    expect((asset.instances[0].rawConfig as any).Cpu).toBe(4);
  });

  it("degrades per-resource on enrichment failure without failing the run", async () => {
    mockBuildClients.mockReturnValue(makeClients({
      searchResourcesPage: vi.fn(async () => ({ resources: [makeSearchRecord()] })),
      getResourceConfiguration: vi.fn(async () => {
        throw Object.assign(new Error("denied"), { statusCode: 403 });
      }),
    }));

    const [asset] = await collect(new AlibabaCloudImporter(), { enrichResources: true });
    const details = asset.details as Record<string, any>;
    expect(details.capabilities.enrichment.status).toBe("FORBIDDEN");
    expect(asset.instances[0].status).toBeNull();
  });

  it("makes zero enrichment calls when disabled", async () => {
    const getConfig = vi.fn();
    mockBuildClients.mockReturnValue(makeClients({
      searchResourcesPage: vi.fn(async () => ({ resources: [makeSearchRecord()] })),
      getResourceConfiguration: getConfig,
    }));
    await collect(new AlibabaCloudImporter(), {});
    expect(getConfig).not.toHaveBeenCalled();
  });
});

describe("AlibabaCloudImporter — US6 costs", () => {
  it("attaches per-resource billing to component details", async () => {
    const bill = vi.fn(async () => ({
      items: [
        {
          instanceID: "i-bp1234567890abcdef",
          pretaxAmount: 12.5,
          pretaxGrossAmount: 15,
          currency: "USD",
          productName: "ECS",
        },
      ],
    }));
    mockBuildClients.mockReturnValue(makeClients({
      searchResourcesPage: vi.fn(async () => ({ resources: [makeSearchRecord()] })),
      describeInstanceBillPage: bill,
    }));

    const [asset] = await collect(new AlibabaCloudImporter(), {
      includeCosts: true,
      billingPeriod: "2026-09",
    });
    expect(bill).toHaveBeenCalledWith(
      expect.objectContaining({ billingCycle: "2026-09" }),
    );
    const details = asset.details as Record<string, any>;
    expect(details.billing.pretaxAmount).toBe(12.5);
    expect(details.billing.currency).toBe("USD");
  });

  it("degrades to FORBIDDEN marker when billing is denied", async () => {
    mockBuildClients.mockReturnValue(makeClients({
      searchResourcesPage: vi.fn(async () => ({ resources: [makeSearchRecord()] })),
      describeInstanceBillPage: vi.fn(async () => {
        throw Object.assign(new Error("denied"), { statusCode: 403 });
      }),
    }));

    const assets = await collect(new AlibabaCloudImporter(), { includeCosts: true });
    const account = assets[assets.length - 1].details as Record<string, any>;
    expect(account.capabilities.costs.status).toBe("FORBIDDEN");
    const resource = assets[0].details as Record<string, any>;
    expect(resource.billing).toBeUndefined();
  });

  it("rejects malformed billingPeriod at config validation", async () => {
    await expect(
      collect(new AlibabaCloudImporter(), { includeCosts: true, billingPeriod: "2026-13" }),
    ).rejects.toThrow();
    await expect(
      collect(new AlibabaCloudImporter(), { includeCosts: true, billingPeriod: "202609" }),
    ).rejects.toThrow();
  });
});
