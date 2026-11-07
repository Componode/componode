import { describe, it, expect } from "vitest";
import { mapEngineAsset, type EngineInfo, type EngineVersion } from "../src/engine.js";
import { validateDiscoveredAsset } from "@componode/core";

// spec 064 / contracts/engine-and-image-assets.md — one COMPUTE engine
// component per source; facts in details; exclusions per ADR-121 A3.
const SRC = "docker-engine:eng-1";

const FULL_INFO: EngineInfo = {
  ID: "eng-1",
  Name: "prod-docker",
  ServerVersion: "27.3.1",
  OperatingSystem: "linux",
  Architecture: "x86_64",
  KernelVersion: "6.8.0-51-generic",
  CgroupDriver: "systemd",
  Runtimes: { "io.containerd.runc.v2": {}, runc: {} },
  RegistryConfig: { Mirrors: ["https://mirror.example.com"] },
  Swarm: {
    LocalNodeState: "active",
    ControlAvailable: true,
    Managers: 3,
  },
};

const FULL_VERSION: EngineVersion = {
  Version: "27.3.1",
  ApiVersion: "1.45",
  Os: "linux",
  Arch: "x86_64",
  KernelVersion: "6.8.0-51-generic",
};

describe("mapEngineAsset (spec 064)", () => {
  it("emits a COMPUTE/docker-engine component keyed by the source identity", () => {
    const a = mapEngineAsset(FULL_INFO, FULL_VERSION, SRC);
    expect(a.category).toBe("COMPUTE");
    expect(a.provider).toBe("DOCKER");
    expect(a.resourceType).toBe("docker-engine");
    expect(a.name).toBe("prod-docker");
    // externalId IS the source identity — no :: qualifier, no double prefix
    expect(a.externalId).toBe(SRC);
    expect(a.externalId).not.toContain("::");
    expect(validateDiscoveredAsset(a)).toBe(true);
  });

  it("carries the bounded fact set in details", () => {
    const a = mapEngineAsset(FULL_INFO, FULL_VERSION, SRC);
    expect(a.details).toEqual({
      serverVersion: "27.3.1",
      apiVersion: "1.45",
      os: "linux",
      arch: "x86_64",
      kernelVersion: "6.8.0-51-generic",
      cgroupDriver: "systemd",
      runtimes: ["io.containerd.runc.v2", "runc"],
      registryMirrors: ["https://mirror.example.com"],
      swarmNodeState: "active",
      swarmControlAvailable: true,
      swarmManagers: 3,
    });
  });

  it("has exactly one OTHER/RUNNING instance with empty rawConfig", () => {
    const a = mapEngineAsset(FULL_INFO, FULL_VERSION, SRC);
    expect(a.instances).toHaveLength(1);
    const inst = a.instances[0]!;
    expect(inst.environment).toBe("OTHER");
    expect(inst.status).toBe("RUNNING");
    expect(inst.externalId).toBe("docker-engine:eng-1::engine");
    expect(inst.rawConfig ?? {}).toEqual({});
  });

  it("omits optional keys the engine does not report", () => {
    const a = mapEngineAsset(
      { ID: "eng-1", Name: "minimal", ServerVersion: "24.0.0" },
      { ApiVersion: "1.43" },
      SRC,
    );
    expect(a.details).toEqual({
      serverVersion: "24.0.0",
      apiVersion: "1.43",
    });
  });

  it("falls back across info/version for shared facts and names the engine by ID", () => {
    const a = mapEngineAsset(
      { ID: "eng-9" },
      { Version: "26.0.0", ApiVersion: "1.44", Os: "linux", Arch: "arm64" },
      "docker-engine:eng-9",
    );
    expect(a.name).toBe("eng-9");
    expect(a.details).toMatchObject({
      serverVersion: "26.0.0",
      apiVersion: "1.44",
      os: "linux",
      arch: "arm64",
    });
  });

  it("tolerates a null/undefined info payload", () => {
    const a = mapEngineAsset(undefined, FULL_VERSION, SRC);
    expect(a.externalId).toBe(SRC);
    expect(a.name).toBe("eng-1"); // falls back to the identity's engine id
    expect(validateDiscoveredAsset(a)).toBe(true);
  });

  it("never emits excluded /info fields even when present", () => {
    const hostile = {
      ...FULL_INFO,
      DockerRootDir: "/var/lib/docker",
      HTTPProxy: "http://user:pass@proxy:3128",
      HTTPSProxy: "http://user:pass@proxy:3128",
      NoProxy: "localhost",
      Plugins: [{ Name: "secret-plugin" }],
      SecurityOptions: ["name=apparmor"],
      Warnings: ["bridge-nf-call-iptables is disabled"],
    } as EngineInfo;
    const a = mapEngineAsset(hostile, FULL_VERSION, SRC);
    const json = JSON.stringify(a);
    for (const bad of [
      "DockerRootDir",
      "/var/lib/docker",
      "user:pass@proxy",
      "secret-plugin",
      "apparmor",
      "bridge-nf-call",
    ]) {
      expect(json).not.toContain(bad);
    }
  });
});
