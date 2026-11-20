import { describe, it, expect, vi, afterEach } from "vitest";
import { SbomFileImporter } from "../src/importer.js";
import {
  validateDiscoveredAsset,
  NOOP_LOGGER,
  type DiscoveredAsset,
  type ImporterContext,
} from "@componode/core";

// Spec 073 US3 (T038) — SPDX JSON ingestion: externalRefs[purl]→purl,
// relationshipType→scope table, CONTAINS/CONTAINED_BY→tree, DESCRIBES→
// subject, supplier prefix strip, SPDXID→cdxBomRef, checksums→details.

const CONFIG = {
  sbomUrl: "https://sbom.example.com/app.spdx.json",
  componentSlug: "payments-api",
  resolvedComponent: {
    category: "REPOSITORY",
    provider: "GITHUB",
    externalId: "octo/payments-api",
    name: "payments-api",
    slug: "payments-api",
  },
};

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

function mockFetch(doc: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    return new Response(status === 200 ? JSON.stringify(doc) : "", {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}

async function run(config: Record<string, unknown> = CONFIG) {
  const importer = new SbomFileImporter();
  const context = makeContext();
  const assets: DiscoveredAsset[] = [];
  for await (const a of importer.run(config, {}, context)) assets.push(a);
  return { assets, context };
}

afterEach(() => vi.restoreAllMocks());

const pkg = (
  id: string,
  name: string,
  purl: string,
  over: Record<string, unknown> = {},
) => ({
  SPDXID: id,
  name,
  externalRefs: purl
    ? [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: purl }]
    : [],
  ...over,
});

const SPDX = {
  spdxVersion: "SPDX-2.3",
  SPDXID: "SPDXRef-DOCUMENT",
  name: "payments-api-sbom",
  documentDescribes: ["SPDXRef-subject"],
  packages: [
    pkg("SPDXRef-subject", "payments-api", "pkg:generic/payments-api"),
    pkg("SPDXRef-express", "express", "pkg:npm/express@4.19.2", {
      versionInfo: "4.19.2",
      supplier: "Organization: OpenJS Foundation",
      licenseConcluded: "MIT",
      checksums: [{ algorithm: "SHA256", checksumValue: "deadbeef" }],
    }),
    pkg("SPDXRef-vitest", "vitest", "pkg:npm/vitest@2.0.0"),
    pkg("SPDXRef-gcc", "gcc", "pkg:deb/gcc@13", {
      supplier: "Person: Jane Doe",
      licenseDeclared: "GPL-3.0",
    }),
    pkg("SPDXRef-inner", "inner-lib", "pkg:npm/inner@1.0.0"),
  ],
  relationships: [
    { spdxElementId: "SPDXRef-express", relationshipType: "RUNTIME_DEPENDENCY_OF", relatedSpdxElement: "SPDXRef-subject" },
    { spdxElementId: "SPDXRef-vitest", relationshipType: "TEST_DEPENDENCY_OF", relatedSpdxElement: "SPDXRef-subject" },
    { spdxElementId: "SPDXRef-gcc", relationshipType: "BUILD_TOOL_OF", relatedSpdxElement: "SPDXRef-subject" },
    { spdxElementId: "SPDXRef-inner", relationshipType: "STATIC_LINK", relatedSpdxElement: "SPDXRef-subject" },
    { spdxElementId: "SPDXRef-express", relationshipType: "CONTAINS", relatedSpdxElement: "SPDXRef-inner" },
  ],
};

describe("sbom-file SPDX ingestion (spec 073)", () => {
  it("maps relationship types through the scope table and drops the subject", async () => {
    mockFetch(SPDX);
    const { assets } = await run();
    const asset = assets[0]!;
    expect(() => validateDiscoveredAsset(asset)).not.toThrow();
    const entries = asset.bomEntries!;
    // Subject package is the described element — never an entry.
    expect(entries.find((e) => e.name === "payments-api")).toBeUndefined();
    // inner-lib is CONTAINS'd by express — nested, not top-level.
    expect(entries).toHaveLength(3);
    const by = (name: string) => entries.find((e) => e.name === name)!;
    expect(by("express").scope).toBe("RUNTIME");
    expect(by("vitest").scope).toBe("TEST");
    expect(by("gcc").scope).toBe("BUILD");
    expect(by("express").children!.find((e) => e.name === "inner-lib")!.scope).toBe("BUNDLED");
  });

  it("marks subject-edge packages direct and package-edge packages transitive", async () => {
    mockFetch(SPDX);
    const { assets } = await run();
    const entries = assets[0]!.bomEntries!;
    const express = entries.find((e) => e.name === "express")!;
    expect(express.direct).toBe(true);
    // inner-lib is a child (CONTAINS) of express — its scope comes from
    // STATIC_LINK and it is subject-direct by the relationship table.
    const inner = express.children!.find((e) => e.name === "inner-lib")!;
    expect(inner.direct).toBe(true);
  });

  it("nests CONTAINS children under the parent entry", async () => {
    mockFetch(SPDX);
    const { assets } = await run();
    const entries = assets[0]!.bomEntries!;
    const express = entries.find((e) => e.name === "express")!;
    expect(express.children).toHaveLength(1);
    expect(entries.find((e) => e.name === "inner-lib")).toBeUndefined();
  });

  it("strips supplier prefixes, carries SPDXID→cdxBomRef, checksums→details, license→licenses", async () => {
    mockFetch(SPDX);
    const { assets } = await run();
    const entries = assets[0]!.bomEntries!;
    const express = entries.find((e) => e.name === "express")!;
    expect(express.supplier).toBe("OpenJS Foundation");
    expect(express.cdxBomRef).toBe("SPDXRef-express");
    expect((express.details as Record<string, unknown>).checksums).toEqual(["SHA256:deadbeef"]);
    expect(express.licenses).toEqual(["MIT"]);
    const gcc = entries.find((e) => e.name === "gcc")!;
    expect(gcc.supplier).toBe("Jane Doe");
    expect(gcc.licenses).toEqual(["GPL-3.0"]);
  });

  it("treats NOASSERTION/NONE values as absent", async () => {
    mockFetch({
      ...SPDX,
      relationships: [],
      packages: [
        pkg("SPDXRef-subject", "payments-api", "pkg:generic/payments-api"),
        pkg("SPDXRef-x", "x", "pkg:npm/x@1.0.0", {
          licenseConcluded: "NOASSERTION",
          licenseDeclared: "NONE",
          supplier: "NOASSERTION",
        }),
      ],
    });
    const { assets } = await run();
    const x = assets[0]!.bomEntries!.find((e) => e.name === "x")!;
    expect(x.licenses).toEqual([]);
    expect(x.supplier).toBeNull();
    expect(() => validateDiscoveredAsset(assets[0]!)).not.toThrow();
  });

  it("yields the component degraded (no bomEntries) on fetch failure", async () => {
    mockFetch({}, 404);
    const { assets } = await run();
    expect(assets).toHaveLength(1);
    const asset = assets[0]!;
    expect(asset.bomEntries).toBeUndefined(); // absence preserves prior set
    const caps = (asset.details as Record<string, { bomInventory: { status: string } }>).capabilities;
    expect(caps.bomInventory.status).toBe("UNAVAILABLE");
  });

  it("yields degraded on unrecognised format and on invalid JSON", async () => {
    mockFetch({ some: "other doc" });
    let { assets } = await run();
    let caps = (assets[0]!.details as Record<string, { bomInventory: { status: string } }>).capabilities;
    expect(caps.bomInventory.status).toBe("UNAVAILABLE");
    expect(assets[0]!.bomEntries).toBeUndefined();

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("not json", { status: 200 }));
    ({ assets } = await run());
    caps = (assets[0]!.details as Record<string, { bomInventory: { status: string } }>).capabilities;
    expect(caps.bomInventory.status).toBe("ERROR");
  });
});
