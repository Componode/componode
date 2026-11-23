import { describe, it, expect } from "vitest";
import {
  COMPONENT_PROVIDERS,
  COMPONENT_PROVIDER_GROUPS,
  BOM_SUGGESTION_REASONS,
  BOM_SUGGESTION_STATUSES,
  BOM_SUGGESTION_REASON_META,
  mapEcosystemToProvider,
  mapCdxTypeToCategory,
  mappingNote,
  packageSlugToken,
} from "../src/index.js";
import {
  addToCatalogBodySchema,
  linkPackageBodySchema,
  addToCatalogPreviewQuerySchema,
  dependencyGroupsQuerySchema,
  dependencyBulkBodySchema,
  listSuggestionsQuerySchema,
  listComponentsQuerySchema,
} from "../src/index.js";

// Spec 075 — provider taxonomy, promotion mappings, suggestion constants,
// and the new curation/dependency query+body schemas.

describe("COMPONENT_PROVIDER_GROUPS (T001)", () => {
  it("partitions the enum into 11 platforms + 13 package registries", () => {
    expect(COMPONENT_PROVIDER_GROUPS.platforms).toHaveLength(11);
    expect(COMPONENT_PROVIDER_GROUPS["package-registries"]).toHaveLength(13);
    const union = [
      ...COMPONENT_PROVIDER_GROUPS.platforms,
      ...COMPONENT_PROVIDER_GROUPS["package-registries"],
    ];
    expect(new Set(union).size).toBe(COMPONENT_PROVIDERS.length);
    for (const p of COMPONENT_PROVIDERS) expect(union).toContain(p);
  });
});

describe("BOM suggestion constants (T001)", () => {
  it("reasons + statuses match the ADR-132 contract", () => {
    expect(BOM_SUGGESTION_REASONS).toEqual([
      "PURL_EXACT",
      "PURL_NAME_MATCH",
      "CATALOG_SLUG_MATCH",
    ]);
    expect(BOM_SUGGESTION_STATUSES).toEqual([
      "PENDING",
      "ACCEPTED",
      "DISMISSED",
      "SUPERSEDED",
    ]);
    expect(BOM_SUGGESTION_REASON_META.PURL_EXACT.label).toBe(
      "Exact package match",
    );
    expect(BOM_SUGGESTION_REASON_META.PURL_NAME_MATCH.label).toBe(
      "Name match",
    );
    expect(BOM_SUGGESTION_REASON_META.CATALOG_SLUG_MATCH.label).toBe(
      "Catalog name match",
    );
    // Ranking: exact > slug > name (D2).
    expect(
      BOM_SUGGESTION_REASON_META.PURL_EXACT.score,
    ).toBeGreaterThan(BOM_SUGGESTION_REASON_META.CATALOG_SLUG_MATCH.score);
    expect(
      BOM_SUGGESTION_REASON_META.CATALOG_SLUG_MATCH.score,
    ).toBeGreaterThan(BOM_SUGGESTION_REASON_META.PURL_NAME_MATCH.score);
  });
});

describe("mapEcosystemToProvider (T002)", () => {
  it.each([
    ["npm", "NPM"],
    ["pypi", "PYPI"],
    ["maven", "MAVEN"],
    ["nuget", "NUGET"],
    ["golang", "GOLANG"],
    ["cargo", "CARGO"],
    ["gem", "RUBYGEMS"],
    ["composer", "PACKAGIST"],
    ["deb", "DEBIAN"],
    ["rpm", "RPM"],
    ["apk", "ALPINE"],
  ])("%s → %s", (ecosystem, provider) => {
    expect(mapEcosystemToProvider(ecosystem)).toBe(provider);
  });

  it("resolves docker/oci from the registry hostname", () => {
    expect(
      mapEcosystemToProvider("docker", "pkg:docker/ghcr.io/org/image@1.0"),
    ).toBe("GHCR");
    expect(
      mapEcosystemToProvider(
        "oci",
        "pkg:oci/img?repository_url=123456789012.dkr.ecr.us-east-1.amazonaws.com/repo",
      ),
    ).toBe("ECR");
    expect(mapEcosystemToProvider("docker", "pkg:docker/library/nginx@1")).toBe(
      "DOCKER",
    );
    expect(mapEcosystemToProvider("docker")).toBe("DOCKER");
  });

  it("falls back to OTHER for unmapped ecosystems", () => {
    expect(mapEcosystemToProvider("swift")).toBe("OTHER");
    expect(mapEcosystemToProvider("hackage")).toBe("OTHER");
  });
});

describe("mapCdxTypeToCategory (T002)", () => {
  it.each([
    ["library", "LIBRARY"],
    ["framework", "LIBRARY"],
    ["machine-learning-model", "LIBRARY"],
    ["container", "CONTAINER"],
    ["device", "COMPUTE"],
    ["firmware", "COMPUTE"],
    ["operating-system", "COMPUTE"],
    ["platform", "COMPUTE"],
    ["application", "COMPUTE"],
    ["service", "API"],
    ["file", "STORAGE"],
    ["data", "STORAGE"],
    [null, "LIBRARY"],
    ["unknown-type", "LIBRARY"],
  ])("%s → %s", (cdxType, category) => {
    expect(mapCdxTypeToCategory(cdxType)).toBe(category);
  });
});

describe("mappingNote (T002)", () => {
  it("flags lossy cdxType and unmapped ecosystems only", () => {
    expect(mappingNote("firmware", "rpm")).toEqual({
      cdxType: "firmware",
      ecosystem: "rpm",
    });
    expect(mappingNote("library", "hackage")).toEqual({
      cdxType: "library",
      ecosystem: "hackage",
    });
    expect(mappingNote("library", "npm")).toBeNull();
    expect(mappingNote("framework", "pypi")).toBeNull();
    expect(mappingNote(null, "npm")).toBeNull();
  });
});

describe("packageSlugToken (T002)", () => {
  it("slugifies scoped and plain names", () => {
    expect(packageSlugToken("lodash")).toBe("lodash");
    expect(packageSlugToken("@scope/name")).toBe("scope-name");
    expect(packageSlugToken("@types/node")).toBe("types-node");
    expect(packageSlugToken("Some_Package.Name")).toBe("some-package-name");
  });
});

describe("curation + dependency schemas (T004)", () => {
  it("addToCatalogBodySchema validates and rejects unknowns", () => {
    const ok = addToCatalogBodySchema.safeParse({
      purl: "pkg:npm/lodash@4.17.21",
      linkConsumers: true,
    });
    expect(ok.success).toBe(true);
    expect(
      addToCatalogBodySchema.safeParse({
        purl: "pkg:npm/lodash",
        linkConsumers: true,
        extra: 1,
      }).success,
    ).toBe(false);
    expect(
      addToCatalogBodySchema.safeParse({ purl: "pkg:npm/lodash" }).success,
    ).toBe(false);
  });

  it("linkPackageBodySchema requires a uuid componentId", () => {
    expect(
      linkPackageBodySchema.safeParse({
        purl: "pkg:npm/lodash",
        componentId: "not-a-uuid",
        linkConsumers: false,
      }).success,
    ).toBe(false);
    expect(
      linkPackageBodySchema.safeParse({
        purl: "pkg:npm/lodash",
        componentId: "018f1a2b-3c4d-7e8f-9a0b-1c2d3e4f5a6b",
        linkConsumers: false,
      }).success,
    ).toBe(true);
  });

  it("preview schema requires purl, strict", () => {
    expect(addToCatalogPreviewQuerySchema.safeParse({}).success).toBe(false);
    expect(
      addToCatalogPreviewQuerySchema.safeParse({
        purl: "pkg:deb/openssl",
        other: "x",
      }).success,
    ).toBe(false);
  });

  it("listSuggestionsQuerySchema defaults kind to edge", () => {
    const parsed = listSuggestionsQuerySchema.parse({});
    expect(parsed.kind).toBe("edge");
    expect(parsed.status).toBe("PENDING");
    expect(
      listSuggestionsQuerySchema.safeParse({ kind: "dependency" }).success,
    ).toBe(true);
    expect(listSuggestionsQuerySchema.safeParse({ kind: "bogus" }).success).toBe(
      false,
    );
  });

  it("dependency groups + bulk schemas validate", () => {
    expect(dependencyGroupsQuerySchema.parse({}).sort).toBe("score");
    expect(
      dependencyBulkBodySchema.safeParse({
        childComponentId: "018f1a2b-3c4d-7e8f-9a0b-1c2d3e4f5a6b",
        action: "accept",
      }).success,
    ).toBe(true);
    expect(
      dependencyBulkBodySchema.safeParse({
        childComponentId: "018f1a2b-3c4d-7e8f-9a0b-1c2d3e4f5a6b",
        action: "merge",
      }).success,
    ).toBe(false);
  });

  it("components list accepts libraries flag, default false", () => {
    expect(listComponentsQuerySchema.parse({}).libraries).toBe(false);
    expect(listComponentsQuerySchema.parse({ libraries: "1" }).libraries).toBe(
      true,
    );
    expect(
      listComponentsQuerySchema.parse({ libraries: "true" }).libraries,
    ).toBe(true);
  });
});
