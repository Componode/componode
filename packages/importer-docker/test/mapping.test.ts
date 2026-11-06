import { describe, it, expect } from "vitest";
import { validateDiscoveredAsset } from "@componode/core";
import {
  mapStatus,
  mapContainer,
  buildAsset,
  type ContainerInspect,
} from "../src/mapping.js";

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

// spec 064 / contracts/enriched-instance-fields.md — bounded enrichment
// facts on container instances; exclusions per ADR-121 Amendment 3.
describe("container enrichment fields (spec 064)", () => {
  function rawOf(inspect: ContainerInspect) {
    const { instance } = mapContainer(
      inspect,
      "docker-engine:e1",
      undefined,
      undefined,
      "componode.component-id",
    );
    return instance.rawConfig as Record<string, unknown>;
  }

  it("emits imageId from inspect.Image", () => {
    const raw = rawOf({ ...BASE_INSPECT, Image: "sha256:img1" } as ContainerInspect);
    expect(raw.imageId).toBe("sha256:img1");
  });

  it("emits the full bounded hostConfig mapping", () => {
    const raw = rawOf({
      ...BASE_INSPECT,
      HostConfig: {
        Memory: 536870912,
        NanoCpus: 1500000000,
        PidsLimit: 512,
        RestartPolicy: { Name: "on-failure", MaximumRetryCount: 5 },
        Privileged: true,
        ReadonlyRootfs: true,
        LogConfig: { Type: "json-file", Config: { "max-size": "10m" } },
      },
    } as ContainerInspect);
    expect(raw.hostConfig).toEqual({
      memoryBytes: 536870912,
      nanoCpus: 1500000000,
      pidsLimit: 512,
      restartPolicy: { mode: "on-failure", maxRetries: 5 },
      privileged: true,
      readOnlyRootfs: true,
      logDriver: "json-file",
    });
  });

  it("emits only reported hostConfig fields; booleans only when true", () => {
    const raw = rawOf({
      ...BASE_INSPECT,
      HostConfig: {
        RestartPolicy: { Name: "no" },
        Privileged: false,
        ReadonlyRootfs: false,
      },
    } as ContainerInspect);
    expect(raw.hostConfig).toEqual({
      restartPolicy: { mode: "no" },
    });
  });

  it("converts healthcheck nanoseconds to seconds; never reads Test", () => {
    const raw = rawOf({
      ...BASE_INSPECT,
      Config: {
        Image: "web:1",
        Healthcheck: {
          Test: ["CMD-SHELL", "curl -f http://localhost || exit 1"],
          Interval: 30000000000,
          Timeout: 10000000000,
          Retries: 3,
          StartPeriod: 15000000000,
        },
      },
    } as ContainerInspect);
    expect(raw.healthcheck).toEqual({
      intervalSeconds: 30,
      timeoutSeconds: 10,
      retries: 3,
      startPeriodSeconds: 15,
    });
    expect(JSON.stringify(raw)).not.toContain("curl -f");
  });

  it("omits hostConfig/healthcheck/imageId entirely when unreported", () => {
    const raw = rawOf(BASE_INSPECT);
    expect(raw).not.toHaveProperty("hostConfig");
    expect(raw).not.toHaveProperty("healthcheck");
    expect(raw).not.toHaveProperty("imageId");
    // dockerObservation stays pure state/health — no config facts leak in
    expect(raw.dockerObservation).not.toHaveProperty("hostConfig");
  });

  it("treats Docker unset sentinels as absent — no zeroed limit facts", () => {
    const raw = rawOf({
      ...BASE_INSPECT,
      HostConfig: { Memory: 0, NanoCpus: 0, PidsLimit: -1 },
    } as ContainerInspect);
    expect(raw).not.toHaveProperty("hostConfig");
    const partial = rawOf({
      ...BASE_INSPECT,
      HostConfig: { Memory: 0, NanoCpus: 0, PidsLimit: -1, LogConfig: { Type: "json-file" } },
    } as ContainerInspect);
    expect(partial.hostConfig).toEqual({ logDriver: "json-file" });
  });

  it("emitted asset passes validateDiscoveredAsset", () => {
    const { identity, instance } = mapContainer(
      {
        ...BASE_INSPECT,
        Image: "sha256:img1",
        HostConfig: { Memory: 1024, RestartPolicy: { Name: "always" } },
        Config: {
          Image: "web:1",
          Healthcheck: { Interval: 5000000000, Retries: 2 },
        },
      } as ContainerInspect,
      "docker-engine:e1",
      undefined,
      undefined,
      "componode.component-id",
    );
    const asset = buildAsset(identity, [instance], "web:1");
    expect(validateDiscoveredAsset(asset)).toBe(true);
  });

  it("never carries env vars, bind sources, or log-driver config detail", () => {
    const raw = rawOf({
      ...BASE_INSPECT,
      Config: {
        Image: "web:1",
        Env: ["SECRET=hunter2"],
        Healthcheck: { Test: ["CMD", "secret-cmd"], Interval: 1000000000 },
      },
      HostConfig: {
        Binds: ["/host/secret:/container"],
        LogConfig: { Type: "syslog", Config: { "syslog-address": "tcp://10.0.0.1:514" } },
      },
    } as unknown as ContainerInspect);
    const json = JSON.stringify(raw);
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("/host/secret");
    expect(json).not.toContain("secret-cmd");
    expect(json).not.toContain("syslog-address");
    expect(json).not.toContain("10.0.0.1");
    // logDriver keeps only the driver name, never LogConfig.Config
    expect((raw.hostConfig as Record<string, unknown>).logDriver).toBe("syslog");
  });
});
