import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dockerode before importing the importer.
const inspects = new Map<string, unknown>();
const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  version: vi.fn(),
  listContainers: vi.fn(),
  listImages: vi.fn(),
  listServices: vi.fn(),
  listNodes: vi.fn(),
  listSecrets: vi.fn(),
  ping: vi.fn(),
  getContainer: vi.fn(),
  getImage: vi.fn(),
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
    listServices = mocks.listServices;
    listNodes = mocks.listNodes;
    listSecrets = mocks.listSecrets;
    ping = mocks.ping;
    getContainer = mocks.getContainer;
    getImage = mocks.getImage;
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
  mocks.getImage.mockImplementation(() => ({
    inspect: vi.fn(async () => ({})),
  }));
});

describe("DockerImporter.run", () => {
  it("reports source identity before first yield and emits grouped CONTAINER assets", async () => {
    inspects.set("abc123", inspectFixture());
    const { assets, context } = await run({ targetId: "local" });
    expect(context.reportSourceIdentity).toHaveBeenCalledWith({
      externalIdentity: "docker-engine:engine-1",
      label: "docker-1",
    });
    expect(assets).toHaveLength(2); // engine component + container workload
    const asset = assets.find((a) => a.category === "CONTAINER")!;
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
    // spec 064: the engine component is always emitted — an empty
    // container inventory still yields exactly the engine asset.
    expect(assets).toHaveLength(1);
    expect(assets[0].resourceType).toBe("docker-engine");
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
    const container = assets.find((a) => a.category === "CONTAINER")!;
    const json = JSON.stringify(container);
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("/home/user/data");
    const mount = (container.instances[0].rawConfig as any).mounts[0];
    expect(mount.type).toBe("bind");
    expect(mount.ref).toBe("bind:abc123:/data");
    expect(mount.destination).toBe("/data");
  });

  it("maps engine state + health to status (spec 047)", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ Status: "running" }, "RUNNING"],
      [{ Status: "running", Health: { Status: "healthy" } }, "RUNNING"],
      [{ Status: "running", Health: { Status: "starting" } }, "RUNNING"],
      [{ Status: "running", Health: { Status: "unhealthy" } }, "ERROR"],
      [{ Status: "running", OOMKilled: true }, "ERROR"],
      [{ Status: "exited" }, "STOPPED"],
      [{ Status: "exited", OOMKilled: true }, "ERROR"],
      [{ Status: "created" }, "STOPPED"],
      [{ Status: "paused" }, "STOPPED"],
      [{ Status: "dead" }, "ERROR"],
      [{ Status: "restarting" }, "ERROR"],
      [{ Status: "bogus" }, "ERROR"],
    ];
    for (const [state, expected] of cases) {
      inspects.set("abc123", inspectFixture({ State: state }));
      const { assets } = await run({ targetId: "local" });
      const container = assets.find((a) => a.category === "CONTAINER")!;
      expect(container.instances[0].status).toBe(expected);
    }
  });

  it("persists an allowlisted dockerObservation, never health output/commands", async () => {
    inspects.set(
      "abc123",
      inspectFixture({
        State: {
          Status: "running",
          Health: {
            Status: "unhealthy",
            FailingStreak: 2,
            Log: [{ ExitCode: 1, Output: "nc: connection refused" }],
          },
        },
        Config: {
          Image: "registry.local/commerce/web:1.2.3",
          Labels: {
            "com.docker.compose.project": "commerce",
            "com.docker.compose.service": "web",
          },
          Healthcheck: { Test: ["CMD-SHELL", "nc -z localhost 80"] },
        },
      }),
    );
    const { assets } = await run({ targetId: "local" });
    const container = assets.find((a) => a.category === "CONTAINER")!;
    expect(validateDiscoveredAsset(container)).toBe(true);
    const obs = (container.instances[0].rawConfig as any).dockerObservation;
    expect(obs).toMatchObject({
      state: "running",
      health: { status: "unhealthy", failingStreak: 2 },
    });
    const json = JSON.stringify(assets);
    expect(json).not.toContain("connection refused");
    expect(json).not.toContain("nc -z");
  });

  it("emits exactly one engine component per run on non-Swarm engines (spec 064)", async () => {
    mocks.info.mockResolvedValue({
      ID: "engine-1",
      Name: "docker-1",
      ServerVersion: "27.3.1",
      OperatingSystem: "linux",
      Architecture: "x86_64",
      KernelVersion: "6.8.0",
      DockerRootDir: "/var/lib/docker",
      HTTPProxy: "http://user:pass@proxy:3128",
      Plugins: [{ Name: "leaky" }],
      Warnings: ["warn"],
    });
    mocks.version.mockResolvedValue({ ApiVersion: "1.45", Version: "27.3.1" });
    const { assets } = await run({ targetId: "local" });
    const engines = assets.filter((a) => a.resourceType === "docker-engine");
    expect(engines).toHaveLength(1);
    const engine = engines[0];
    expect(engine.category).toBe("COMPUTE");
    expect(engine.externalId).toBe("docker-engine:engine-1");
    expect(engine.instances).toHaveLength(1);
    expect(engine.instances[0].status).toBe("RUNNING");
    expect(engine.details).toMatchObject({
      serverVersion: "27.3.1",
      apiVersion: "1.45",
      os: "linux",
      arch: "x86_64",
    });
    const json = JSON.stringify(engine);
    expect(json).not.toContain("user:pass@proxy");
    expect(json).not.toContain("/var/lib/docker");
    expect(json).not.toContain("leaky");
    expect(validateDiscoveredAsset(engine)).toBe(true);
    // one /version call per run feeds both engine facts and the Swarm gate
    expect(mocks.version).toHaveBeenCalledTimes(1);
  });

  it("enriches container instances with imageId/hostConfig/healthcheck (spec 064)", async () => {
    inspects.set(
      "abc123",
      inspectFixture({
        Image: "sha256:img-abc",
        HostConfig: {
          RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
          Memory: 268435456,
          NanoCpus: 500000000,
          PidsLimit: 256,
          ReadonlyRootfs: true,
          LogConfig: { Type: "json-file" },
          Binds: ["/srv/data:/data"],
        },
        Config: {
          Image: "registry.local/commerce/web:1.2.3",
          Labels: {
            "com.docker.compose.project": "commerce",
            "com.docker.compose.service": "web",
          },
          Healthcheck: {
            Test: ["CMD-SHELL", "curl -fsS localhost || exit 1"],
            Interval: 30000000000,
            Timeout: 5000000000,
            Retries: 3,
            StartPeriod: 10000000000,
          },
        },
      }),
    );
    const { assets } = await run({ targetId: "local" });
    const container = assets.find((a) => a.category === "CONTAINER");
    expect(container).toBeDefined();
    expect(validateDiscoveredAsset(container)).toBe(true);
    const raw = container!.instances[0].rawConfig as Record<string, any>;
    expect(raw.imageId).toBe("sha256:img-abc");
    expect(raw.hostConfig).toEqual({
      memoryBytes: 268435456,
      nanoCpus: 500000000,
      pidsLimit: 256,
      restartPolicy: { mode: "unless-stopped" },
      readOnlyRootfs: true,
      logDriver: "json-file",
    });
    expect(raw.healthcheck).toEqual({
      intervalSeconds: 30,
      timeoutSeconds: 5,
      retries: 3,
      startPeriodSeconds: 10,
    });
    const json = JSON.stringify(container);
    expect(json).not.toContain("curl -fsS");
    expect(json).not.toContain("/srv/data");
  });

  it("skips image inventory by default; emits PACKAGE_REGISTRY assets when opted in", async () => {
    await run({ targetId: "local" });
    expect(mocks.listImages).not.toHaveBeenCalled();
    mocks.listImages.mockResolvedValue([
      { Id: "img1", RepoTags: ["app:latest"], RepoDigests: [], Size: 1, Created: 1 },
    ]);
    const { assets } = await run({ targetId: "local", includeImages: true });
    const image = assets.find((a) => a.category === "PACKAGE_REGISTRY");
    expect(image?.externalId).toBe("docker-image:app:latest");
    expect(image?.instances).toEqual([]);
    expect(validateDiscoveredAsset(image)).toBe(true);
  });

  // spec 064 / contracts/engine-and-image-assets.md — opt-in inspect
  // merge: dedupe by image Id, bounded OCI allowlist, degrade per image.
  describe("image inspect enrichment (spec 064)", () => {
    const IMAGE_INSPECT = {
      Id: "sha256:img1",
      Architecture: "amd64",
      Os: "linux",
      Config: {
        Labels: {
          "org.opencontainers.image.source": "https://github.com/org/repo",
          "org.opencontainers.image.revision": "abc123",
          "org.opencontainers.image.version": "1.2.3",
          "org.opencontainers.image.vendor": "Acme",
          "org.opencontainers.image.licenses": "Apache-2.0",
          "org.opencontainers.image.description": "demo",
          "org.opencontainers.image.title": "Demo",
          "org.opencontainers.image.url": "https://example.com",
          "org.opencontainers.image.documentation": "https://docs.example.com",
          "org.opencontainers.image.source-label": "org/repo",
          "com.example.custom": "not-allowlisted",
          "org.opencontainers.image.random": "not-allowlisted",
        },
        User: "node",
        ExposedPorts: { "8080/tcp": {}, "443/tcp": {} },
        Entrypoint: ["node", "server.js"],
        WorkingDir: "/app",
        Volumes: { "/data": {} },
      },
    };

    function mockImages() {
      mocks.listImages.mockResolvedValue([
        {
          Id: "sha256:img1",
          RepoTags: ["app:latest"],
          RepoDigests: ["registry/app@sha256:a", "registry/app@sha256:b"],
          Size: 100,
          Created: 123,
        },
      ]);
      mocks.getImage.mockImplementation((id: string) => ({
        inspect: vi.fn(async () => (id === "sha256:img1" ? IMAGE_INSPECT : {})),
      }));
    }

    it("inspects each unique image Id once and merges bounded details into every ref asset", async () => {
      mockImages();
      const { assets } = await run({ targetId: "local", includeImages: true });
      const images = assets.filter((a) => a.category === "PACKAGE_REGISTRY");
      // RepoDigests preferred over RepoTags → two ref assets, one Id
      expect(images.map((a) => a.externalId).sort()).toEqual([
        "docker-image:registry/app@sha256:a",
        "docker-image:registry/app@sha256:b",
      ]);
      expect(mocks.getImage).toHaveBeenCalledTimes(1);
      expect(mocks.getImage).toHaveBeenCalledWith("sha256:img1");
      for (const img of images) {
        expect(img.details).toMatchObject({
          imageId: "sha256:img1",
          size: 100,
          created: 123,
          architecture: "amd64",
          os: "linux",
          user: "node",
          entrypoint: ["node", "server.js"],
          workingDir: "/app",
          exposedPorts: ["8080/tcp", "443/tcp"],
          volumes: ["/data"],
        });
        const labels = (img.details as any).ociLabels;
        expect(labels["org.opencontainers.image.source"]).toBe("https://github.com/org/repo");
        expect(labels["org.opencontainers.image.revision"]).toBe("abc123");
        expect(Object.keys(labels)).toHaveLength(10);
        expect(labels["com.example.custom"]).toBeUndefined();
        expect(labels["org.opencontainers.image.random"]).toBeUndefined();
        expect(validateDiscoveredAsset(img)).toBe(true);
      }
    });

    it("degrades per image — a failed inspect still emits the asset without details", async () => {
      mocks.listImages.mockResolvedValue([
        { Id: "sha256:good", RepoTags: ["ok:1"], RepoDigests: [], Size: 1, Created: 1 },
        { Id: "sha256:bad", RepoTags: ["bad:1"], RepoDigests: [], Size: 1, Created: 1 },
      ]);
      mocks.getImage.mockImplementation((id: string) => ({
        inspect: vi.fn(async () => {
          if (id === "sha256:bad") throw new Error("inspect denied");
          return { ...IMAGE_INSPECT, Id: id };
        }),
      }));
      const { assets } = await run({ targetId: "local", includeImages: true });
      const good = assets.find((a) => a.externalId === "docker-image:ok:1")!;
      const bad = assets.find((a) => a.externalId === "docker-image:bad:1")!;
      expect((good.details as any).architecture).toBe("amd64");
      expect(bad.details).toEqual({ imageId: "sha256:bad", size: 1, created: 1 });
      expect(validateDiscoveredAsset(bad)).toBe(true);
    });

    it("makes zero inspect calls when includeImages is off", async () => {
      mockImages();
      await run({ targetId: "local" });
      expect(mocks.listImages).not.toHaveBeenCalled();
      expect(mocks.getImage).not.toHaveBeenCalled();
    });
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
  it("probes via version only, sanitizes errors, fails without a resolved target", async () => {
    const ok = await importer.testSecrets({ clientCert: "PEM" }, { targetId: "t" }, { transport: "socket", path: "/x" });
    expect(ok.ok).toBe(true);
    expect(mocks.version).toHaveBeenCalled();
    expect(mocks.listContainers).not.toHaveBeenCalled();
    const noTarget = await importer.testSecrets({}, {}, undefined);
    expect(noTarget.ok).toBe(false);
    mocks.version.mockRejectedValueOnce(new Error("dial fail PEM"));
    const bad = await importer.testSecrets({ clientKey: "PEMMATERIAL" }, {}, { transport: "socket", path: "/x" });
    expect(bad.ok).toBe(false);
    expect(bad.error).not.toContain("PEMMATERIAL");
  });
});
