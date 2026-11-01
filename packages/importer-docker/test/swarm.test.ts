import { describe, it, expect, vi, beforeEach } from "vitest";

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
  }
  return { default: DockerMock };
});

import { DockerImporter } from "../src/importer.js";
import {
  mapSwarmService,
  mapSwarmNode,
  mapSwarmSecret,
  swarmServiceStatus,
  swarmNodeStatus,
  type SwarmService,
  type SwarmNode,
  type SwarmSecret,
} from "../src/swarm.js";
import { validateDiscoveredAsset, NOOP_LOGGER, type ImporterContext } from "@componode/core";

const SOCKET_PROFILE = { transport: "socket", path: "/var/run/docker.sock" };
const CONFIG = { targetId: "t1" };

function makeContext(): ImporterContext & {
  reportSourceIdentity: ReturnType<typeof vi.fn>;
} {
  return {
    runId: "run-1",
    logger: NOOP_LOGGER,
    signal: new AbortController().signal,
    reportPhase: vi.fn(),
    reportSourceIdentity: vi.fn(),
    resolveTarget: vi.fn(() => SOCKET_PROFILE),
  };
}

async function collect(cfg: Record<string, unknown> = CONFIG) {
  const assets = [];
  for await (const a of new DockerImporter().run(cfg, {}, makeContext())) {
    assets.push(a);
  }
  return assets;
}

function service(over: Partial<SwarmService> = {}): SwarmService {
  return {
    ID: "svc1",
    Spec: {
      Name: "shop_web",
      Labels: { "com.docker.stack.namespace": "shop" },
      Mode: { Replicated: { Replicas: 3 } },
      TaskTemplate: {
        ContainerSpec: { Image: "nginx:1.27" },
        Secrets: [{ SecretID: "sec1", SecretName: "api-key" }],
        Configs: [{ ConfigID: "cfg1", ConfigName: "nginx.conf" }],
      },
    },
    ServiceStatus: { RunningTasks: 3, DesiredTasks: 3 },
    ...over,
  };
}

function node(over: Partial<SwarmNode> = {}): SwarmNode {
  return {
    ID: "node1",
    Spec: { Name: "worker-1", Role: "worker", Availability: "active" },
    Status: { State: "ready", Addr: "10.0.0.2" },
    ...over,
  };
}

function secret(over: Partial<SwarmSecret> = {}): SwarmSecret {
  return { ID: "sec1", Spec: { Name: "api-key" }, Version: { Index: 7 }, ...over };
}

function swarmInfo(over: Record<string, unknown> = {}) {
  return {
    ID: "eng-1",
    Name: "mgr-1",
    Swarm: { LocalNodeState: "active", ControlAvailable: true, ...over },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.info.mockResolvedValue(swarmInfo());
  mocks.version.mockResolvedValue({ ApiVersion: "1.45" });
  mocks.listServices.mockResolvedValue([]);
  mocks.listNodes.mockResolvedValue([]);
  mocks.listSecrets.mockResolvedValue([]);
  mocks.listContainers.mockResolvedValue([]);
  mocks.listImages.mockResolvedValue([]);
});

describe("swarm discovery gate (ADR-121 A2)", () => {
  it("skips all swarm calls when Swarm is inactive", async () => {
    mocks.info.mockResolvedValue({ ID: "eng-1", Swarm: { LocalNodeState: "inactive" } });
    await collect();
    expect(mocks.listServices).not.toHaveBeenCalled();
    expect(mocks.listNodes).not.toHaveBeenCalled();
    expect(mocks.listSecrets).not.toHaveBeenCalled();
    expect(mocks.version).not.toHaveBeenCalled();
  });

  it("skips swarm on a worker-only endpoint (ControlAvailable false)", async () => {
    mocks.info.mockResolvedValue(swarmInfo({ ControlAvailable: false }));
    await collect();
    expect(mocks.listServices).not.toHaveBeenCalled();
  });

  it("skips swarm when info carries no Swarm block", async () => {
    mocks.info.mockResolvedValue({ ID: "eng-1" });
    await collect();
    expect(mocks.listServices).not.toHaveBeenCalled();
  });

  it("fails the run below the 1.41 API floor", async () => {
    mocks.version.mockResolvedValue({ ApiVersion: "1.40" });
    await expect(collect()).rejects.toThrow(/1\.41/);
    expect(mocks.listServices).not.toHaveBeenCalled();
  });
});

describe("service status table", () => {
  it.each([
    [3, 3, "RUNNING"],
    [2, 3, "ERROR"],
    [0, 3, "ERROR"],
    [0, 0, "STOPPED"],
  ] as const)("running=%i desired=%i → %s", (running, desired, expected) => {
    expect(swarmServiceStatus(running, desired)).toBe(expected);
  });
});

describe("mapSwarmService", () => {
  it("emits a CONTAINER_ORCHESTRATION component with stack-distinct identity", () => {
    const a = mapSwarmService(service(), "src:e1", undefined, undefined);
    expect(a.category).toBe("CONTAINER_ORCHESTRATION");
    expect(a.resourceType).toBe("swarm-service");
    expect(a.name).toBe("shop_web");
    expect(a.externalId).toContain("swarm-service:shop_web");
    expect(a.details).toMatchObject({
      mode: "replicated",
      stack: "shop",
      image: "nginx:1.27",
      secretRefs: [{ id: "sec1", name: "api-key" }],
      configRefs: [{ id: "cfg1", name: "nginx.conf" }],
    });
    expect(validateDiscoveredAsset(a)).toBe(true);
    const b = mapSwarmService(service({ ID: "svc2", Spec: { ...service().Spec, Name: "other_web" } }), "src:e1", undefined, undefined);
    expect(b.externalId).not.toBe(a.externalId);
    expect(b.instances[0]!.externalId).not.toBe(a.instances[0]!.externalId);
  });

  it("records an allowlisted swarmObservation and instance externalId by ID", () => {
    const a = mapSwarmService(service({ ServiceStatus: { RunningTasks: 2, DesiredTasks: 3 }, UpdateStatus: { State: "updating" } }), "src:e1", undefined, undefined);
    const inst = a.instances[0]!;
    expect(inst.externalId).toContain("::swarm-service:svc1");
    expect(inst.status).toBe("ERROR");
    const obs = inst.rawConfig!.swarmObservation as Record<string, unknown>;
    expect(Object.keys(obs).sort()).toEqual(["desired", "mode", "observedAt", "running", "updateState"]);
    expect(obs).toMatchObject({ mode: "replicated", desired: 3, running: 2, updateState: "updating" });
  });

  it("prefers manager DesiredTasks over Spec.Replicas (contract)", () => {
    const a = mapSwarmService(
      service({ ServiceStatus: { RunningTasks: 2, DesiredTasks: 2 } }),
      "src:e1", undefined, undefined,
    );
    // Spec says 3 replicas; manager reports desired=2 → 2/2 = RUNNING.
    expect(a.instances[0]!.status).toBe("RUNNING");
    expect((a.instances[0]!.rawConfig!.swarmObservation as { desired: number }).desired).toBe(2);
  });

  it("maps global-mode via manager counts only", () => {
    const a = mapSwarmService(
      service({ Spec: { Name: "monitor_agent", Mode: { Global: {} } }, ServiceStatus: { RunningTasks: 4, DesiredTasks: 5 } }),
      "src:e1", undefined, undefined,
    );
    expect((a.instances[0]!.rawConfig!.swarmObservation as { mode: string }).mode).toBe("global");
    expect(a.instances[0]!.status).toBe("ERROR");
  });

  it("applies envLabel/envMap to the aggregate instance", () => {
    const a = mapSwarmService(
      service({ Spec: { ...service().Spec, Labels: { env: "prod" } } }),
      "src:e1", "env", { prod: "PRODUCTION" },
    );
    expect(a.instances[0]!.environment).toBe("PRODUCTION");
  });
});

describe("node status table", () => {
  it("ready+active → RUNNING; drain/pause → STOPPED; down/unreachable/unknown → ERROR", () => {
    expect(swarmNodeStatus(node())).toBe("RUNNING");
    expect(swarmNodeStatus(node({ Spec: { ...node().Spec, Availability: "drain" } }))).toBe("STOPPED");
    expect(swarmNodeStatus(node({ Spec: { ...node().Spec, Availability: "pause" } }))).toBe("STOPPED");
    expect(swarmNodeStatus(node({ Status: { State: "down" } }))).toBe("ERROR");
    expect(swarmNodeStatus(node({ ManagerStatus: { Reachability: "unreachable" } }))).toBe("ERROR");
    // Missing/unknown availability is not "active" — fails closed per contract.
    expect(swarmNodeStatus(node({ Spec: { ...node().Spec, Availability: undefined } }))).toBe("ERROR");
    expect(swarmNodeStatus(node({ Spec: { ...node().Spec, Availability: "unknown" } }))).toBe("ERROR");
    expect(swarmNodeStatus({} as SwarmNode)).toBe("ERROR");
  });
});

describe("mapSwarmNode", () => {
  it("emits a COMPUTE component with bounded facts", () => {
    const a = mapSwarmNode(node({ ManagerStatus: { Reachability: "reachable", Leader: true } }), "src:e1");
    expect(a.category).toBe("COMPUTE");
    expect(a.resourceType).toBe("swarm-node");
    expect(a.instances).toHaveLength(1);
    expect(a.instances[0]!.status).toBe("RUNNING");
    expect(a.instances[0]!.rawConfig!.swarmNodeObservation).toMatchObject({
      role: "worker", availability: "active", reachability: "reachable", leader: true, state: "ready", addr: "10.0.0.2",
    });
    expect(validateDiscoveredAsset(a)).toBe(true);
  });
});

describe("mapSwarmSecret", () => {
  it("emits a metadata-only SECRET component with no instances and no content", () => {
    const a = mapSwarmSecret(secret(), "src:e1");
    expect(a.category).toBe("SECRET");
    expect(a.resourceType).toBe("swarm-secret");
    expect(a.instances).toEqual([]);
    expect(a.details).toEqual({ secretId: "sec1", revision: 7 });
    expect(JSON.stringify(a)).not.toContain("LS0t");
  });
});

describe("importer swarm emission", () => {
  it("emits all three surfaces on a manager and passes validateDiscoveredAsset", async () => {
    mocks.listServices.mockResolvedValue([service()]);
    mocks.listNodes.mockResolvedValue([node()]);
    mocks.listSecrets.mockResolvedValue([secret()]);
    const assets = await collect();
    const kinds = assets.map((a) => a.resourceType).sort();
    expect(kinds).toEqual(["swarm-node", "swarm-secret", "swarm-service"]);
    expect(assets.every((a) => validateDiscoveredAsset(a))).toBe(true);
    expect(mocks.listServices).toHaveBeenCalledWith({ status: true });
  });
});
