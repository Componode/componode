import { describe, it, expect } from "vitest";
import {
  DISCOVERED_RELATIONSHIP_TYPES,
  EDGE_KINDS,
  EDGE_PROVENANCES,
  EDGE_JUNCTION,
} from "../src/constants/importer-edge.js";
import { validateDiscoveredAsset } from "../src/validation/discovered-asset.js";
import { parseSpdxDocument, SPDX_EDGE_SUBJECT } from "../src/utils/spdx.js";

describe("importer-edge constants", () => {
  it("declares the three component-edge relationship types", () => {
    expect(DISCOVERED_RELATIONSHIP_TYPES).toEqual([
      "DEPENDS_ON",
      "SOURCES_FROM",
      "EXPOSES",
    ]);
    expect(EDGE_KINDS).toEqual(DISCOVERED_RELATIONSHIP_TYPES);
    expect(EDGE_PROVENANCES).toEqual(["CURATED", "IMPORTER"]);
  });

  it("maps each edge kind to its junction columns (data-model direction table)", () => {
    expect(EDGE_JUNCTION.DEPENDS_ON).toEqual({
      table: "component_depends_on_component",
      fromColumn: "parentId",
      toColumn: "childId",
    });
    expect(EDGE_JUNCTION.SOURCES_FROM).toEqual({
      table: "component_sources_from",
      fromColumn: "serviceId",
      toColumn: "repositoryId",
    });
    expect(EDGE_JUNCTION.EXPOSES).toEqual({
      table: "component_exposes",
      fromColumn: "serviceId",
      toColumn: "apiId",
    });
  });
});

const baseAsset = {
  category: "REPOSITORY" as const,
  provider: "GITHUB" as const,
  resourceType: "github:repository",
  name: "org/repo",
  externalId: "org/repo",
  instances: [
    { environment: "PRODUCTION" as const, externalId: "main" },
  ],
};

describe("validateDiscoveredAsset — relationships[] (ADR-133)", () => {
  it("accepts a valid relationships[] array", () => {
    expect(
      validateDiscoveredAsset({
        ...baseAsset,
        relationships: [
          { type: "DEPENDS_ON", targetExternalId: "pkg:npm/lodash" },
          { type: "SOURCES_FROM", targetExternalId: "org/repo-source" },
        ],
      }),
    ).toBe(true);
  });

  it("accepts a missing relationships field (optional)", () => {
    expect(validateDiscoveredAsset(baseAsset)).toBe(true);
  });

  it("rejects an unknown relationship type", () => {
    expect(
      validateDiscoveredAsset({
        ...baseAsset,
        relationships: [{ type: "COMPOSES", targetExternalId: "x" }],
      }),
    ).toBe(false);
  });

  it("rejects an empty targetExternalId", () => {
    expect(
      validateDiscoveredAsset({
        ...baseAsset,
        relationships: [{ type: "DEPENDS_ON", targetExternalId: "" }],
      }),
    ).toBe(false);
  });

  it("rejects a relationship missing targetExternalId", () => {
    expect(
      validateDiscoveredAsset({
        ...baseAsset,
        relationships: [{ type: "DEPENDS_ON" }],
      }),
    ).toBe(false);
  });

  it("rejects a relationship with an unknown extra field", () => {
    expect(
      validateDiscoveredAsset({
        ...baseAsset,
        relationships: [
          { type: "DEPENDS_ON", targetExternalId: "x", bogus: true },
        ],
      }),
    ).toBe(false);
  });
});

describe("parseSpdxDocument — dependency edges (ADR-133)", () => {
  const doc = {
    spdxVersion: "SPDX-2.3",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "org/repo",
    documentDescribes: ["SPDXRef-repo"],
    packages: [
      {
        SPDXID: "SPDXRef-repo",
        name: "org/repo",
        externalRefs: [
          {
            referenceCategory: "PACKAGE-MANAGER",
            referenceType: "purl",
            referenceLocator: "pkg:github/org/repo@1.0.0",
          },
        ],
      },
      {
        SPDXID: "SPDXRef-lodash",
        name: "lodash",
        versionInfo: "4.17.21",
        externalRefs: [
          { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: "pkg:npm/lodash@4.17.21" },
        ],
      },
      {
        SPDXID: "SPDXRef-react",
        name: "react",
        versionInfo: "18.2.0",
        externalRefs: [
          { referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: "pkg:npm/react@18.2.0" },
        ],
      },
      {
        SPDXID: "SPDXRef-nopurl",
        name: "internal",
      },
    ],
    relationships: [
      // subject DEPENDS_ON lodash — direct dep, declaring side = subject
      { spdxElementId: "SPDXRef-repo", relatedSpdxElement: "SPDXRef-lodash", relationshipType: "DEPENDS_ON" },
      // react DEPENDENCY_OF subject — same edge the other way round
      { spdxElementId: "SPDXRef-react", relatedSpdxElement: "SPDXRef-repo", relationshipType: "DEPENDENCY_OF" },
      // react DEPENDS_ON lodash — package→package edge
      { spdxElementId: "SPDXRef-react", relatedSpdxElement: "SPDXRef-lodash", relationshipType: "DEPENDS_ON" },
      // unpurl'd package cannot form an edge
      { spdxElementId: "SPDXRef-repo", relatedSpdxElement: "SPDXRef-nopurl", relationshipType: "DEPENDS_ON" },
      // non-dependency types never emit edges
      { spdxElementId: "SPDXRef-DOCUMENT", relatedSpdxElement: "SPDXRef-repo", relationshipType: "DESCRIBES" },
      { spdxElementId: "SPDXRef-repo", relatedSpdxElement: "SPDXRef-lodash", relationshipType: "CONTAINS" },
    ],
  };

  it("emits edges keyed by version-free purl identity with SUBJECT placeholders", () => {
    const { edges } = parseSpdxDocument(doc);
    expect(edges).toEqual([
      { from: SPDX_EDGE_SUBJECT, to: "pkg:npm/lodash" },
      { from: SPDX_EDGE_SUBJECT, to: "pkg:npm/react" },
      { from: "pkg:npm/react", to: "pkg:npm/lodash" },
    ]);
  });

  it("drops edges touching packages without a purl identity", () => {
    const { edges } = parseSpdxDocument(doc);
    expect(edges.every((e) => e.to !== "internal" && e.from !== "internal")).toBe(true);
    expect(edges).toHaveLength(3);
  });

  it("keeps the existing entries/skipped result shape", () => {
    const result = parseSpdxDocument(doc);
    expect(result.skipped).toBe(1); // SPDXRef-nopurl
    expect(result.entries.length).toBeGreaterThan(0);
  });
});
