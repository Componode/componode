import { describe, it, expect } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.COOKIE_SECRET ??= "test-secret-test-secret-test-secret";

import { AGENT_PROTOCOL_VERSION } from "@componode/core";

const { validateHello } = await import("../../src/services/agent-session-service.js");

const HUB_IMPORTERS = [
  { name: "github", version: "1.0.0" },
  { name: "kubernetes", version: "2.0.0" },
];

function hello(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    agentVersion: "1.2.3",
    importers: HUB_IMPORTERS,
    capabilities: { maxConcurrentJobs: 1 },
    ...overrides,
  };
}

describe("validateHello (lockstep parity, ADR-116 #7)", () => {
  it("accepts an exact match", () => {
    const result = validateHello(hello(), HUB_IMPORTERS);
    expect(result).toEqual({ ok: true });
  });

  it("rejects a different protocolVersion", () => {
    const result = validateHello(hello({ protocolVersion: 99 }), HUB_IMPORTERS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("protocol_mismatch");
  });

  it("rejects a mismatched importer version", () => {
    const result = validateHello(
      hello({
        importers: [
          { name: "github", version: "9.9.9" },
          { name: "kubernetes", version: "2.0.0" },
        ],
      }),
      HUB_IMPORTERS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("importer_mismatch");
  });

  it("rejects a missing importer", () => {
    const result = validateHello(
      hello({ importers: [{ name: "github", version: "1.0.0" }] }),
      HUB_IMPORTERS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("importer_mismatch");
  });

  it("rejects an extra importer the hub does not know", () => {
    const result = validateHello(
      hello({
        importers: [...HUB_IMPORTERS, { name: "mystery", version: "1.0.0" }],
      }),
      HUB_IMPORTERS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("importer_mismatch");
  });

  it("rejects a bad maxConcurrentJobs", () => {
    const result = validateHello(
      hello({ capabilities: { maxConcurrentJobs: 0 } }),
      HUB_IMPORTERS,
    );
    expect(result.ok).toBe(false);
  });
});
