import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KubernetesImporter } from "../src/importer.js";
import {
  validateDiscoveredAsset,
  NOOP_LOGGER,
  type DiscoveredAsset,
  type ImporterContext,
} from "@componode/core";

function makeContext(): ImporterContext {
  return {
    runId: "run-1",
    logger: NOOP_LOGGER,
    signal: new AbortController().signal,
    reportPhase: vi.fn(),
    reportSourceIdentity: vi.fn(),
    resolveTarget: vi.fn(),
  };
}

const DIGEST = "a".repeat(64);

const POD_LIST = {
  items: [
    {
      metadata: {
        name: "web-abc",
        ownerReferences: [
          { kind: "ReplicaSet", name: "web-abc", apiVersion: "apps/v1" },
        ],
      },
      spec: {
        containers: [
          { name: "web", image: `nginx@sha256:${DIGEST}` },
          { name: "sidecar", image: "busybox:latest" },
        ],
      },
    },
  ],
};

const REPLICASET = {
  metadata: {
    name: "web-abc",
    ownerReferences: [
      { kind: "Deployment", name: "web", apiVersion: "apps/v1" },
    ],
  },
};

const SPDX_DOC = {
  spdxVersion: "SPDX-2.3",
  SPDXID: "SPDXRef-DOCUMENT",
  documentDescribes: ["SPDXRef-image"],
  packages: [
    { SPDXID: "SPDXRef-image", name: "nginx" },
    {
      SPDXID: "SPDXRef-pkg-bash",
      name: "bash",
      versionInfo: "5.2.15",
      externalRefs: [
        { referenceType: "purl", referenceLocator: "pkg:deb/debian/bash@5.2.15" },
      ],
    },
  ],
  relationships: [
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relatedSpdxElement: "SPDXRef-image",
      relationshipType: "DESCRIBES",
    },
    {
      spdxElementId: "SPDXRef-pkg-bash",
      relatedSpdxElement: "SPDXRef-image",
      relationshipType: "DEPENDENCY_OF",
    },
  ],
};

const REFERRER_INDEX = {
  manifests: [
    {
      digest: `sha256:${"b".repeat(64)}`,
      artifactType: "application/vnd.spdx+json",
    },
  ],
};

function mockApi(routes: Record<string, { status?: number; body: unknown }>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    for (const [pattern, resp] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(resp.body), {
          status: resp.status ?? 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("Not Found", { status: 404 });
  });
}

async function collectAssets(config: Record<string, unknown>) {
  const importer = new KubernetesImporter();
  const assets: DiscoveredAsset[] = [];
  for await (const asset of importer.run(config, {}, makeContext())) {
    assets.push(asset);
  }
  return assets;
}

const CONFIG = {
  endpoint: "https://k8s.example.test",
  namespace: "prod",
  resourceTypes: ["apps/v1:Deployment"],
  includePodImageSbom: true,
};

describe("kubernetes includePodImageSbom", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("attaches pod image SBOMs to the workload asset with image-ref evidenceDetail", async () => {
    mockApi({
      "/api/v1/namespaces/prod/pods": { body: POD_LIST },
      "/apis/apps/v1/namespaces/prod/replicasets/web-abc": { body: REPLICASET },
      [`/referrers/sha256:${DIGEST}`]: { body: REFERRER_INDEX },
      [`/manifests/sha256:${"b".repeat(64)}`]: {
        body: { layers: [{ digest: `sha256:${"c".repeat(64)}` }] },
      },
      [`/blobs/sha256:${"c".repeat(64)}`]: { body: SPDX_DOC },
    });

    const assets = await collectAssets(CONFIG);
    const workload = assets.find((a) => a.resourceType === "apps/v1:Deployment")!;
    expect(workload.bomEntries).toBeDefined();
    expect(workload.bomEntries!.map((e) => e.name)).toEqual(["bash"]);
    expect(workload.bomEntries![0].evidenceSource).toBe("IMAGE_LAYER");
    expect(workload.bomEntries![0].evidenceDetail).toBe(
      `k8s:pod-spec:image:nginx@sha256:${DIGEST}`,
    );
    // Spec 079 — without the opt-in, a bom-carrying workload emits no
    // `relationships` field and no LIBRARY assets (opt-out parity, FR-006).
    expect("relationships" in workload).toBe(false);
    expect(assets.every((a) => a.category !== "LIBRARY")).toBe(true);
    expect(validateDiscoveredAsset(workload)).toBe(true);
    const caps = (workload.details as Record<string, unknown>).capabilities as Record<
      string,
      { status: string }
    >;
    expect(caps.bomInventory.status).toBe("OK");
  });

  it("reports bomInventory UNAVAILABLE with field absent when the registry has no attestations", async () => {
    mockApi({
      "/api/v1/namespaces/prod/pods": { body: POD_LIST },
      "/apis/apps/v1/namespaces/prod/replicasets/web-abc": { body: REPLICASET },
      [`/referrers/sha256:${DIGEST}`]: { body: { manifests: [] } },
    });

    const assets = await collectAssets(CONFIG);
    const workload = assets.find((a) => a.resourceType === "apps/v1:Deployment")!;
    // busybox:latest has no digest; nginx digest has no attestation — no
    // image resolved an SBOM, so the field is absent (FR-004).
    expect("bomEntries" in workload).toBe(false);
    const caps = (workload.details as Record<string, unknown>).capabilities as Record<
      string,
      { status: string }
    >;
    expect(caps.bomInventory.status).not.toBe("OK");
    expect(validateDiscoveredAsset(workload)).toBe(true);
  });

  it("marks bomInventory UNAVAILABLE when pod listing fails", async () => {
    mockApi({
      "/api/v1/namespaces/prod/pods": { status: 403, body: { message: "forbidden" } },
    });
    const assets = await collectAssets(CONFIG);
    const workload = assets.find((a) => a.resourceType === "apps/v1:Deployment")!;
    expect("bomEntries" in workload).toBe(false);
    const caps = (workload.details as Record<string, unknown>).capabilities as Record<
      string,
      { status: string }
    >;
    expect(caps.bomInventory.status).not.toBe("OK");
  });

  it("does nothing when includePodImageSbom is off", async () => {
    const fetchSpy = mockApi({});
    const assets = await collectAssets({ ...CONFIG, includePodImageSbom: false });
    const workload = assets.find((a) => a.resourceType === "apps/v1:Deployment")!;
    expect("bomEntries" in workload).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
