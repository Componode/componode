import { describe, it, expect, vi } from "vitest";

// The service module imports the shared Kysely instance; the pure helper
// under test never touches it.
vi.mock("../../src/db/connection.js", () => ({ db: {} }));

const { readRelationFamily } = await import(
  "../../src/services/product-service.js"
);

describe("readRelationFamily (spec 059)", () => {
  it("returns the family data untouched on success", async () => {
    const unavailable: string[] = [];
    const rows = [{ id: "p1" }];
    await expect(
      readRelationFamily("consumesFrom", Promise.resolve(rows), unavailable as never),
    ).resolves.toBe(rows);
    expect(unavailable).toEqual([]);
  });

  it("degrades a failed family to an empty array and flags it", async () => {
    const unavailable: string[] = [];
    await expect(
      readRelationFamily(
        "consumedBy",
        Promise.reject(new Error("relation gone")),
        unavailable as never,
      ),
    ).resolves.toEqual([]);
    expect(unavailable).toEqual(["consumedBy"]);
  });

  it("accumulates multiple failed families", async () => {
    const unavailable: string[] = [];
    const fail = Promise.reject(new Error("boom"));
    await readRelationFamily("consumesFrom", fail, unavailable as never);
    await readRelationFamily("consumedBy", fail, unavailable as never);
    await expect(
      readRelationFamily("composedBy", Promise.resolve([{ id: "x" }]), unavailable as never),
    ).resolves.toHaveLength(1);
    expect(unavailable).toEqual(["consumesFrom", "consumedBy"]);
  });
});
