import { describe, it, expect } from "vitest";
import {
  purlType,
  generateComponentSlug,
  buildLibraryAsset,
  indexBomEntries,
  dependsOnRels,
  validateDiscoveredAsset,
  type DiscoveredBomEntry,
} from "../../src/index.js";

// Spec 077 (T001) — shared LIBRARY-asset shaping hoisted from
// importer-github so the sbom-file carrier emits the identical contract
// (ADR-133 / FR-003). `externalId` is the normalized version-free purl
// identity — the (LIBRARY, provider, externalId) dedup triple merges with
// curated libraries from spec 075 and GitHub-carrier libraries.

const entry = (over: Partial<DiscoveredBomEntry> = {}): DiscoveredBomEntry => ({
  purl: "pkg:npm/express@4.19.2",
  name: "express",
  evidenceSource: "SBOM_DOCUMENT",
  version: "4.19.2",
  ...over,
});

describe("purlType (T001)", () => {
  it("extracts the type segment from a purl", () => {
    expect(purlType("pkg:npm/express@4.19.2")).toBe("npm");
    expect(purlType("pkg:golang/golang.org/x/sys@0.15.0")).toBe("golang");
    expect(purlType("pkg:maven/org.apache/foo@1.0")).toBe("maven");
  });

  it("handles versionless purls and falls back to generic", () => {
    expect(purlType("pkg:deb/gcc")).toBe("deb");
    expect(purlType("pkg:/weird@1")).toBe("generic");
  });
});

describe("generateComponentSlug (T001)", () => {
  it("lowercases, hyphenates non-alphanumerics, strips edge hyphens", () => {
    expect(generateComponentSlug("My Lib")).toBe("my-lib");
    expect(generateComponentSlug("golang.org/x/sys")).toBe("golang-org-x-sys");
    expect(generateComponentSlug("--trim--")).toBe("trim");
  });
});

describe("buildLibraryAsset (T001)", () => {
  it("produces the shared LIBRARY asset shape and passes the contract", () => {
    const asset = buildLibraryAsset("pkg:npm/express", entry(), []);
    expect(() => validateDiscoveredAsset(asset)).not.toThrow();
    expect(asset).toMatchObject({
      category: "LIBRARY",
      resourceType: "npm",
      name: "express",
      externalId: "pkg:npm/express",
      slug: "pkg-npm-express",
      instances: [],
      details: { purl: "pkg:npm/express@4.19.2", version: "4.19.2" },
    });
    expect(asset.relationships).toBeUndefined();
  });

  it("maps the purl ecosystem to a package-registry provider", () => {
    const asset = buildLibraryAsset("pkg:npm/express", entry(), []);
    expect(asset.provider).toBe("NPM");
  });

  it("omits version from details when the entry has none", () => {
    const asset = buildLibraryAsset(
      "pkg:npm/express",
      entry({ version: null }),
      [],
    );
    expect(asset.details).toEqual({ purl: "pkg:npm/express@4.19.2" });
  });

  it("falls back to a non-empty slug token when the name sanitizes empty", () => {
    const asset = buildLibraryAsset(
      "pkg:npm/express",
      entry({ name: "!!!" }),
      [],
    );
    expect(asset.slug).toBe("pkg-npm-unnamed");
  });

  it("attaches relationships only when non-empty", () => {
    const rels = [{ type: "DEPENDS_ON" as const, targetExternalId: "pkg:npm/accepts" }];
    const withRels = buildLibraryAsset("pkg:npm/express", entry(), rels);
    expect(withRels.relationships).toEqual(rels);
    expect(() => validateDiscoveredAsset(withRels)).not.toThrow();
  });
});

describe("dependsOnRels (T017)", () => {
  const edges = [
    { from: "SUBJECT", to: "pkg:npm/express" },
    { from: "pkg:npm/express", to: "pkg:npm/accepts" },
    { from: "pkg:npm/lodash", to: "pkg:npm/ms" },
  ];

  it("projects outgoing edges from a position into DEPENDS_ON rels", () => {
    expect(dependsOnRels(edges, "SUBJECT")).toEqual([
      { type: "DEPENDS_ON", targetExternalId: "pkg:npm/express" },
    ]);
    expect(dependsOnRels(edges, "pkg:npm/express")).toEqual([
      { type: "DEPENDS_ON", targetExternalId: "pkg:npm/accepts" },
    ]);
  });

  it("returns an empty array when nothing is declared from the position", () => {
    expect(dependsOnRels(edges, "pkg:npm/accepts")).toEqual([]);
    expect(dependsOnRels([], "SUBJECT")).toEqual([]);
  });
});

describe("indexBomEntries (T001)", () => {
  it("flattens children and keys by normalized version-free identity", () => {
    const inner = entry({
      purl: "pkg:npm/accepts@1.3.8",
      name: "accepts",
      version: "1.3.8",
    });
    const parent = entry({ children: [inner] });
    const map = indexBomEntries([parent]);
    expect(map.has("pkg:npm/express")).toBe(true);
    expect(map.has("pkg:npm/accepts")).toBe(true);
    expect(map.get("pkg:npm/accepts")!.name).toBe("accepts");
  });

  it("first-wins on duplicate identities", () => {
    const a = entry({ name: "first" });
    const b = entry({ name: "second" });
    const map = indexBomEntries([a, b]);
    expect(map.size).toBe(1);
    expect(map.get("pkg:npm/express")!.name).toBe("first");
  });

  it("skips entries whose purl does not normalize", () => {
    const map = indexBomEntries([entry({ purl: "not-a-purl" })]);
    expect(map.size).toBe(0);
  });
});
