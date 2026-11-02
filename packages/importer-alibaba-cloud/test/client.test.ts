import { describe, it, expect } from "vitest";
import { buildClientOpts, buildClients, buildSdkConfig, sdkCtor } from "../src/client.js";
import { alibabaCloudConfigSchema } from "../src/config.js";
import { makeSecrets } from "./client-mock.js";

class FakeClient {
  constructor(public config: unknown) {}
}

describe("sdkCtor — CJS/ESM interop", () => {
  it("resolves the constructor from an __esModule CJS namespace", () => {
    const ns = { __esModule: true, default: FakeClient };
    const ctor = sdkCtor(ns);
    expect(ctor).toBe(FakeClient);
    expect(new ctor({})).toBeInstanceOf(FakeClient);
  });

  it("unwraps a doubly-nested default (Node ESM namespace over CJS)", () => {
    // import * as NS over CJS: NS.default === module.exports, and
    // module.exports.default === Client — one unwrap is not enough.
    const ns = { default: { __esModule: true, default: FakeClient } };
    const ctor = sdkCtor(ns);
    expect(ctor).toBe(FakeClient);
    expect(new ctor({})).toBeInstanceOf(FakeClient);
  });

  it("resolves a bare constructor to itself", () => {
    expect(sdkCtor(FakeClient)).toBe(FakeClient);
    expect(new (sdkCtor(FakeClient))({})).toBeInstanceOf(FakeClient);
  });
});

describe("buildClients", () => {
  it("constructs all three SDK clients — no 'is not a constructor'", () => {
    const clients = buildClients(makeSecrets(), alibabaCloudConfigSchema.parse({}));
    for (const method of [
      "getCallerIdentity",
      "getServiceStatus",
      "getResourceCounts",
      "searchResourcesPage",
      "getResourceConfiguration",
      "describeInstanceBillPage",
    ] as const) {
      expect(typeof clients[method]).toBe("function");
    }
  });
});

describe("buildClientOpts", () => {
  it("pins regionId on all three clients when region is set", () => {
    const opts = buildClientOpts(alibabaCloudConfigSchema.parse({ region: "cn-hangzhou" }));
    expect(opts.rc.regionId).toBe("cn-hangzhou");
    expect(opts.sts.regionId).toBe("cn-hangzhou");
    expect(opts.bss.regionId).toBe("cn-hangzhou");
  });

  it("gives each client its own endpoint — explicit endpoint wins over region", () => {
    const opts = buildClientOpts(
      alibabaCloudConfigSchema.parse({
        region: "cn-hangzhou",
        endpoint: "https://rc-mock",
        stsEndpoint: "https://sts-mock",
        bssEndpoint: "https://bss-mock",
      }),
    );
    expect(opts.rc.endpoint).toBe("https://rc-mock");
    expect(opts.sts.endpoint).toBe("https://sts-mock");
    expect(opts.bss.endpoint).toBe("https://bss-mock");
  });

  it("falls back to documented global endpoints for STS/BSS when nothing is configured", () => {
    const opts = buildClientOpts(alibabaCloudConfigSchema.parse({}));
    expect(opts.rc.endpoint).toBeUndefined();
    expect(opts.rc.regionId).toBeUndefined();
    expect(opts.sts.endpoint).toBe("sts.aliyuncs.com");
    expect(opts.sts.regionId).toBeUndefined();
    expect(opts.bss.endpoint).toBe("business.aliyuncs.com");
    expect(opts.bss.regionId).toBeUndefined();
  });
});

describe("buildSdkConfig", () => {
  it("sets regionId when provided", () => {
    const cfg = buildSdkConfig(makeSecrets(), { regionId: "cn-hangzhou" });
    expect(cfg.regionId).toBe("cn-hangzhou");
  });

  it("normalizes a URL endpoint to host[:port] + protocol", () => {
    const cfg = buildSdkConfig(makeSecrets(), { endpoint: "https://mock-alibaba:9443" });
    expect(cfg.endpoint).toBe("mock-alibaba:9443");
    expect(cfg.protocol).toBe("https");
  });

  it("passes a bare host endpoint through untouched", () => {
    const cfg = buildSdkConfig(makeSecrets(), { endpoint: "sts.aliyuncs.com" });
    expect(cfg.endpoint).toBe("sts.aliyuncs.com");
    expect(cfg.protocol).toBeUndefined();
  });

  it("sets both endpoint and regionId when provided — endpoint wins at runtime", () => {
    const cfg = buildSdkConfig(makeSecrets(), {
      endpoint: "https://mock-alibaba:9443",
      regionId: "cn-hangzhou",
    });
    expect(cfg.endpoint).toBe("mock-alibaba:9443");
    expect(cfg.regionId).toBe("cn-hangzhou");
  });

  it("omits regionId and endpoint when not provided", () => {
    const cfg = buildSdkConfig(makeSecrets(), {});
    expect(cfg.regionId).toBeUndefined();
    expect(cfg.endpoint).toBeUndefined();
  });

  it("maps secrets onto the config unchanged", () => {
    const cfg = buildSdkConfig(
      { accessKeyId: "AKIDTEST", accessKeySecret: "SECRETTEST", securityToken: "TOKEN" },
      {},
    );
    expect(cfg.accessKeyId).toBe("AKIDTEST");
    expect(cfg.accessKeySecret).toBe("SECRETTEST");
    expect(cfg.securityToken).toBe("TOKEN");
  });
});
