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
  execFile: vi.fn(),
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

// The Syft fallback shells out through execFile — stub the promisified
// call so tests can serve a CycloneDX document without a syft binary.
vi.mock("node:child_process", () => ({
  execFile: Object.assign(() => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: mocks.execFile,
  }),
}));

import { DockerImporter } from "../src/importer.js";
import { dockerConfigSchema } from "../src/config.js";
import { manifest } from "../src/manifest.js";
import {
  validateDiscoveredAsset,
  NOOP_LOGGER,
  type DiscoveredAsset,
  type ImporterContext,
} from "@componode/core";

// Spec 078 / ADR-133 — importer-docker as declared-edge carrier 3.
// Every bom-bearing asset (workload CONTAINER + docker-image PACKAGE_REGISTRY)
// declares the document's SUBJECT→package edges; LIBRARY assets carry
// package→package edges and package→docker-image:{digest} edges.

const SOCKET_PROFILE = { transport: "socket", path: "/var/run/docker.sock" };
const DIGEST = `library/nginx@sha256:${"a".repeat(64)}`;
const IMAGE_EXTERNAL_ID = `docker-image:${DIGEST}`;

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

const pkg = (name: string, version: string) => ({
  type: "library",
  "bom-ref": `pkg:deb/debian/${name}@${version}`,
  purl: `pkg:deb/debian/${name}@${version}`,
  name,
  version,
});

// subject root → bash + openssl; bash → glibc; glibc → root (package→subject).
const CDX_DOC = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: {
    component: { type: "container", name: "library/nginx", "bom-ref": "root" },
  },
  components: [pkg("bash", "5.2.15"), pkg("glibc", "2.36"), pkg("openssl", "3.0")],
  dependencies: [
    { ref: "root", dependsOn: ["pkg:deb/debian/bash@5.2.15", "pkg:deb/debian/openssl@3.0"] },
    { ref: "pkg:deb/debian/bash@5.2.15", dependsOn: ["pkg:deb/debian/glibc@2.36"] },
    { ref: "pkg:deb/debian/glibc@2.36", dependsOn: ["root"] },
    { ref: "pkg:deb/debian/openssl@3.0", dependsOn: [] },
  ],
};

const CDX_NO_GRAPH_DOC = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: {
    component: { type: "container", name: "library/nginx", "bom-ref": "root" },
  },
  components: [pkg("bash", "5.2.15"), pkg("openssl", "3.0")],
};

function mockRegistry(routes: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    for (const [pattern, resp] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        const r = resp as { status?: number; body: unknown };
        return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
      }
    }
    return new Response("Not Found", { status: 404 });
  });
}

const REFERRER_INDEX = {
  schemaVersion: 2,
  manifests: [
    {
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: `sha256:${"b".repeat(64)}`,
      artifactType: "application/vnd.cyclonedx+json",
      size: 100,
    },
  ],
};
const REFERRER_MANIFEST = {
  schemaVersion: 2,
  layers: [{ digest: `sha256:${"c".repeat(64)}`, size: 500 }],
};

function sbomRoutes(doc: unknown) {
  return {
    [`/referrers/sha256:${"a".repeat(64)}`]: { body: REFERRER_INDEX },
    [`/manifests/sha256:${"b".repeat(64)}`]: { body: REFERRER_MANIFEST },
    [`/blobs/sha256:${"c".repeat(64)}`]: { body: doc },
  };
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

async function collectAssets(config: Record<string, unknown>) {
  const importer = new DockerImporter();
  const assets: DiscoveredAsset[] = [];
  for await (const asset of importer.run(config, {}, makeContext())) {
    assets.push(asset);
  }
  return assets;
}

function setupOneContainer(id: string, image = "nginx:latest", digests: string[] | null = [DIGEST]) {
  mocks.listContainers.mockResolvedValue([{ Id: id }]);
  mocks.getContainer.mockImplementation((cid: string) => ({
    inspect: async () => makeContainerInspect(cid, image),
  }));
  mocks.getImage.mockImplementation(() => ({
    inspect: async () => ({ RepoDigests: digests }),
  }));
}

const workloadId = (id: string) => `docker-engine:engine-1::${id}`;
const rel = (target: string) => ({ type: "DEPENDS_ON", targetExternalId: target });

describe("docker importDeclaredEdges — config + manifest", () => {
  it("defaults the opt-in off and requires includeSbom", () => {
    const parsed = dockerConfigSchema.parse({ targetId: "socket" });
    expect(parsed.importDeclaredEdges).toBe(false);
    expect(() =>
      dockerConfigSchema.parse({ targetId: "socket", importDeclaredEdges: true }),
    ).toThrow();
    const ok = dockerConfigSchema.parse({
      targetId: "socket",
      includeSbom: true,
      importDeclaredEdges: true,
    });
    expect(ok.importDeclaredEdges).toBe(true);
  });

  it("declares the scope key on the manifest", () => {
    expect(manifest.declaredEdgesConfigKey).toBe("importDeclaredEdges");
  });
});

describe("docker importDeclaredEdges — emission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupEngine();
  });

  it("attaches subject edges to the workload and yields LIBRARY assets", async () => {
    setupOneContainer("c1");
    mockRegistry(sbomRoutes(CDX_DOC));

    const assets = await collectAssets({
      targetId: "socket",
      includeSbom: true,
      importDeclaredEdges: true,
    });
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);

    const workload = assets.find((a) => a.externalId === workloadId("c1"))!;
    expect(workload.bomEntries).toBeDefined();
    expect(workload.relationships).toEqual([
      rel("pkg:deb/debian/bash"),
      rel("pkg:deb/debian/openssl"),
    ]);

    const libs = assets.filter((a) => a.category === "LIBRARY");
    expect(libs.map((l) => l.externalId).sort()).toEqual([
      "pkg:deb/debian/bash",
      "pkg:deb/debian/glibc",
      "pkg:deb/debian/openssl",
    ]);
    const bash = libs.find((l) => l.externalId === "pkg:deb/debian/bash")!;
    expect(bash.relationships).toEqual([rel("pkg:deb/debian/glibc")]);
    const glibc = libs.find((l) => l.externalId === "pkg:deb/debian/glibc")!;
    // package → SUBJECT resolves to the canonical image identity.
    expect(glibc.relationships).toEqual([rel(IMAGE_EXTERNAL_ID)]);
    const openssl = libs.find((l) => l.externalId === "pkg:deb/debian/openssl")!;
    expect(openssl.relationships).toBeUndefined();
  });

  it("attaches subject edges to the docker-image asset when includeImages is on", async () => {
    setupOneContainer("c1");
    mocks.listImages.mockResolvedValue([
      {
        Id: `sha256:${"d".repeat(64)}`,
        RepoDigests: [DIGEST],
        RepoTags: ["library/nginx:latest"],
        Created: 1699000000,
        Size: 100,
      },
    ]);
    mockRegistry(sbomRoutes(CDX_DOC));

    const assets = await collectAssets({
      targetId: "socket",
      includeSbom: true,
      includeImages: true,
      importDeclaredEdges: true,
    });
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);

    const image = assets.find((a) => a.externalId === IMAGE_EXTERNAL_ID)!;
    expect(image).toBeDefined();
    expect(image.relationships).toEqual([
      rel("pkg:deb/debian/bash"),
      rel("pkg:deb/debian/openssl"),
    ]);
    // Both carriers declare; LIBRARY yields still dedup to one per identity.
    expect(
      assets.filter((a) => a.externalId === "pkg:deb/debian/bash"),
    ).toHaveLength(1);
  });

  it("gives each workload sharing a digest its own subject edges, deduping libraries", async () => {
    mocks.listContainers.mockResolvedValue([{ Id: "c1" }, { Id: "c2" }]);
    mocks.getContainer.mockImplementation((cid: string) => ({
      inspect: async () => makeContainerInspect(cid, "nginx:latest"),
    }));
    mocks.getImage.mockImplementation(() => ({
      inspect: async () => ({ RepoDigests: [DIGEST] }),
    }));
    mockRegistry(sbomRoutes(CDX_DOC));

    const assets = await collectAssets({
      targetId: "socket",
      includeSbom: true,
      importDeclaredEdges: true,
    });
    const w1 = assets.find((a) => a.externalId === workloadId("c1"))!;
    const w2 = assets.find((a) => a.externalId === workloadId("c2"))!;
    expect(w1.relationships).toEqual(w2.relationships);
    expect(w1.relationships).toHaveLength(2);
    expect(assets.filter((a) => a.category === "LIBRARY")).toHaveLength(3);
  });

  it("unions package→package edges across images sharing a purl (T013)", async () => {
    // Image A's SBOM lists bash but declares no edges from it; image B's
    // SBOM alone declares bash → zlib. The single bash LIBRARY yield
    // must still carry the edge — all package→package edges declare on
    // the one yield regardless of which image's SBOM lists them.
    const DIGEST_B = `library/web@sha256:${"e".repeat(64)}`;
    const DOC_A = {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      metadata: {
        component: { type: "container", name: "library/a", "bom-ref": "root" },
      },
      components: [pkg("bash", "5.2.15")],
      dependencies: [
        { ref: "root", dependsOn: ["pkg:deb/debian/bash@5.2.15"] },
      ],
    };
    const DOC_B = {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      metadata: {
        component: { type: "container", name: "library/b", "bom-ref": "root" },
      },
      components: [pkg("bash", "5.2.15"), pkg("zlib", "1.3")],
      dependencies: [
        { ref: "root", dependsOn: ["pkg:deb/debian/bash@5.2.15"] },
        {
          ref: "pkg:deb/debian/bash@5.2.15",
          dependsOn: ["pkg:deb/debian/zlib@1.3"],
        },
      ],
    };
    mocks.listContainers.mockResolvedValue([{ Id: "c1" }, { Id: "c2" }]);
    mocks.getContainer.mockImplementation((cid: string) => ({
      inspect: async () =>
        makeContainerInspect(cid, cid === "c1" ? "app-a:latest" : "app-b:latest"),
    }));
    mocks.getImage.mockImplementation((ref: string) => ({
      inspect: async () => ({
        RepoDigests: ref === "app-a:latest" ? [DIGEST] : [DIGEST_B],
      }),
    }));
    mockRegistry({
      [`/referrers/sha256:${"a".repeat(64)}`]: { body: REFERRER_INDEX },
      [`/manifests/sha256:${"b".repeat(64)}`]: { body: REFERRER_MANIFEST },
      [`/blobs/sha256:${"c".repeat(64)}`]: { body: DOC_A },
      [`/referrers/sha256:${"e".repeat(64)}`]: {
        body: {
          schemaVersion: 2,
          manifests: [
            {
              ...REFERRER_INDEX.manifests[0],
              digest: `sha256:${"f".repeat(64)}`,
            },
          ],
        },
      },
      [`/manifests/sha256:${"f".repeat(64)}`]: {
        body: {
          schemaVersion: 2,
          layers: [{ digest: `sha256:${"7".repeat(64)}`, size: 500 }],
        },
      },
      [`/blobs/sha256:${"7".repeat(64)}`]: { body: DOC_B },
    });

    const assets = await collectAssets({
      targetId: "socket",
      includeSbom: true,
      importDeclaredEdges: true,
    });
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);

    const bashLibs = assets.filter(
      (a) => a.category === "LIBRARY" && a.externalId === "pkg:deb/debian/bash",
    );
    expect(bashLibs).toHaveLength(1);
    expect(bashLibs[0]!.relationships).toEqual([rel("pkg:deb/debian/zlib")]);
    expect(
      assets.some(
        (a) => a.category === "LIBRARY" && a.externalId === "pkg:deb/debian/zlib",
      ),
    ).toBe(true);
  });

  it("emits the same edge contract from the Syft fallback (T014)", async () => {
    // Referrers 404 → fetchImageBom falls back to `syft registry:…`;
    // the CycloneDX document it returns must produce the identical
    // relationships[]/LIBRARY contract (SC-001 collection-path parity).
    setupOneContainer("c1");
    mockRegistry({});
    mocks.execFile.mockResolvedValue({
      stdout: JSON.stringify(CDX_DOC),
      stderr: "",
    });

    const assets = await collectAssets({
      targetId: "socket",
      includeSbom: true,
      importDeclaredEdges: true,
    });
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);

    expect(mocks.execFile).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        `registry:library/nginx@sha256:${"a".repeat(64)}`,
      ]),
      expect.anything(),
    );
    const workload = assets.find((a) => a.externalId === workloadId("c1"))!;
    expect(workload.relationships).toEqual([
      rel("pkg:deb/debian/bash"),
      rel("pkg:deb/debian/openssl"),
    ]);
    const bash = assets.find((a) => a.externalId === "pkg:deb/debian/bash")!;
    expect(bash.relationships).toEqual([rel("pkg:deb/debian/glibc")]);
    const glibc = assets.find((a) => a.externalId === "pkg:deb/debian/glibc")!;
    expect(glibc.relationships).toEqual([rel(IMAGE_EXTERNAL_ID)]);
  });

  it("emits an authoritative-empty relationships set when the doc has no graph", async () => {
    setupOneContainer("c1");
    mockRegistry(sbomRoutes(CDX_NO_GRAPH_DOC));

    const assets = await collectAssets({
      targetId: "socket",
      includeSbom: true,
      importDeclaredEdges: true,
    });
    const workload = assets.find((a) => a.externalId === workloadId("c1"))!;
    expect(workload.bomEntries).toBeDefined();
    expect(workload.relationships).toEqual([]);
    // Packages still become LIBRARY components — just without edges.
    expect(assets.filter((a) => a.category === "LIBRARY")).toHaveLength(2);
    for (const lib of assets.filter((a) => a.category === "LIBRARY")) {
      expect(lib.relationships).toBeUndefined();
    }
  });

  it("omits relationships entirely for bomless/degraded carriers", async () => {
    setupOneContainer("c1", "local-only:latest", null);
    mockRegistry({});

    const assets = await collectAssets({
      targetId: "socket",
      includeSbom: true,
      importDeclaredEdges: true,
    });
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);
    const workload = assets.find((a) => a.externalId === workloadId("c1"))!;
    expect("bomEntries" in workload).toBe(false);
    expect("relationships" in workload).toBe(false);
    expect(assets.filter((a) => a.category === "LIBRARY")).toHaveLength(0);
  });

  it("degrades only the failed carrier when one image's SBOM is missing (T005)", async () => {
    mocks.listContainers.mockResolvedValue([{ Id: "c1" }, { Id: "c2" }]);
    mocks.getContainer.mockImplementation((cid: string) => ({
      inspect: async () =>
        makeContainerInspect(cid, cid === "c1" ? "nginx:latest" : "local:latest"),
    }));
    mocks.getImage.mockImplementation((ref: string) => ({
      inspect: async () => ({
        RepoDigests: ref === "nginx:latest" ? [DIGEST] : null,
      }),
    }));
    mockRegistry(sbomRoutes(CDX_DOC));

    const assets = await collectAssets({
      targetId: "socket",
      includeSbom: true,
      importDeclaredEdges: true,
    });
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);
    const declaring = assets.find((a) => a.externalId === workloadId("c1"))!;
    const degraded = assets.find((a) => a.externalId === workloadId("c2"))!;
    expect(declaring.relationships).toHaveLength(2);
    expect("relationships" in degraded).toBe(false);
    expect(assets.filter((a) => a.category === "LIBRARY")).toHaveLength(3);
  });

  it("emits no relationships and no LIBRARY assets when the opt-in is off", async () => {
    setupOneContainer("c1");
    mockRegistry(sbomRoutes(CDX_DOC));

    const assets = await collectAssets({
      targetId: "socket",
      includeSbom: true,
    });
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);
    const workload = assets.find((a) => a.externalId === workloadId("c1"))!;
    expect(workload.bomEntries).toBeDefined();
    expect("relationships" in workload).toBe(false);
    expect(assets.filter((a) => a.category === "LIBRARY")).toHaveLength(0);
  });
});
