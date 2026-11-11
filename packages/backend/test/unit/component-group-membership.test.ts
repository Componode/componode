import { describe, it, expect, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

// Pure-function coverage — the db handle is never queried here.
vi.mock("../../src/db/connection.js", () => ({ db: {} }));

const { diffHumanMemberships, assertGroupsAssignable } = await import(
  "../../src/services/component-group-membership.js"
);

describe("diffHumanMemberships", () => {
  it("returns empty diff when before and desired match", () => {
    expect(diffHumanMemberships(["a", "b"], ["a", "b"])).toEqual({
      toRemove: [],
      toAdd: [],
    });
  });

  it("computes removals and additions independently", () => {
    expect(diffHumanMemberships(["a", "b"], ["b", "c"])).toEqual({
      toRemove: ["a"],
      toAdd: ["c"],
    });
  });

  it("clears all memberships on empty desired set", () => {
    expect(diffHumanMemberships(["a", "b"], [])).toEqual({
      toRemove: ["a", "b"],
      toAdd: [],
    });
  });

  it("adds all memberships from empty before set", () => {
    expect(diffHumanMemberships([], ["a", "b"])).toEqual({
      toRemove: [],
      toAdd: ["a", "b"],
    });
  });

  it("ignores duplicates in both inputs", () => {
    expect(diffHumanMemberships(["a", "a"], ["a", "a", "b", "b"])).toEqual({
      toRemove: [],
      toAdd: ["b"],
    });
  });
});

describe("assertGroupsAssignable", () => {
  const human = { id: "g1", autoSourceId: null };
  const auto = { id: "g2", autoSourceId: "src-1" };

  it("passes for human-managed groups", () => {
    expect(() =>
      assertGroupsAssignable([human, { id: "g3", autoSourceId: null }], [
        "g1",
        "g3",
      ]),
    ).not.toThrow();
  });

  it("passes on empty input", () => {
    expect(() => assertGroupsAssignable([], [])).not.toThrow();
  });

  it("rejects unknown ids with 404 NOT_FOUND", () => {
    try {
      assertGroupsAssignable([human], ["g1", "missing"]);
      expect.unreachable();
    } catch (e) {
      const err = e as { statusCode?: number; code?: string };
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("NOT_FOUND");
    }
  });

  it("rejects auto-managed ids with 409 GROUP_AUTO_MANAGED", () => {
    try {
      assertGroupsAssignable([human, auto], ["g1", "g2"]);
      expect.unreachable();
    } catch (e) {
      const err = e as { statusCode?: number; code?: string };
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe("GROUP_AUTO_MANAGED");
    }
  });

  it("rejects auto-managed even when mixed with valid human ids", () => {
    try {
      assertGroupsAssignable([auto], ["g2"]);
      expect.unreachable();
    } catch (e) {
      const err = e as { statusCode?: number; code?: string };
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe("GROUP_AUTO_MANAGED");
    }
  });

  it("dedupes repeated requested ids", () => {
    expect(() =>
      assertGroupsAssignable([human], ["g1", "g1", "g1"]),
    ).not.toThrow();
  });
});
