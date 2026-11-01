import { describe, it, expect } from "vitest";
import { mapStatus, mapContainer, type ContainerInspect } from "../src/mapping.js";

// spec 047 / contracts/docker-observation.md — state×health→status table.
describe("mapStatus (health-aware, ADR-121 Amendment 1)", () => {
  it("running maps RUNNING for healthy, starting, and absent health", () => {
    for (const health of [
      undefined,
      { Status: "healthy" },
      { Status: "starting" },
    ]) {
      expect(mapStatus({ Status: "running", Health: health })).toBe("RUNNING");
    }
  });

  it("running + unhealthy → ERROR; running + OOMKilled → ERROR", () => {
    expect(mapStatus({ Status: "running", Health: { Status: "unhealthy" } })).toBe("ERROR");
    expect(mapStatus({ Status: "running", OOMKilled: true })).toBe("ERROR");
    expect(
      mapStatus({ Status: "running", OOMKilled: true, Health: { Status: "healthy" } }),
    ).toBe("ERROR");
  });

  it("created/paused/exited → STOPPED regardless of health", () => {
    for (const status of ["created", "paused", "exited"]) {
      expect(mapStatus({ Status: status, Health: { Status: "unhealthy" } })).toBe("STOPPED");
      expect(mapStatus({ Status: status })).toBe("STOPPED");
    }
  });

  it("OOMKilled overrides STOPPED states", () => {
    for (const status of ["created", "paused", "exited"]) {
      expect(mapStatus({ Status: status, OOMKilled: true })).toBe("ERROR");
    }
  });

  it("non-zero exitCode alone does not escalate exited past STOPPED", () => {
    expect(mapStatus({ Status: "exited", ExitCode: 137 })).toBe("STOPPED");
  });

  it("dead/restarting/removing/unknown/undefined fail closed to ERROR", () => {
    for (const status of ["dead", "restarting", "removing", "bogus", undefined]) {
      expect(mapStatus({ Status: status })).toBe("ERROR");
    }
  });
});

const BASE_INSPECT: ContainerInspect = {
  Id: "c1",
  Name: "/web-1",
  Config: { Image: "web:1" },
  State: { Status: "running", StartedAt: "2026-11-01T00:00:00Z" },
};

function obsOf(inspect: ContainerInspect) {
  const { instance } = mapContainer(
    inspect,
    "docker-engine:e1",
    undefined,
    undefined,
    "componode.component-id",
  );
  return (instance.rawConfig as Record<string, unknown>)
    .dockerObservation as Record<string, unknown> | undefined;
}

describe("dockerObservation allowlist (spec 047)", () => {
  it("emits state and health facts only — health null when no healthcheck", () => {
    const obs = obsOf(BASE_INSPECT)!;
    expect(obs.state).toBe("running");
    expect(obs.health).toBeNull();
    expect(obs).not.toHaveProperty("oomKilled");
    expect(obs).not.toHaveProperty("restarting");
    expect(obs).not.toHaveProperty("exitCode");
  });

  it("records health status + failingStreak, never Health.Log", () => {
    const obs = obsOf({
      ...BASE_INSPECT,
      State: {
        Status: "running",
        Health: {
          Status: "unhealthy",
          FailingStreak: 3,
          Log: [
            { Start: "x", End: "y", ExitCode: 1, Output: "leaked-health-output" },
          ],
        } as never,
      },
    })!;
    expect(obs.health).toEqual({ status: "unhealthy", failingStreak: 3 });
    expect(JSON.stringify(obs)).not.toContain("leaked-health-output");
  });

  it("emits oomKilled/restarting/exitCode only when meaningful; zero-times → null", () => {
    const obs = obsOf({
      ...BASE_INSPECT,
      State: {
        Status: "exited",
        ExitCode: 137,
        OOMKilled: true,
        Restarting: true,
        StartedAt: "0001-01-01T00:00:00Z",
        FinishedAt: "2026-11-01T01:00:00Z",
      },
    })!;
    expect(obs).toMatchObject({
      state: "exited",
      exitCode: 137,
      oomKilled: true,
      restarting: true,
      startedAt: null,
      finishedAt: "2026-11-01T01:00:00Z",
    });
  });

  it("maps status from the same state+health fields the observation records", () => {
    const { instance } = mapContainer(
      {
        ...BASE_INSPECT,
        State: { Status: "running", Health: { Status: "unhealthy" } },
      },
      "docker-engine:e1",
      undefined,
      undefined,
      "componode.component-id",
    );
    expect(instance.status).toBe("ERROR");
  });
});
