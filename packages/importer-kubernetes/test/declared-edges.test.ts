import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KubernetesImporter } from "../src/importer.js";
import { collectPodImageBoms } from "../src/k8s-pods.js";
import { kubernetesConfigSchema } from "../src/config.js";
import { manifest } from "../src/manifest.js";
import {
  validateDiscoveredAsset,
  NOOP_LOGGER,
  SPDX_EDGE_SUBJECT,
  type DiscoveredAsset,
  type ImporterContext,
} from "@componode/core";

// Spec 079 / ADR-133 — importer-kubernetes as declared-edge carrier 4.
// The only carrier kind is the workload CONTAINER_ORCHESTRATION asset; each
// carried pod-image document's SUBJECT→package edges land on it. Target-side
// SUBJECT resolves to docker-image:{digestRef} — no such asset is ever
// yielded in a kubernetes run, so those edges drop at the pass (same-run
// scope). LIBRARY assets carry the run-wide union of package→package edges.

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
const DIGEST_B = "e".repeat(64);
const IMAGE_REF = `registry.example.test/lib/nginx@sha256:${DIGEST}`;
const IMAGE_REF_B = `registry.example.test/lib/web@sha256:${DIGEST_B}`;
const IMAGE_EXTERNAL_ID = `docker-image:${IMAGE_REF}`;
const IMAGE_EXTERNAL_ID_B = `docker-image:${IMAGE_REF_B}`;

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
    component: { type: "container", name: "lib/nginx", "bom-ref": "root" },
  },
  components: [pkg("bash", "5.2.15"), pkg("glibc", "2.36"), pkg("openssl", "3.0")],
  dependencies: [
    { ref: "root", dependsOn: ["pkg:deb/debian/bash@5.2.15", "pkg:deb/debian/openssl@3.0"] },
    { ref: "pkg:deb/debian/bash@5.2.15", dependsOn: ["pkg:deb/debian/glibc@2.36"] },
    { ref: "pkg:deb/debian/glibc@2.36", dependsOn: ["root"] },
    { ref: "pkg:deb/debian/openssl@3.0", dependsOn: [] },
  ],
};

// Format parity — the same graph as an SPDX document: bash DEPENDENCY_OF
// image (subject → bash), openssl DEPENDENCY_OF image, bash DEPENDS_ON
// glibc, glibc DEPENDENCY_OF image (glibc → subject).
const SPDX_DOC = {
  spdxVersion: "SPDX-2.3",
  SPDXID: "SPDXRef-DOCUMENT",
  documentDescribes: ["SPDXRef-image"],
  packages: [
    { SPDXID: "SPDXRef-image", name: "lib/nginx" },
    {
      SPDXID: "SPDXRef-pkg-bash",
      name: "bash",
      versionInfo: "5.2.15",
      externalRefs: [
        { referenceType: "purl", referenceLocator: "pkg:deb/debian/bash@5.2.15" },
      ],
    },
    {
      SPDXID: "SPDXRef-pkg-glibc",
      name: "glibc",
      versionInfo: "2.36",
      externalRefs: [
        { referenceType: "purl", referenceLocator: "pkg:deb/debian/glibc@2.36" },
      ],
    },
    {
      SPDXID: "SPDXRef-pkg-openssl",
      name: "openssl",
      versionInfo: "3.0",
      externalRefs: [
        { referenceType: "purl", referenceLocator: "pkg:deb/debian/openssl@3.0" },
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
    {
      spdxElementId: "SPDXRef-pkg-openssl",
      relatedSpdxElement: "SPDXRef-image",
      relationshipType: "DEPENDENCY_OF",
    },
    {
      spdxElementId: "SPDXRef-pkg-bash",
      relatedSpdxElement: "SPDXRef-pkg-glibc",
      relationshipType: "DEPENDS_ON",
    },
    {
      spdxElementId: "SPDXRef-pkg-glibc",
      relatedSpdxElement: "SPDXRef-image",
      relationshipType: "DEPENDS_ON",
    },
  ],
};

const CDX_NO_GRAPH_DOC = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: {
    component: { type: "container", name: "lib/nginx", "bom-ref": "root" },
  },
  components: [pkg("bash", "5.2.15"), pkg("openssl", "3.0")],
};

// A second document for multi-image/multi-workload cases: shares bash,
// declares root → bash + bash → zlib (the edge only this doc knows).
const CDX_DOC_B = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: {
    component: { type: "container", name: "lib/web", "bom-ref": "root" },
  },
  components: [pkg("bash", "5.2.15"), pkg("zlib", "1.3")],
  dependencies: [
    { ref: "root", dependsOn: ["pkg:deb/debian/bash@5.2.15"] },
    { ref: "pkg:deb/debian/bash@5.2.15", dependsOn: ["pkg:deb/debian/zlib@1.3"] },
  ],
};

function podList(containers: { name: string; image: string }[], owner?: { kind: string; name: string }) {
  return {
    items: [
      {
        metadata: {
          name: "web-abc",
          ownerReferences: [owner ?? { kind: "ReplicaSet", name: "web-abc" }],
        },
        spec: { containers },
        status: { containerStatuses: [] },
      },
    ],
  };
}

const REPLICASET = {
  metadata: {
    name: "web-abc",
    ownerReferences: [{ kind: "Deployment", name: "web" }],
  },
};

function referrerIndex(manifestDigest: string, artifactType = "application/vnd.cyclonedx+json") {
  return {
    schemaVersion: 2,
    manifests: [
      {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: manifestDigest,
        size: 100,
        artifactType,
      },
    ],
  };
}

const MANIFEST_DIGEST = `sha256:${"b".repeat(64)}`;
const BLOB_DIGEST = `sha256:${"c".repeat(64)}`;
const MANIFEST = { schemaVersion: 2, layers: [{ digest: BLOB_DIGEST, size: 500 }] };

const MANIFEST_DIGEST_B = `sha256:${"f".repeat(64)}`;
const BLOB_DIGEST_B = `sha256:${"7".repeat(64)}`;
const MANIFEST_B = { schemaVersion: 2, layers: [{ digest: BLOB_DIGEST_B, size: 500 }] };

// Referrers chain for IMAGE_REF (digest A) → CDX doc; IMAGE_REF_B
// (digest B) → CDX_DOC_B when `doc` supplied.
function registryRoutes(doc: unknown, docB?: unknown) {
  const routes: Record<string, { status?: number; body: unknown }> = {
    [`/referrers/sha256:${DIGEST}`]: { body: referrerIndex(MANIFEST_DIGEST) },
    [`/manifests/${MANIFEST_DIGEST}`]: { body: MANIFEST },
    [`/blobs/${BLOB_DIGEST}`]: { body: doc },
  };
  if (docB) {
    routes[`/referrers/sha256:${DIGEST_B}`] = { body: referrerIndex(MANIFEST_DIGEST_B) };
    routes[`/manifests/${MANIFEST_DIGEST_B}`] = { body: MANIFEST_B };
    routes[`/blobs/${BLOB_DIGEST_B}`] = { body: docB };
  }
  return routes;
}

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
  importDeclaredEdges: true,
};

const COLLECT_OPTS = {
  endpoint: "https://k8s.example.test",
  namespace: "prod",
  resourceTypes: ["apps/v1:Deployment"],
  signal: new AbortController().signal,
};

const rel = (target: string) => ({ type: "DEPENDS_ON", targetExternalId: target });
const workloadOf = (assets: DiscoveredAsset[]) =>
  assets.find((a) => a.resourceType === "apps/v1:Deployment")!;

describe("kubernetes importDeclaredEdges — config + manifest", () => {
  it("defaults the opt-in off and requires includePodImageSbom", () => {
    const parsed = kubernetesConfigSchema.parse({ sourceKey: "cluster" });
    expect(parsed.importDeclaredEdges).toBe(false);
    expect(() =>
      kubernetesConfigSchema.parse({ sourceKey: "cluster", importDeclaredEdges: true }),
    ).toThrow();
    const ok = kubernetesConfigSchema.parse({
      sourceKey: "cluster",
      includePodImageSbom: true,
      importDeclaredEdges: true,
    });
    expect(ok.importDeclaredEdges).toBe(true);
  });

  it("accepts the opt-in under a sourceKey-only config (no endpoint)", () => {
    // includePodImageSbom itself degrades to UNAVAILABLE markers without an
    // endpoint — the refine must not invent a stricter constraint (D3).
    const ok = kubernetesConfigSchema.parse({
      sourceKey: "cluster",
      includePodImageSbom: true,
      importDeclaredEdges: true,
    });
    expect(ok.endpoint).toBeUndefined();
  });

  it("declares the scope key on the manifest", () => {
    expect(manifest.declaredEdgesConfigKey).toBe("importDeclaredEdges");
  });
});

describe("collectPodImageBoms — edge plumbing", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("unions each resolved image's document edges with target SUBJECT resolved per digest", async () => {
    mockApi({
      "/api/v1/namespaces/prod/pods": {
        body: podList([
          { name: "web", image: IMAGE_REF },
          { name: "aux", image: IMAGE_REF_B },
        ]),
      },
      "/apis/apps/v1/namespaces/prod/replicasets/web-abc": { body: REPLICASET },
      ...registryRoutes(CDX_DOC, CDX_DOC_B),
    });

    const { perWorkload } = await collectPodImageBoms(COLLECT_OPTS);
    const bom = perWorkload.get("apps/v1:Deployment")!;
    expect(bom.entries).toBeDefined();
    expect(bom.edges).toBeDefined();
    // Source-position SUBJECT stays the sentinel — emission substitutes the
    // workload's own externalId; target-position SUBJECT resolves to the
    // docker-image:{digestRef} of the document that declared it.
    const edges = bom.edges!;
    expect(edges).toContainEqual({ from: SPDX_EDGE_SUBJECT, to: "pkg:deb/debian/bash" });
    expect(edges).toContainEqual({ from: SPDX_EDGE_SUBJECT, to: "pkg:deb/debian/openssl" });
    expect(edges).toContainEqual({ from: "pkg:deb/debian/bash", to: "pkg:deb/debian/glibc" });
    expect(edges).toContainEqual({ from: "pkg:deb/debian/glibc", to: IMAGE_EXTERNAL_ID });
    expect(edges).toContainEqual({ from: "pkg:deb/debian/bash", to: "pkg:deb/debian/zlib" });
    // The shared subject→bash declaration dedupes across both documents.
    expect(
      edges.filter(
        (e) => e.from === SPDX_EDGE_SUBJECT && e.to === "pkg:deb/debian/bash",
      ),
    ).toHaveLength(1);
  });

  it("omits edges when no image resolves an SBOM (field presence rides entries)", async () => {
    mockApi({
      "/api/v1/namespaces/prod/pods": {
        body: podList([{ name: "web", image: "busybox:latest" }]),
      },
      "/apis/apps/v1/namespaces/prod/replicasets/web-abc": { body: REPLICASET },
    });
    const { perWorkload } = await collectPodImageBoms(COLLECT_OPTS);
    const bom = perWorkload.get("apps/v1:Deployment")!;
    expect(bom.entries).toBeUndefined();
    expect(bom.edges).toBeUndefined();
  });
});

describe("kubernetes importDeclaredEdges — emission", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("attaches subject edges to the workload and yields LIBRARY assets", async () => {
    mockApi({
      "/api/v1/namespaces/prod/pods": {
        body: podList([{ name: "web", image: IMAGE_REF }]),
      },
      "/apis/apps/v1/namespaces/prod/replicasets/web-abc": { body: REPLICASET },
      ...registryRoutes(CDX_DOC),
    });

    const assets = await collectAssets(CONFIG);
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);

    const workload = workloadOf(assets);
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
    // package → SUBJECT resolves to the canonical image identity — it will
    // drop at the edge pass (kubernetes yields no docker-image asset), but
    // the declaration is emitted faithfully (carrier-3 rule).
    expect(glibc.relationships).toEqual([rel(IMAGE_EXTERNAL_ID)]);
    const openssl = libs.find((l) => l.externalId === "pkg:deb/debian/openssl")!;
    expect(openssl.relationships).toBeUndefined();
  });

  it("produces the same edge set from an SPDX attestation (format parity)", async () => {
    mockApi({
      "/api/v1/namespaces/prod/pods": {
        body: podList([{ name: "web", image: IMAGE_REF }]),
      },
      "/apis/apps/v1/namespaces/prod/replicasets/web-abc": { body: REPLICASET },
      [`/referrers/sha256:${DIGEST}`]: {
        body: referrerIndex(MANIFEST_DIGEST, "application/vnd.spdx+json"),
      },
      [`/manifests/${MANIFEST_DIGEST}`]: { body: MANIFEST },
      [`/blobs/${BLOB_DIGEST}`]: { body: SPDX_DOC },
    });

    const assets = await collectAssets(CONFIG);
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);
    const workload = workloadOf(assets);
    expect(workload.relationships).toEqual([
      rel("pkg:deb/debian/bash"),
      rel("pkg:deb/debian/openssl"),
    ]);
    const bash = assets.find((a) => a.externalId === "pkg:deb/debian/bash")!;
    expect(bash.relationships).toEqual([rel("pkg:deb/debian/glibc")]);
    const glibc = assets.find((a) => a.externalId === "pkg:deb/debian/glibc")!;
    expect(glibc.relationships).toEqual([rel(IMAGE_EXTERNAL_ID)]);
  });

  it("unions package→package edges across images sharing a purl (run-wide union)", async () => {
    // Two workloads: Deployment runs image A (bash, no bash→zlib), a
    // StatefulSet pod runs image B (the only doc declaring bash→zlib). The
    // single bash LIBRARY yield must carry bash→zlib regardless of which
    // image first yielded it (docker T013 regression guard).
    mockApi({
      "/api/v1/namespaces/prod/pods": {
        body: {
          items: [
            ...podList([{ name: "web", image: IMAGE_REF }]).items,
            {
              metadata: {
                name: "db-0",
                ownerReferences: [{ kind: "StatefulSet", name: "db" }],
              },
              spec: { containers: [{ name: "db", image: IMAGE_REF_B }] },
              status: { containerStatuses: [] },
            },
          ],
        },
      },
      "/apis/apps/v1/namespaces/prod/replicasets/web-abc": { body: REPLICASET },
      ...registryRoutes(
        {
          bomFormat: "CycloneDX",
          specVersion: "1.5",
          metadata: { component: { type: "container", name: "lib/nginx", "bom-ref": "root" } },
          components: [pkg("bash", "5.2.15")],
          dependencies: [{ ref: "root", dependsOn: ["pkg:deb/debian/bash@5.2.15"] }],
        },
        CDX_DOC_B,
      ),
    });

    const assets = await collectAssets({
      ...CONFIG,
      resourceTypes: ["apps/v1:Deployment", "apps/v1:StatefulSet"],
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
    // Both workloads declare their own subject edges.
    const deploy = assets.find((a) => a.resourceType === "apps/v1:Deployment")!;
    const sts = assets.find((a) => a.resourceType === "apps/v1:StatefulSet")!;
    expect(deploy.relationships).toEqual([rel("pkg:deb/debian/bash")]);
    expect(sts.relationships).toEqual([rel("pkg:deb/debian/bash")]);
  });

  it("emits an authoritative-empty relationships set when the doc has no graph", async () => {
    mockApi({
      "/api/v1/namespaces/prod/pods": {
        body: podList([{ name: "web", image: IMAGE_REF }]),
      },
      "/apis/apps/v1/namespaces/prod/replicasets/web-abc": { body: REPLICASET },
      ...registryRoutes(CDX_NO_GRAPH_DOC),
    });

    const assets = await collectAssets(CONFIG);
    const workload = workloadOf(assets);
    expect(workload.bomEntries).toBeDefined();
    expect(workload.relationships).toEqual([]);
    expect(assets.filter((a) => a.category === "LIBRARY")).toHaveLength(2);
    for (const lib of assets.filter((a) => a.category === "LIBRARY")) {
      expect(lib.relationships).toBeUndefined();
    }
  });

  it("omits relationships entirely for marker-only/degraded carriers", async () => {
    // Pod listing forbidden → every workload degrades to a marker, no
    // entries, no relationships field regardless of the opt-in.
    mockApi({
      "/api/v1/namespaces/prod/pods": { status: 403, body: { message: "forbidden" } },
    });
    const assets = await collectAssets(CONFIG);
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);
    const workload = workloadOf(assets);
    expect("bomEntries" in workload).toBe(false);
    expect("relationships" in workload).toBe(false);
    expect(assets.filter((a) => a.category === "LIBRARY")).toHaveLength(0);
  });

  it("omits relationships under a sourceKey-only config (no endpoint)", async () => {
    const fetchSpy = mockApi({});
    const assets = await collectAssets({
      sourceKey: "cluster",
      namespace: "prod",
      resourceTypes: ["apps/v1:Deployment"],
      includePodImageSbom: true,
      importDeclaredEdges: true,
    });
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);
    const workload = workloadOf(assets);
    expect("bomEntries" in workload).toBe(false);
    expect("relationships" in workload).toBe(false);
    // No cluster to query — the marker degrades without any fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("declares only the resolved set when one of two images fails (partial coverage)", async () => {
    mockApi({
      "/api/v1/namespaces/prod/pods": {
        body: podList([
          { name: "web", image: IMAGE_REF },
          { name: "aux", image: IMAGE_REF_B },
        ]),
      },
      "/apis/apps/v1/namespaces/prod/replicasets/web-abc": { body: REPLICASET },
      // Only image A serves an attestation; B's referrers 404 → UNAVAILABLE.
      ...registryRoutes(CDX_DOC),
    });

    const assets = await collectAssets(CONFIG);
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);
    const workload = workloadOf(assets);
    // bomEntries already reports the resolved set as authoritative — edges
    // follow the same doctrine (one completeness rule, not two).
    expect(workload.bomEntries).toBeDefined();
    expect(workload.relationships).toEqual([
      rel("pkg:deb/debian/bash"),
      rel("pkg:deb/debian/openssl"),
    ]);
    // No contribution from image B — zlib is never yielded.
    expect(
      assets.some((a) => a.externalId === "pkg:deb/debian/zlib"),
    ).toBe(false);
    expect(
      assets.filter((a) => a.category === "LIBRARY").map((l) => l.externalId).sort(),
    ).toEqual(["pkg:deb/debian/bash", "pkg:deb/debian/glibc", "pkg:deb/debian/openssl"]);
  });

  it("emits no relationships and no LIBRARY assets when the opt-in is off", async () => {
    mockApi({
      "/api/v1/namespaces/prod/pods": {
        body: podList([{ name: "web", image: IMAGE_REF }]),
      },
      "/apis/apps/v1/namespaces/prod/replicasets/web-abc": { body: REPLICASET },
      ...registryRoutes(CDX_DOC),
    });

    const assets = await collectAssets({
      endpoint: "https://k8s.example.test",
      namespace: "prod",
      resourceTypes: ["apps/v1:Deployment"],
      includePodImageSbom: true,
    });
    for (const a of assets) expect(validateDiscoveredAsset(a)).toBe(true);
    const workload = workloadOf(assets);
    expect(workload.bomEntries).toBeDefined();
    expect("relationships" in workload).toBe(false);
    expect(assets.filter((a) => a.category === "LIBRARY")).toHaveLength(0);
  });
});
