import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

// Spec 028 US1 / T008: AGENT_OPS_* env parsing (listener config).

describe("ops listener config", () => {
  it("defaults to enabled on 0.0.0.0:9464", () => {
    const cfg = loadConfig({ HUB_URL: "http://localhost:3000" });
    expect(cfg.ops).toEqual({
      enabled: true,
      host: "0.0.0.0",
      port: 9464,
    });
  });

  it("honors AGENT_OPS_HOST / AGENT_OPS_PORT", () => {
    const cfg = loadConfig({
      HUB_URL: "http://localhost:3000",
      AGENT_OPS_HOST: "127.0.0.1",
      AGENT_OPS_PORT: "9999",
    });
    expect(cfg.ops).toEqual({
      enabled: true,
      host: "127.0.0.1",
      port: 9999,
    });
  });

  it("AGENT_OPS_DISABLED=true disables the listener", () => {
    const cfg = loadConfig({
      HUB_URL: "http://localhost:3000",
      AGENT_OPS_DISABLED: "true",
    });
    expect(cfg.ops.enabled).toBe(false);
  });

  it("rejects a non-numeric or out-of-range AGENT_OPS_PORT", () => {
    expect(() =>
      loadConfig({ HUB_URL: "http://localhost:3000", AGENT_OPS_PORT: "abc" }),
    ).toThrow();
    expect(() =>
      loadConfig({
        HUB_URL: "http://localhost:3000",
        AGENT_OPS_PORT: "70000",
      }),
    ).toThrow();
  });
});
