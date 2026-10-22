import { describe, it, expect, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

vi.mock("../../src/db/connection.js", () => ({ db: {} }));

const { assertAgentAssignable } = await import(
  "../../src/services/importer-config-service.js"
);

// Minimal executor fake: one where().executeTakeFirst() chain returning a
// canned agent row. Decision-table unit test — integration covers the wire.
function fakeTrx(agent: unknown) {
  return {
    selectFrom: () => ({
      selectAll: () => ({
        where: () => ({
          executeTakeFirst: async () => agent,
        }),
      }),
    }),
  } as never;
}

const base = {
  id: "a1",
  name: "edge-1",
  revokedAt: null,
  allowedImporters: [] as string[],
};

describe("assertAgentAssignable (spec 027 US1)", () => {
  it("passes for a live agent with an empty (allow-all) policy", async () => {
    await expect(
      assertAgentAssignable(fakeTrx(base), "a1", "github"),
    ).resolves.toBeUndefined();
  });

  it("throws AGENT_NOT_FOUND for a missing agent", async () => {
    await expect(
      assertAgentAssignable(fakeTrx(undefined), "missing", "github"),
    ).rejects.toMatchObject({ statusCode: 404, code: "AGENT_NOT_FOUND" });
  });

  it("throws AGENT_INCOMPATIBLE for a revoked agent", async () => {
    await expect(
      assertAgentAssignable(fakeTrx({ ...base, revokedAt: "x" }), "a1", "github"),
    ).rejects.toMatchObject({ statusCode: 400, code: "AGENT_INCOMPATIBLE" });
  });

  it("throws AGENT_INCOMPATIBLE when allowedImporters misses the importer", async () => {
    await expect(
      assertAgentAssignable(
        fakeTrx({ ...base, allowedImporters: ["web-url"] }),
        "a1",
        "github",
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "AGENT_INCOMPATIBLE" });
  });

  it("passes when allowedImporters covers the importer", async () => {
    await expect(
      assertAgentAssignable(
        fakeTrx({ ...base, allowedImporters: ["github", "web-url"] }),
        "a1",
        "github",
      ),
    ).resolves.toBeUndefined();
  });
});
