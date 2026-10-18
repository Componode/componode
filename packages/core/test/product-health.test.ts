import { describe, it, expect } from "vitest";
import { computeProductHealth } from "../src/product-health.js";

// Spec 019 / ADR-112: pure aggregation over a product's declared dep
// sources' instances. GONE and RETIRED-component instances never contribute;
// PRODUCTION headlines when present; zero contributing instances → null.

const lifecycles = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, "ACTIVE"]));

describe("computeProductHealth", () => {
  it("returns null when there are no instances at all", () => {
    expect(
      computeProductHealth({ instances: [], componentLifecycle: {} }),
    ).toBeNull();
  });

  it("returns null when every instance is GONE", () => {
    expect(
      computeProductHealth({
        instances: [
          { componentId: "c1", environment: "PRODUCTION", status: "GONE" },
        ],
        componentLifecycle: lifecycles("c1"),
      }),
    ).toBeNull();
  });

  it("returns null when all contributing components are RETIRED", () => {
    expect(
      computeProductHealth({
        instances: [
          { componentId: "c1", environment: "PRODUCTION", status: "ERROR" },
        ],
        componentLifecycle: { c1: "RETIRED" },
      }),
    ).toBeNull();
  });

  it("picks the worst status across a single environment", () => {
    const health = computeProductHealth({
      instances: [
        { componentId: "c1", environment: "PRODUCTION", status: "RUNNING" },
        { componentId: "c2", environment: "PRODUCTION", status: "STOPPED" },
        { componentId: "c3", environment: "PRODUCTION", status: "ERROR" },
      ],
      componentLifecycle: lifecycles("c1", "c2", "c3"),
    });
    expect(health?.status).toBe("ERROR");
    expect(health?.perEnv.PRODUCTION).toBe("ERROR");
  });

  it("STOPPED outranks RUNNING", () => {
    const health = computeProductHealth({
      instances: [
        { componentId: "c1", environment: "PRODUCTION", status: "RUNNING" },
        { componentId: "c2", environment: "PRODUCTION", status: "STOPPED" },
      ],
      componentLifecycle: lifecycles("c1", "c2"),
    });
    expect(health?.status).toBe("STOPPED");
  });

  it("headlines PRODUCTION when any PRODUCTION instance exists, even if another env is worse", () => {
    const health = computeProductHealth({
      instances: [
        { componentId: "c1", environment: "PRODUCTION", status: "RUNNING" },
        { componentId: "c2", environment: "DEV", status: "ERROR" },
      ],
      componentLifecycle: lifecycles("c1", "c2"),
    });
    expect(health?.status).toBe("RUNNING");
    expect(health?.perEnv).toEqual({ PRODUCTION: "RUNNING", DEV: "ERROR" });
  });

  it("falls back to worst across all environments when no PRODUCTION instance exists", () => {
    const health = computeProductHealth({
      instances: [
        { componentId: "c1", environment: "DEV", status: "RUNNING" },
        { componentId: "c2", environment: "STAGING", status: "STOPPED" },
      ],
      componentLifecycle: lifecycles("c1", "c2"),
    });
    expect(health?.status).toBe("STOPPED");
    expect(health?.perEnv).toEqual({ DEV: "RUNNING", STAGING: "STOPPED" });
  });

  it("excludes GONE instances from perEnv and headline", () => {
    const health = computeProductHealth({
      instances: [
        { componentId: "c1", environment: "PRODUCTION", status: "GONE" },
        { componentId: "c1", environment: "PRODUCTION", status: "RUNNING" },
      ],
      componentLifecycle: lifecycles("c1"),
    });
    expect(health?.status).toBe("RUNNING");
    expect(health?.perEnv).toEqual({ PRODUCTION: "RUNNING" });
  });

  it("omits environments whose only instances are GONE", () => {
    const health = computeProductHealth({
      instances: [
        { componentId: "c1", environment: "PRODUCTION", status: "RUNNING" },
        { componentId: "c1", environment: "DEV", status: "GONE" },
      ],
      componentLifecycle: lifecycles("c1"),
    });
    expect(health?.perEnv).toEqual({ PRODUCTION: "RUNNING" });
  });

  it("treats a component missing from the lifecycle map as RETIRED (excluded)", () => {
    const health = computeProductHealth({
      instances: [
        { componentId: "gone-component", environment: "PRODUCTION", status: "ERROR" },
        { componentId: "c1", environment: "PRODUCTION", status: "RUNNING" },
      ],
      componentLifecycle: lifecycles("c1"),
    });
    expect(health?.status).toBe("RUNNING");
    expect(health?.sourceCount).toBe(1);
  });

  it("counts distinct source components with at least one contributing instance", () => {
    const health = computeProductHealth({
      instances: [
        { componentId: "c1", environment: "PRODUCTION", status: "RUNNING" },
        { componentId: "c1", environment: "STAGING", status: "RUNNING" },
        { componentId: "c2", environment: "PRODUCTION", status: "GONE" },
        { componentId: "c3", environment: "PRODUCTION", status: "STOPPED" },
      ],
      componentLifecycle: lifecycles("c1", "c2", "c3"),
    });
    // c2 contributes nothing (GONE only); c1 deduped across envs.
    expect(health?.sourceCount).toBe(2);
  });
});
