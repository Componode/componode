import { describe, it, expect, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

// Pure-function coverage — the db handle is never queried here.
vi.mock("../../src/db/connection.js", () => ({ db: {} }));

const {
  getSourceGroupStrategy,
  isAutoGroupEnabled,
  reduceSoleReporters,
} = await import("../../src/services/source-group-service.js");

describe("reduceSoleReporters", () => {
  it("maps each sole-reported component to its only reporter", () => {
    const sole = reduceSoleReporters([
      { componentId: "c1", sourceId: "s1" },
      { componentId: "c2", sourceId: "s1" },
      { componentId: "c3", sourceId: "s2" },
    ]);
    expect(sole.get("s1")).toEqual(new Set(["c1", "c2"]));
    expect(sole.get("s2")).toEqual(new Set(["c3"]));
  });

  it("excludes components with multiple effective-active reporters", () => {
    const sole = reduceSoleReporters([
      { componentId: "shared", sourceId: "s1" },
      { componentId: "shared", sourceId: "s2" },
      { componentId: "solo", sourceId: "s1" },
    ]);
    expect(sole.get("s1")).toEqual(new Set(["solo"]));
    expect(sole.has("s2")).toBe(false);
  });

  it("dedupes repeated membership rows for the same pair", () => {
    const sole = reduceSoleReporters([
      { componentId: "c1", sourceId: "s1" },
      { componentId: "c1", sourceId: "s1" },
    ]);
    expect(sole.get("s1")).toEqual(new Set(["c1"]));
  });
});

describe("isAutoGroupEnabled", () => {
  it("defaults to enabled when autoGroup is absent", () => {
    expect(isAutoGroupEnabled({})).toBe(true);
    expect(isAutoGroupEnabled(undefined)).toBe(true);
    expect(isAutoGroupEnabled(null)).toBe(true);
    expect(isAutoGroupEnabled({ autoGroup: true })).toBe(true);
  });

  it("opts out only on explicit false", () => {
    expect(isAutoGroupEnabled({ autoGroup: false })).toBe(false);
  });
});

describe("docker source-group strategy", () => {
  const strategy = getSourceGroupStrategy("docker");

  it("is registered for the docker importer only", () => {
    expect(strategy).toBeDefined();
    expect(getSourceGroupStrategy("github")).toBeUndefined();
    expect(getSourceGroupStrategy("aws")).toBeUndefined();
  });

  it("derives a deterministic docker-cluster slug from the identity", () => {
    const source = {
      importerName: "docker",
      externalIdentity: "docker-engine:abc123",
      label: null,
    };
    const slug = strategy!.slugBase(source);
    expect(slug).toMatch(/^docker-cluster-[0-9a-f]{12}$/);
    expect(strategy!.slugBase(source)).toBe(slug);
    expect(
      strategy!.slugBase({ ...source, externalIdentity: "docker-engine:xyz" }),
    ).not.toBe(slug);
  });

  it("prefers the source label, then engine name, then identity", () => {
    const base = {
      importerName: "docker",
      externalIdentity: "id-1",
      label: "Engine A" as string | null,
    };
    expect(strategy!.groupName(base, "engine-comp")).toBe("Engine A");
    expect(strategy!.groupName({ ...base, label: null }, "engine-comp")).toBe(
      "engine-comp",
    );
    expect(strategy!.groupName({ ...base, label: null }, null)).toBe("id-1");
  });
});
