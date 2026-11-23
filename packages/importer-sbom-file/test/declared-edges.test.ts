import { describe, it, expect, vi, afterEach } from "vitest";
import { SbomFileImporter } from "../src/importer.js";
import { sbomFileConfigSchema } from "../src/config.js";
import { manifest } from "../src/manifest.js";
import {
  validateDiscoveredAsset,
  NOOP_LOGGER,
  type DiscoveredAsset,
  type ImporterContext,
} from "@componode/core";

// Spec 077 (T004/T005) — sbom-file as the second ADR-133 declared-edge
// carrier. Opt-in emits `relationships[]` on the configured-component
// asset (subject-declared edges) and on yielded LIBRARY assets
// (library-declared edges), SUBJECT substituted by the resolved
// component's externalId in both positions. Opt-out output is identical
// to the pre-feature yield.

const CONFIG = {
  sbomUrl: "https://sbom.example.com/app.cdx.json",
  componentSlug: "payments-api",
  resolvedComponent: {
    category: "REPOSITORY",
    provider: "GITHUB",
    externalId: "octo/payments-api",
    name: "payments-api",
    slug: "payments-api",
  },
};

const OPTED_IN = { ...CONFIG, importDeclaredEdges: true };

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

// Graph: subject → express, subject → vitest, express → accepts,
// accepts → subject (to-SUBJECT edge exercises both-position
// substitution — spec 077 clarifications).
const SPDX = {
  spdxVersion: "SPDX-2.3",
  SPDXID: "SPDXRef-DOCUMENT",
  name: "payments-api-sbom",
  documentDescribes: ["SPDXRef-subject"],
  packages: [
    pkg("SPDXRef-subject", "payments-api", ""),
    pkg("SPDXRef-express", "express", "pkg:npm/express@4.19.2"),
    pkg("SPDXRef-accepts", "accepts", "pkg:npm/accepts@1.3.8"),
    pkg("SPDXRef-vitest", "vitest", "pkg:npm/vitest@2.0.0"),
  ],
  relationships: [
    { spdxElementId: "SPDXRef-subject", relationshipType: "DEPENDS_ON", relatedSpdxElement: "SPDXRef-express" },
    { spdxElementId: "SPDXRef-subject", relationshipType: "DEPENDS_ON", relatedSpdxElement: "SPDXRef-vitest" },
    { spdxElementId: "SPDXRef-express", relationshipType: "DEPENDS_ON", relatedSpdxElement: "SPDXRef-accepts" },
    { spdxElementId: "SPDXRef-accepts", relationshipType: "DEPENDS_ON", relatedSpdxElement: "SPDXRef-subject" },
  ],
};

// The same dependency graph in CycloneDX form (subject = root ref).
const CDX = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: { component: { type: "application", name: "payments-api", "bom-ref": "root" } },
  components: [
    { type: "library", "bom-ref": "pkg:npm/express@4.19.2", purl: "pkg:npm/express@4.19.2", name: "express" },
    { type: "library", "bom-ref": "pkg:npm/accepts@1.3.8", purl: "pkg:npm/accepts@1.3.8", name: "accepts" },
    { type: "library", "bom-ref": "pkg:npm/vitest@2.0.0", purl: "pkg:npm/vitest@2.0.0", name: "vitest" },
  ],
  dependencies: [
    { ref: "root", dependsOn: ["pkg:npm/express@4.19.2", "pkg:npm/vitest@2.0.0"] },
    { ref: "pkg:npm/express@4.19.2", dependsOn: ["pkg:npm/accepts@1.3.8"] },
    { ref: "pkg:npm/accepts@1.3.8", dependsOn: ["root"] },
  ],
};

const componentAsset = (assets: DiscoveredAsset[]) =>
  assets.find((a) => a.category !== "LIBRARY")!;
const libraries = (assets: DiscoveredAsset[]) =>
  assets.filter((a) => a.category === "LIBRARY");
const libBy = (assets: DiscoveredAsset[], externalId: string) =>
  libraries(assets).find((a) => a.externalId === externalId)!;

describe("config + manifest (T004)", () => {
  it("defaults importDeclaredEdges to false and accepts true", () => {
    expect(sbomFileConfigSchema.parse(CONFIG).importDeclaredEdges).toBe(false);
    expect(sbomFileConfigSchema.parse(OPTED_IN).importDeclaredEdges).toBe(true);
  });

  it("declares the declaredEdgesConfigKey on the manifest", () => {
    expect(manifest.declaredEdgesConfigKey).toBe("importDeclaredEdges");
  });
});

describe("SPDX opt-in emission (T004)", () => {
  it("attaches subject-declared edges to the component asset", async () => {
    mockFetch(SPDX);
    const { assets } = await run(OPTED_IN);
    const component = componentAsset(assets);
    expect(() => validateDiscoveredAsset(component)).not.toThrow();
    expect(component.relationships).toEqual([
      { type: "DEPENDS_ON", targetExternalId: "pkg:npm/express" },
      { type: "DEPENDS_ON", targetExternalId: "pkg:npm/vitest" },
    ]);
    // bomEntries presence semantics unchanged.
    expect(component.bomEntries).toBeDefined();
  });

  it("yields one LIBRARY asset per purl identity with outgoing edges", async () => {
    mockFetch(SPDX);
    const { assets } = await run(OPTED_IN);
    const libs = libraries(assets);
    expect(libs).toHaveLength(3);
    for (const lib of libs) {
      expect(() => validateDiscoveredAsset(lib)).not.toThrow();
      expect(lib.externalId).toMatch(/^pkg:npm\//);
      expect(lib.slug).toMatch(/^pkg-npm-/);
    }
    expect(libBy(assets, "pkg:npm/express").relationships).toEqual([
      { type: "DEPENDS_ON", targetExternalId: "pkg:npm/accepts" },
    ]);
    // vitest declares nothing — relationships omitted, not [].
    expect(libBy(assets, "pkg:npm/vitest").relationships).toBeUndefined();
  });

  it("substitutes SUBJECT in target position with the resolved externalId", async () => {
    mockFetch(SPDX);
    const { assets } = await run(OPTED_IN);
    expect(libBy(assets, "pkg:npm/accepts").relationships).toEqual([
      { type: "DEPENDS_ON", targetExternalId: "octo/payments-api" },
    ]);
  });
});

describe("CycloneDX parity (T004)", () => {
  it("produces the same emitted edge set as the SPDX form", async () => {
    mockFetch(CDX);
    const { assets } = await run(OPTED_IN);
    expect(componentAsset(assets).relationships).toEqual([
      { type: "DEPENDS_ON", targetExternalId: "pkg:npm/express" },
      { type: "DEPENDS_ON", targetExternalId: "pkg:npm/vitest" },
    ]);
    expect(libraries(assets)).toHaveLength(3);
    expect(libBy(assets, "pkg:npm/express").relationships).toEqual([
      { type: "DEPENDS_ON", targetExternalId: "pkg:npm/accepts" },
    ]);
    expect(libBy(assets, "pkg:npm/accepts").relationships).toEqual([
      { type: "DEPENDS_ON", targetExternalId: "octo/payments-api" },
    ]);
    for (const a of assets) {
      expect(() => validateDiscoveredAsset(a)).not.toThrow();
    }
  });
});

describe("opt-out parity (T004)", () => {
  it("yields exactly the component asset — no relationships, no libraries", async () => {
    mockFetch(SPDX);
    const { assets } = await run(CONFIG);
    expect(assets).toHaveLength(1);
    const asset = assets[0]!;
    expect(asset.category).not.toBe("LIBRARY");
    expect(asset.relationships).toBeUndefined();
    expect(asset.bomEntries).toBeDefined();
  });
});

describe("opt-in with no dependency graph (T004)", () => {
  it("yields LIBRARY assets; the subject declares authoritatively-empty", async () => {
    mockFetch({ ...SPDX, relationships: [] });
    const { assets } = await run(OPTED_IN);
    expect(libraries(assets)).toHaveLength(3);
    // FR-007 — field presence marks the run edge-authoritative: the
    // subject emits `relationships: []` (authoritative-empty → the pass
    // may retire), while libraries omit the field when declaring
    // nothing and a degraded yield omits it entirely (non-authoritative).
    expect(assets[0]!.relationships).toEqual([]);
    for (const a of libraries(assets)) {
      expect(a.relationships).toBeUndefined();
    }
    for (const a of assets) {
      expect(() => validateDiscoveredAsset(a)).not.toThrow();
    }
  });
});

describe("degraded paths stay edge-free (T005)", () => {
  it("fetch failure yields one degraded asset even when opted in", async () => {
    mockFetch({}, 404);
    const { assets } = await run(OPTED_IN);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.relationships).toBeUndefined();
    expect(libraries(assets)).toHaveLength(0);
  });

  it("unrecognized format yields degraded, not edges", async () => {
    mockFetch({ some: "other doc" });
    const { assets } = await run(OPTED_IN);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.relationships).toBeUndefined();
  });
});
