import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchImageBom } from "../../src/utils/oci-referrers.js";
import { SPDX_EDGE_SUBJECT } from "../../src/utils/spdx.js";

// Spec 078 / ADR-133 — ImageBomResult.edges: the referrers path must
// surface the dependency graph it already parses (CycloneDX and SPDX
// attestations alike) with the SUBJECT sentinel intact, instead of
// discarding `.edges`. Absent ⇔ entries absent.

const REF = `registry.example.com/library/nginx@sha256:${"a".repeat(64)}`;
const MANIFEST_DIGEST = `sha256:${"b".repeat(64)}`;
const BLOB_DIGEST = `sha256:${"c".repeat(64)}`;

const REFERRER_INDEX = (artifactType: string) => ({
  schemaVersion: 2,
  manifests: [
    {
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      digest: MANIFEST_DIGEST,
      artifactType,
      size: 100,
    },
  ],
});

const REFERRER_MANIFEST = {
  schemaVersion: 2,
  layers: [{ digest: BLOB_DIGEST, size: 500 }],
};

const CDX_DOC = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: {
    component: { type: "container", name: "library/nginx", "bom-ref": "root" },
  },
  components: [
    {
      type: "library",
      "bom-ref": "pkg:deb/debian/bash@5.2.15",
      purl: "pkg:deb/debian/bash@5.2.15",
      name: "bash",
    },
    {
      type: "library",
      "bom-ref": "pkg:deb/debian/glibc@2.36",
      purl: "pkg:deb/debian/glibc@2.36",
      name: "glibc",
    },
    {
      type: "library",
      "bom-ref": "pkg:deb/debian/openssl@3.0",
      purl: "pkg:deb/debian/openssl@3.0",
      name: "openssl",
    },
  ],
  dependencies: [
    {
      ref: "root",
      dependsOn: ["pkg:deb/debian/bash@5.2.15", "pkg:deb/debian/openssl@3.0"],
    },
    { ref: "pkg:deb/debian/bash@5.2.15", dependsOn: ["pkg:deb/debian/glibc@2.36"] },
    { ref: "pkg:deb/debian/openssl@3.0", dependsOn: [] },
  ],
};

const SPDX_DOC = {
  spdxVersion: "SPDX-2.3",
  SPDXID: "SPDXRef-DOCUMENT",
  documentDescribes: ["SPDXRef-Image"],
  packages: [
    { SPDXID: "SPDXRef-Image", name: "library/nginx" },
    {
      SPDXID: "SPDXRef-bash",
      name: "bash",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: "pkg:deb/debian/bash@5.2.15",
        },
      ],
    },
    {
      SPDXID: "SPDXRef-glibc",
      name: "glibc",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: "pkg:deb/debian/glibc@2.36",
        },
      ],
    },
  ],
  relationships: [
    {
      spdxElementId: "SPDXRef-Image",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-bash",
    },
    {
      spdxElementId: "SPDXRef-bash",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-glibc",
    },
  ],
};

const CDX_NO_GRAPH_DOC = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: {
    component: { type: "container", name: "library/nginx", "bom-ref": "root" },
  },
  components: [
    {
      type: "library",
      purl: "pkg:deb/debian/bash@5.2.15",
      name: "bash",
    },
  ],
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

function sbomRoutes(doc: unknown, artifactType = "application/vnd.cyclonedx+json") {
  return {
    [`/referrers/sha256:${"a".repeat(64)}`]: { body: REFERRER_INDEX(artifactType) },
    [`/manifests/${MANIFEST_DIGEST}`]: { body: REFERRER_MANIFEST },
    [`/blobs/${BLOB_DIGEST}`]: { body: doc },
  };
}

describe("ImageBomResult.edges (referrers path)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces the CycloneDX dependency graph with the SUBJECT sentinel", async () => {
    mockRegistry(sbomRoutes(CDX_DOC));
    const result = await fetchImageBom(REF);
    expect(result.marker.status).toBe("OK");
    expect(result.entries).toBeDefined();
    expect(result.edges).toEqual([
      { from: SPDX_EDGE_SUBJECT, to: "pkg:deb/debian/bash" },
      { from: SPDX_EDGE_SUBJECT, to: "pkg:deb/debian/openssl" },
      { from: "pkg:deb/debian/bash", to: "pkg:deb/debian/glibc" },
    ]);
  });

  it("surfaces the same graph from an SPDX attestation", async () => {
    mockRegistry(sbomRoutes(SPDX_DOC, "application/vnd.spdx+json"));
    const result = await fetchImageBom(REF);
    expect(result.marker.status).toBe("OK");
    expect(result.edges).toEqual([
      { from: SPDX_EDGE_SUBJECT, to: "pkg:deb/debian/bash" },
      { from: "pkg:deb/debian/bash", to: "pkg:deb/debian/glibc" },
    ]);
  });

  it("returns an empty edge set for a document with no dependency graph", async () => {
    mockRegistry(sbomRoutes(CDX_NO_GRAPH_DOC));
    const result = await fetchImageBom(REF);
    expect(result.marker.status).toBe("OK");
    expect(result.entries).toBeDefined();
    expect(result.edges).toEqual([]);
  });

  it("leaves edges undefined when no attestation exists", async () => {
    mockRegistry({
      [`/referrers/sha256:${"a".repeat(64)}`]: {
        status: 404,
        body: { errors: [] },
      },
    });
    const result = await fetchImageBom(REF);
    expect(result.marker.status).toBe("UNAVAILABLE");
    expect(result.entries).toBeUndefined();
    expect(result.edges).toBeUndefined();
  });
});
