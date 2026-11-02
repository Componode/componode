import { describe, it, expect } from "vitest";
import { alibabaCloudConfigSchema } from "../src/config.js";

describe("alibabaCloudConfigSchema — region & per-service endpoints", () => {
  it("accepts region, stsEndpoint, and bssEndpoint", () => {
    const cfg = alibabaCloudConfigSchema.parse({
      region: "cn-hangzhou",
      stsEndpoint: "https://mock-alibaba",
      bssEndpoint: "https://mock-alibaba",
    });
    expect(cfg.region).toBe("cn-hangzhou");
    expect(cfg.stsEndpoint).toBe("https://mock-alibaba");
    expect(cfg.bssEndpoint).toBe("https://mock-alibaba");
  });

  it("rejects private-IP, metadata, and localhost endpoint overrides", () => {
    for (const field of ["endpoint", "stsEndpoint", "bssEndpoint"]) {
      for (const url of [
        "http://169.254.169.254/latest/meta-data",
        "http://10.0.0.1/",
        "http://localhost:8080/",
      ]) {
        expect(() => alibabaCloudConfigSchema.parse({ [field]: url })).toThrow();
      }
    }
  });

  it("rejects a non-URL stsEndpoint", () => {
    expect(() => alibabaCloudConfigSchema.parse({ stsEndpoint: "not-a-url" })).toThrow();
  });

  it("stays strict on unknown keys", () => {
    expect(() => alibabaCloudConfigSchema.parse({ unknownField: 1 })).toThrow();
  });
});
