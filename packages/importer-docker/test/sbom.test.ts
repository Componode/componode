import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  version: vi.fn(),
  listContainers: vi.fn(),
  listImages: vi.fn(),
  listServices: vi.fn(),
  listNodes: vi.fn(),
  listSecrets: vi.fn(),
  listNetworks: vi.fn(),
  listVolumes: vi.fn(),
  df: vi.fn(),
  ping: vi.fn(),
  getContainer: vi.fn(),
  getImage: vi.fn(),
  getNetwork: vi.fn(),
}));

vi.mock("dockerode", () => {
  class DockerMock {
    constructor(_opts: unknown) {}
    info = mocks.info;
    version = mocks.version;
    listContainers = mocks.listContainers;
    listImages = mocks.listImages;
    listServices = mocks.listServices;
    listNodes = mocks.listNodes;
    listSecrets = mocks.listSecrets;
    listNetworks = mocks.listNetworks;
    listVolumes = mocks.listVolumes;
    df = mocks.df;
    ping = mocks.ping;
    getContainer = mocks.getContainer;
    getImage = mocks.getImage;
    getNetwork = mocks.getNetwork;
  }
  return { default: DockerMock };
});

import { DockerImporter } from "../src/importer.js";
import {
  validateDiscoveredAsset,
  NOOP_LOGGER,
  type DiscoveredAsset,
  type ImporterContext,
} from "@componode/core";

const SOCKET_PROFILE = { transport: "socket", path: "/var/run/docker.sock" };

function makeContext(): ImporterContext {
  return {
    runId: "run-1",
    logger: NOOP_LOGGER,
    signal: new AbortController().signal,
    reportPhase: vi.fn(),
    reportSourceIdentity: vi.fn(),
    resolveTarget: vi.fn(() => SOCKET_PROFILE),
  };
}

function makeContainerInspect(id: string, image: string) {
  return {
    Id: id,
    Name: `/${id}`,
    Config: { Image: image, Labels: {} },
    State: { Status: "running" },
    Image: `sha256:${id}config`,
    NetworkSettings: {},
  };
}

const CDX_DOC = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: {
    component: { type: "container", name: "library/nginx", "bom-ref": "root" },
    tools: [{ name: "syft", version: "1.0.0" }],
  },
  components: [
    {
      type: "library",
      "bom-ref": "pkg:deb/debian/bash@5.2.15",
      purl: "pkg:deb/debian/bash@5.2.15",
      name: "bash",
      version: "5.2.15",
      scope: "required",
      components: [
        {
          type: "library",
          purl: "pkg:deb/debian/glibc@2.36",
          name: "glibc",
          version: "2.36",
        },
      ],
    },
    {
      type: "library",
      purl: "pkg:deb/debian/openssl@3.0",
      name: "openssl",
      version: "3.0",
      scope: "optional",
    },
  ],
};

// OCI referrers mocks — registry calls go through global fetch.
function mockRegistry(routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    for (const [pattern, resp] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        const r = resp as { status?: number; body: unknown; headers?: Record<string, string> };
        return new Response(
          typeof r.body === "string" ? r.body : JSON.stringify(r.body),
          { status: r.status ?? 200, headers: r.headers },
        );
      }
    }
    return new Response("Not Found", { status: 404 });
  });
}

function setupEngine() {
  mocks.info.mockResolvedValue({ ID: "engine-1", Name: "test", Swarm: {} });
  mocks.version.mockResolvedValue({ ApiVersion: "1.45" });
  mocks.listServices.mockResolvedValue([]);
  mocks.listNodes.mockResolvedValue([]);
  mocks.listSecrets.mockResolvedValue([]);
  mocks.listNetworks.mockResolvedValue([]);
  mocks.listVolumes.mockResolvedValue({ Volumes: [] });
  mocks.df.mockResolvedValue({ Volumes: [] });
  mocks.listImages.mockResolvedValue([]);
}

const REFERRER_INDEX = {
  schemaVersion: 2,
  manifests: [
    {
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      artifactType: "application/vnd.cyclonedx+json",
      size: 100,
    },
  ],
};

const REFERRER_MANIFEST = {
  schemaVersion: 2,
  layers: [{ digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", size: 500 }],
};

async function collectAssets(config: Record<string, unknown>) {
  const importer = new DockerImporter();
  const assets: DiscoveredAsset[] = [];
  for await (const asset of importer.run(config, {}, makeContext())) {
    assets.push(asset);
  }
  return assets;
}

describe("docker includeSbom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupEngine();
  });

  it("attaches referrers CycloneDX attestations as nested bomEntries on the workload", async () => {
    mocks.listContainers.mockResolvedValue([{ Id: "c1" }]);
    mocks.getContainer.mockImplementation((id: string) => ({
      inspect: async () => makeContainerInspect(id, "nginx:latest"),
    }));
    mocks.getImage.mockImplementation(() => ({
      inspect: async () => ({
        RepoDigests: ["library/nginx@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      }),
    }));
    mockRegistry({
      "/referrers/sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": { body: REFERRER_INDEX },
      "/manifests/sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": { body: REFERRER_MANIFEST },
      "/blobs/sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc": { body: CDX_DOC },
    });

    const assets = await collectAssets({ targetId: "socket", includeSbom: true });
    const workload = assets.find((a) => a.resourceType === "container")!;
    expect(workload.bomEntries).toBeDefined();
    const names = workload.bomEntries!.map((e) => e.name).sort();
    expect(names).toEqual(["bash", "openssl"]);
    const bash = workload.bomEntries!.find((e) => e.name === "bash")!;
    expect(bash.evidenceSource).toBe("IMAGE_LAYER");
    expect(bash.children?.[0]?.name).toBe("glibc"); // nested layers preserved
    expect(bash.evidenceDetail).toContain("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(workload.bomEntries!.find((e) => e.name === "openssl")?.scope).toBe("OPTIONAL");
    expect(validateDiscoveredAsset(workload)).toBe(true);

    const caps = (workload.details as Record<string, unknown>).capabilities as Record<
      string,
      { status: string }
    >;
    expect(caps.bomInventory.status).toBe("OK");
  });

  it("omits bomEntries and marks bomInventory degraded for images without attestations", async () => {
    mocks.listContainers.mockResolvedValue([{ Id: "c2" }]);
    mocks.getContainer.mockImplementation((id: string) => ({
      inspect: async () => makeContainerInspect(id, "local-only:latest"),
    }));
    mocks.getImage.mockImplementation(() => ({
      inspect: async () => ({ RepoDigests: null }), // local build — no digest
    }));
    const fetchSpy = mockRegistry({});

    const assets = await collectAssets({ targetId: "socket", includeSbom: true });
    const workload = assets.find((a) => a.resourceType === "container")!;
    expect("bomEntries" in workload).toBe(false);
    const caps = (workload.details as Record<string, unknown>).capabilities as Record<
      string,
      { status: string }
    >;
    expect(caps.bomInventory.status).not.toBe("OK");
    // No registry calls were possible — nothing to request.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(validateDiscoveredAsset(workload)).toBe(true);
  });

  it("does no SBOM work at all when includeSbom is off", async () => {
    mocks.listContainers.mockResolvedValue([{ Id: "c3" }]);
    mocks.getContainer.mockImplementation((id: string) => ({
      inspect: async () => makeContainerInspect(id, "nginx:latest"),
    }));
    const fetchSpy = mockRegistry({});
    const assets = await collectAssets({ targetId: "socket" });
    const workload = assets.find((a) => a.resourceType === "container")!;
    expect("bomEntries" in workload).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.getImage).not.toHaveBeenCalled();
  });
});
