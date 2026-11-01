import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dockerode before importing the importer.
const inspects = new Map<string, unknown>();
const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  version: vi.fn(),
  listContainers: vi.fn(),
  listImages: vi.fn(),
  ping: vi.fn(),
  getContainer: vi.fn(),
  ctor: vi.fn(),
}));

vi.mock("dockerode", () => {
  class DockerMock {
    constructor(opts: unknown) {
      mocks.ctor(opts);
    }
    info = mocks.info;
    version = mocks.version;
    listContainers = mocks.listContainers;
    listImages = mocks.listImages;
    ping = mocks.ping;
    getContainer = mocks.getContainer;
  }
  return { default: DockerMock };
});

import { DockerImporter } from "../src/importer.js";
import { validateTargetProfile } from "../src/target-profile.js";
import { workloadIdentity, instanceExternalId } from "../src/identity.js";
import { validateDiscoveredAsset, NOOP_LOGGER, type ImporterContext } from "@componode/core";

const SOCKET_PROFILE = { transport: "socket", path: "/var/run/docker.sock" };

function makeContext(target: unknown = SOCKET_PROFILE): ImporterContext & {
  reportSourceIdentity: ReturnType<typeof vi.fn>;
  reportPhase: ReturnType<typeof vi.fn>;
} {
  return {
    runId: "run-1",
    logger: NOOP_LOGGER,
    signal: new AbortController().signal,
    reportPhase: vi.fn(),
    reportSourceIdentity: vi.fn(),
    resolveTarget: vi.fn(() => target),
  };
}

function inspectFixture(over: Record<string, unknown> = {}) {
  return {
    Id: "abc123",
    Name: "/commerce-web-1",
    Config: {
      Image: "registry.local/commerce/web:1.2.3",
      Env: ["SECRET_KEY=hunter2"],
      Labels: {
        "com.docker.compose.project": "commerce",
        "com.docker.compose.service": "web",
      },
    },
    State: { Status: "running", ExitCode: 0, StartedAt: "2026-11-01T00:00:00Z" },
    HostConfig: { RestartPolicy: { Name: "unless-stopped" }, Binds: ["/home/user/data:/data"] },
    Mounts: [{ Type: "bind", Source: "/home/user/data", Destination: "/data" }],
    NetworkSettings: {
      Ports: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] },
      Networks: { commerce_default: {} },
    },
    RepoDigests: ["registry.local/commerce/web@sha256:deadbeef"],
    ...over,
  };
}

const importer = new DockerImporter();

async function run(config: Record<string, unknown>, secrets: Record<string, string> = {}, context = makeContext()) {
  const assets = [];
  for await (const a of importer.run(config, secrets, context)) assets.push(a);
  return { assets, context };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.info.mockResolvedValue({ ID: "engine-1", Name: "docker-1" });
  mocks.listContainers.mockResolvedValue([{ Id: "abc123" }]);
  mocks.getContainer.mockImplementation((id: string) => ({
    inspect: vi.fn(async () => inspects.get(id) ?? inspectFixture()),
  }));
  mocks.ping.mockResolvedValue("OK");
  mocks.listImages.mockResolvedValue([]);
  mocks.version.mockResolvedValue({ ApiVersion: "1.45" });
});

describe("DockerImporter.run", () => {
  it("reports source identity before first yield and emits grouped CONTAINER assets", async () => {
    inspects.set("abc123", inspectFixture());
    const { assets, context } = await run({ targetId: "local" });
    expect(context.reportSourceIdentity).toHaveBeenCalledWith({
      externalIdentity: "docker-engine:engine-1",
      label: "docker-1",
    });
    expect(assets).toHaveLength(1);
    const asset = assets[0];
    expect(asset.externalId).toBe("compose:commerce:web");
    expect(asset.category).toBe("CONTAINER");
    expect(asset.provider).toBe("DOCKER");
    expect(asset.instances).toHaveLength(1);
    expect(asset.instances[0].externalId).toBe("docker-engine:engine-1::abc123");
    expect(asset.instances[0].status).toBe("RUNNING");
    expect(validateDiscoveredAsset(asset)).toBe(true);
    // resolveTarget consulted with the scope targetId
    expect(context.resolveTarget).toHaveBeenCalledWith("local");
  });

  it("still reports source identity on an empty inventory", async () => {
    mocks.listContainers.mockResolvedValue([]);
    const { assets, context } = await run({ targetId: "local" });
    expect(context.reportSourceIdentity).toHaveBeenCalledOnce();
    expect(assets).toHaveLength(0);
  });

  it("falls back to sourceKey when /info.ID is absent; fails when neither", async () => {
    mocks.info.mockResolvedValue({ Name: "docker-1" });
    await run({ targetId: "local", sourceKey: "prod-1" });
    mocks.info.mockResolvedValue({ Name: "docker-1" });
    await expect(run({ targetId: "local" })).rejects.toThrow(/ImporterSource|info\.ID/);
  });

  it("fails the run when inspect fails (no partial inventory)", async () => {
    mocks.getContainer.mockImplementation(() => ({
      inspect: vi.fn(async () => { throw new Error("container vanished"); }),
    }));
    await expect(run({ targetId: "local" })).rejects.toThrow("container vanished");
  });

  it("never persists env vars, raw bind paths, or health output", async () => {
    inspects.set("abc123", inspectFixture());
    const { assets } = await run({ targetId: "local" });
    const json = JSON.stringify(assets);
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("/home/user/data");
    const mount = (assets[0].instances[0].rawConfig as any).mounts[0];
    expect(mount.type).toBe("bind");
    expect(mount.ref).toBe("bind:abc123:/data");
    expect(mount.destination).toBe("/data");
  });

  it("maps engine state to status (health ignored in Wave C)", async () => {
    const cases: Array<[string, string]> = [
      ["running", "RUNNING"],
      ["exited", "STOPPED"],
      ["created", "STOPPED"],
      ["paused", "STOPPED"],
      ["dead", "ERROR"],
      ["restarting", "ERROR"],
      ["bogus", "ERROR"],
    ];
    for (const [state, expected] of cases) {
      inspects.set("abc123", inspectFixture({ State: { Status: state } }));
      const { assets } = await run({ targetId: "local" });
      expect(assets[0].instances[0].status).toBe(expected);
    }
  });

  it("skips image inventory by default; emits PACKAGE_REGISTRY assets when opted in", async () => {
    await run({ targetId: "local" });
    expect(mocks.listImages).not.toHaveBeenCalled();
    mocks.listImages.mockResolvedValue([
      { Id: "img1", RepoTags: ["app:latest"], RepoDigests: [], Size: 1, Created: 1 },
    ]);
    const { assets } = await run({ targetId: "local", includeImages: true });
    const image = assets.find((a) => a.category === "PACKAGE_REGISTRY");
    expect(image?.externalId).toBe("docker-image:app@latest");
    expect(image?.instances).toEqual([]);
    expect(validateDiscoveredAsset(image)).toBe(true);
  });

  it("an aborted signal short-circuits run() before listing", async () => {
    const ac = new AbortController();
    ac.abort();
    const context = makeContext();
    context.signal = ac.signal;
    const assets = [];
    for await (const a of importer.run({ targetId: "local" }, {}, context))
      assets.push(a);
    expect(assets).toHaveLength(0);
    expect(mocks.listContainers).not.toHaveBeenCalled();
  });
});

describe("workload identity", () => {
  it("override label wins, compose second, standalone fallback daemon-qualified", () => {
    const w = workloadIdentity({ "componode.component-id": "api-x", "com.docker.compose.project": "p", "com.docker.compose.service": "s" }, "/n", "src", "componode.component-id");
    expect(w.externalId).toBe("workload:api-x");
    const c = workloadIdentity({ "com.docker.compose.project": "p", "com.docker.compose.service": "s" }, "/n", "src", "componode.component-id");
    expect(c.externalId).toBe("compose:p:s");
    const s = workloadIdentity({}, "/web-1", "docker-engine:e1", "componode.component-id");
    expect(s.externalId).toBe("docker-engine:e1::web-1");
    expect(instanceExternalId("docker-engine:e1", "cid")).toBe("docker-engine:e1::cid");
  });
});

describe("target profile schema", () => {
  it("accepts one valid profile per transport; rejects insecure shapes", () => {
    expect(validateTargetProfile({ transport: "socket", path: "/var/run/docker.sock" }).transport).toBe("socket");
    expect(validateTargetProfile({ transport: "socket", path: "//./pipe/docker_engine" }).transport).toBe("socket");
    expect(validateTargetProfile({ transport: "tcp", host: "h", clientCertKey: "c", clientKeyKey: "k" }).transport).toBe("tcp");
    expect(validateTargetProfile({ transport: "ssh", host: "h", user: "u", hostKeySha256: "a".repeat(64), privateKeyKey: "k" }).transport).toBe("ssh");
    expect(validateTargetProfile({ transport: "context", name: "prod" }).transport).toBe("context");
    expect(() => validateTargetProfile({ transport: "tcp", host: "h" })).toThrow(/invalid/);
    expect(() => validateTargetProfile({ transport: "ssh", host: "h", user: "u", privateKeyKey: "k" })).toThrow(/invalid/);
    expect(() => validateTargetProfile({ transport: "context", name: "default" })).toThrow(/invalid/);
    expect(() => validateTargetProfile({ transport: "bogus" })).toThrow(/invalid/);
    expect(() => validateTargetProfile({ transport: "socket", path: "relative/../x" })).toThrow(/invalid/);
  });
});

describe("testSecrets", () => {
  it("probes via ping only, sanitizes errors, fails without a resolved target", async () => {
    const ok = await importer.testSecrets({ clientCert: "PEM" }, { targetId: "t" }, { transport: "socket", path: "/x" });
    expect(ok.ok).toBe(true);
    expect(mocks.ping).toHaveBeenCalled();
    expect(mocks.listContainers).not.toHaveBeenCalled();
    const noTarget = await importer.testSecrets({}, {}, undefined);
    expect(noTarget.ok).toBe(false);
    mocks.ping.mockRejectedValueOnce(new Error("dial fail PEM"));
    const bad = await importer.testSecrets({ clientKey: "PEMMATERIAL" }, {}, { transport: "socket", path: "/x" });
    expect(bad.ok).toBe(false);
    expect(bad.error).not.toContain("PEMMATERIAL");
  });
});
