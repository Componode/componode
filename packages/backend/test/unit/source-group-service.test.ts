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

describe("docker app-group kinds (spec 070)", () => {
  const strategy = getSourceGroupStrategy("docker")!;
  const kinds = strategy.appGroupKinds ?? [];
  const compose = kinds.find((k) => k.kind === "compose-project")!;
  const swarm = kinds.find((k) => k.kind === "swarm-stack")!;
  const source = {
    id: "src-1",
    importerName: "docker",
    externalIdentity: "docker-engine:abc",
    label: null,
  };

  it("registers exactly the compose-project and swarm-stack kinds", () => {
    expect(kinds.map((k) => k.kind)).toEqual([
      "compose-project",
      "swarm-stack",
    ]);
  });

  it("extracts composeProject from workload details", () => {
    expect(
      compose.keysOf({ composeProject: "componode", composeService: "app" }),
    ).toEqual(["componode"]);
  });

  it("extracts the compose project label from infra details", () => {
    expect(
      compose.keysOf({
        labels: { "com.docker.compose.project": "componode" },
      }),
    ).toEqual(["componode"]);
  });

  it("unions direct field and label, deduped", () => {
    expect(
      compose.keysOf({
        composeProject: "componode",
        labels: { "com.docker.compose.project": "componode" },
      }),
    ).toEqual(["componode"]);
    expect(
      compose.keysOf({
        composeProject: "a",
        labels: { "com.docker.compose.project": "b" },
      }).sort(),
    ).toEqual(["a", "b"]);
  });

  it("returns no keys for unlabeled or absent details", () => {
    expect(compose.keysOf(null)).toEqual([]);
    expect(compose.keysOf({})).toEqual([]);
    expect(compose.keysOf({ labels: { "com.docker.compose.project": "" } })).toEqual([]);
    expect(swarm.keysOf({ stack: "mystack" })).toEqual(["mystack"]);
    expect(swarm.keysOf({ stack: 42 })).toEqual([]);
    expect(swarm.keysOf(null)).toEqual([]);
  });

  it("keys autoGroupKey, slug and name per boundary", () => {
    expect(compose.autoGroupKey("componode")).toBe("compose:componode");
    expect(swarm.autoGroupKey("mystack")).toBe("stack:mystack");
    expect(compose.groupName("componode")).toBe("componode");
    const slug = compose.slugBase(source, "componode");
    expect(slug).toMatch(/^docker-app-componode-[0-9a-f]{12}$/);
    // Same key on a different source → different slug (per-source identity).
    expect(
      compose.slugBase({ ...source, id: "src-2" }, "componode"),
    ).not.toBe(slug);
    expect(compose.groupDescription(source, "componode")).toContain(
      "componode",
    );
    expect(compose.groupDescription(source, "componode")).toContain("src-1" in source ? "docker-engine:abc" : "");
  });
});
