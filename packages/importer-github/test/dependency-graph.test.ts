import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GithubImporter } from "../src/importer.js";
import { githubConfigSchema } from "../src/config.js";
import {
  NOOP_LOGGER,
  validateDiscoveredAssetDetailed,
  type DiscoveredAsset,
  type ImporterContext,
} from "@componode/core";
import { mockFetch, type MockRoute } from "./fetch-mock.js";

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

function makeRepo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 123,
    full_name: "testorg/repo",
    name: "repo",
    owner: { login: "testorg" },
    html_url: "https://github.com/testorg/repo",
    fork: false,
    archived: false,
    language: "TypeScript",
    topics: [],
    visibility: "public",
    default_branch: "main",
    ...overrides,
  };
}

const ORG = {
  id: 42,
  login: "testorg",
  name: "Test Org",
  html_url: "https://github.com/testorg",
};

const BASE_ROUTES: MockRoute[] = [
  { path: "/orgs/testorg", body: ORG },
  { path: "/orgs/testorg/teams", body: [] },
  { path: "/orgs/testorg/repos", body: [makeRepo()] },
];

const MINIMAL_CONFIG = {
  org: "testorg",
  includeOrganization: false,
  includeBilling: false,
  includeEnvironments: false,
  includeReleases: false,
  includeBranchInventory: false,
  includeBranchInstances: false,
  includeReleaseInventory: false,
};

// GitHub dependency-graph endpoint returns an SPDX 2.3 document.
function spdxDoc() {
  return {
    spdxVersion: "SPDX-2.3",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "testorg/repo",
    documentDescribes: ["SPDXRef-repo"],
    packages: [
      {
        SPDXID: "SPDXRef-repo",
        name: "testorg/repo",
        downloadLocation: "https://github.com/testorg/repo",
      },
      {
        SPDXID: "SPDXRef-npm-lodash",
        name: "lodash",
        versionInfo: "4.17.21",
        supplier: "Organization: lodash",
        licenseConcluded: "MIT",
        downloadLocation: "NOASSERTION",
        externalRefs: [
          {
            referenceCategory: "PACKAGE-MANAGER",
            referenceType: "purl",
            referenceLocator: "pkg:npm/lodash@4.17.21",
          },
        ],
      },
      {
        SPDXID: "SPDXRef-npm-react",
        name: "react",
        versionInfo: "18.2.0",
        supplier: "NOASSERTION",
        licenseConcluded: "NOASSERTION",
        externalRefs: [
          {
            referenceType: "purl",
            referenceLocator: "pkg:npm/react@18.2.0",
          },
        ],
      },
      {
        SPDXID: "SPDXRef-npm-loose",
        name: "loose-envify",
        versionInfo: "1.4.0",
        externalRefs: [
          { referenceType: "purl", referenceLocator: "pkg:npm/loose-envify@1.4.0" },
        ],
      },
    ],
    relationships: [
      {
        spdxElementId: "SPDXRef-DOCUMENT",
        relatedSpdxElement: "SPDXRef-repo",
        relationshipType: "DESCRIBES",
      },
      {
        spdxElementId: "SPDXRef-npm-lodash",
        relatedSpdxElement: "SPDXRef-repo",
        relationshipType: "RUNTIME_DEPENDENCY_OF",
      },
      {
        spdxElementId: "SPDXRef-npm-react",
        relatedSpdxElement: "SPDXRef-repo",
        relationshipType: "DEPENDENCY_OF",
      },
      {
        // loose-envify depends through react — transitive.
        spdxElementId: "SPDXRef-npm-loose",
        relatedSpdxElement: "SPDXRef-npm-react",
        relationshipType: "DEPENDENCY_OF",
      },
    ],
  };
}

async function collectAssets(config: Record<string, unknown>) {
  const importer = new GithubImporter();
  const assets: DiscoveredAsset[] = [];
  for await (const asset of importer.run(config, { token: "t" }, makeContext())) {
    assets.push(asset);
  }
  return assets;
}

describe("github dependency-graph BOM", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps the dep-graph SPDX document to bomEntries with scope/direct/evidence", async () => {
    mockFetch([
      ...BASE_ROUTES,
      { path: "/repos/testorg/repo/dependency-graph/sbom", body: spdxDoc() },
    ]);

    const assets = await collectAssets({
      ...MINIMAL_CONFIG,
      includeDependencyGraph: true,
    });
    const repo = assets.find((a) => a.name === "testorg/repo")!;
    expect(repo.bomEntries).toBeDefined();
    const names = repo.bomEntries!.map((e) => e.name).sort();
    expect(names).toEqual(["lodash", "loose-envify", "react"]);

    const byName = Object.fromEntries(repo.bomEntries!.map((e) => [e.name, e]));
    expect(byName.lodash.scope).toBe("RUNTIME");
    expect(byName.lodash.evidenceSource).toBe("REGISTRY_API");
    expect(byName.lodash.licenses).toEqual(["MIT"]);
    expect(byName.lodash.supplier).toBe("lodash");
    expect(byName.lodash.purl).toBe("pkg:npm/lodash@4.17.21");
    expect(byName.lodash.cdxBomRef).toBe("SPDXRef-npm-lodash");
    expect(byName.lodash.direct).toBe(true);
    expect(byName.react.direct).toBe(true);
    // Related only through react — not direct to the subject.
    expect(byName["loose-envify"].direct).toBe(false);

    // The yielded asset must still satisfy the importer contract.
    expect(validateDiscoveredAssetDetailed(repo).valid).toBe(true);

    const caps = (repo.details as Record<string, unknown>).capabilities as Record<
      string,
      { status: string }
    >;
    expect(caps.bomInventory.status).toBe("OK");
  });

  it("falls back to a lockfile when the dep-graph endpoint is unavailable", async () => {
    const lockfile = {
      packages: {
        "": { name: "repo", version: "1.0.0" },
        "node_modules/lodash": { version: "4.17.21" },
        "node_modules/react": { version: "18.2.0" },
      },
    };
    mockFetch([
      ...BASE_ROUTES,
      {
        path: "/repos/testorg/repo/dependency-graph/sbom",
        status: 403,
        body: { message: "Dependency graph is disabled" },
      },
      // Root listing finds package-lock.json.
      {
        path: "/repos/testorg/repo/contents",
        body: [
          { type: "file", name: "package-lock.json", path: "package-lock.json" },
          { type: "file", name: "README.md", path: "README.md" },
        ],
      },
      {
        path: "/repos/testorg/repo/contents/package-lock.json",
        body: {
          type: "file",
          encoding: "base64",
          content: Buffer.from(JSON.stringify(lockfile)).toString("base64"),
        },
      },
    ]);

    const assets = await collectAssets({
      ...MINIMAL_CONFIG,
      includeDependencyGraph: true,
    });
    const repo = assets.find((a) => a.name === "testorg/repo")!;
    expect(repo.bomEntries).toBeDefined();
    const names = repo.bomEntries!.map((e) => e.name).sort();
    expect(names).toEqual(["lodash", "react"]);
    expect(repo.bomEntries![0].evidenceSource).toBe("LOCK_FILE");
    expect(repo.bomEntries![0].evidenceDetail).toContain("package-lock.json");
    expect(validateDiscoveredAssetDetailed(repo).valid).toBe(true);
  });

  it("omits bomEntries and reports bomInventory degraded when collection fails", async () => {
    mockFetch([
      ...BASE_ROUTES,
      {
        path: "/repos/testorg/repo/dependency-graph/sbom",
        status: 403,
        body: { message: "Dependency graph is disabled" },
      },
      // Root listing: no supported lockfiles either.
      { path: "/repos/testorg/repo/contents", body: [{ type: "file", name: "README.md", path: "README.md" }] },
    ]);

    const assets = await collectAssets({
      ...MINIMAL_CONFIG,
      includeDependencyGraph: true,
    });
    const repo = assets.find((a) => a.name === "testorg/repo")!;
    // Field absent — never an empty array — so the Source's prior set is
    // preserved (FR-004).
    expect("bomEntries" in repo).toBe(false);
    const caps = (repo.details as Record<string, unknown>).capabilities as Record<
      string,
      { status: string; message?: string }
    >;
    expect(caps.bomInventory.status).not.toBe("OK");
    expect(validateDiscoveredAssetDetailed(repo).valid).toBe(true);
  });

  it("leaves bomEntries absent entirely when the toggle is off", async () => {
    mockFetch(BASE_ROUTES);
    const assets = await collectAssets({
      ...MINIMAL_CONFIG,
      includeDependencyGraph: false,
    });
    const repo = assets.find((a) => a.name === "testorg/repo")!;
    expect("bomEntries" in repo).toBe(false);
    const caps = (repo.details as Record<string, unknown>).capabilities as Record<
      string,
      { status: string }
    >;
    // No bomInventory marker at all when the feature is off.
    expect(caps.bomInventory).toBeUndefined();
  });
});

// Spec 076 / ADR-133 — declared-edge import (importDeclaredEdges).
describe("github declared edges", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("config: importDeclaredEdges defaults false and requires includeDependencyGraph", () => {
    const off = githubConfigSchema.parse({ org: "o" });
    expect(off.importDeclaredEdges).toBe(false);
    expect(() =>
      githubConfigSchema.parse({ org: "o", importDeclaredEdges: true }),
    ).toThrow();
    const on = githubConfigSchema.parse({
      org: "o",
      importDeclaredEdges: true,
      includeDependencyGraph: true,
    });
    expect(on.importDeclaredEdges).toBe(true);
  });

  it("yields LIBRARY assets + relationships when opted in", async () => {
    mockFetch([
      ...BASE_ROUTES,
      { path: "/repos/testorg/repo/dependency-graph/sbom", body: spdxDoc() },
    ]);

    const assets = await collectAssets({
      ...MINIMAL_CONFIG,
      includeDependencyGraph: true,
      importDeclaredEdges: true,
    });

    const repo = assets.find((a) => a.name === "testorg/repo")!;
    // SUBJECT→pkg edges attach to the repo asset: lodash + react are
    // direct deps of the subject; loose-envify is not.
    const targets = (repo.relationships ?? []).map((r) => r.targetExternalId).sort();
    expect(targets).toEqual(["pkg:npm/lodash", "pkg:npm/react"]);
    for (const r of repo.relationships ?? []) expect(r.type).toBe("DEPENDS_ON");

    const libs = assets.filter((a) => a.category === "LIBRARY");
    expect(libs.map((l) => l.externalId).sort()).toEqual([
      "pkg:npm/lodash",
      "pkg:npm/loose-envify",
      "pkg:npm/react",
    ]);

    const loose = libs.find((l) => l.externalId === "pkg:npm/loose-envify")!;
    expect(loose.provider).toBe("NPM");
    expect(loose.resourceType).toBe("npm");
    expect(loose.name).toBe("loose-envify");
    expect(loose.slug).toMatch(/^pkg-npm-loose-envify/);
    // `loose DEPENDENCY_OF react` → react depends on loose-envify; the edge
    // declares on the react library asset.
    const react = libs.find((l) => l.externalId === "pkg:npm/react")!;
    expect(react.relationships).toEqual([
      { type: "DEPENDS_ON", targetExternalId: "pkg:npm/loose-envify" },
    ]);
    expect(loose.relationships).toBeUndefined();
    expect(libs.find((l) => l.externalId === "pkg:npm/lodash")!.relationships).toBeUndefined();

    // Every yielded asset — repo and libraries — satisfies the contract.
    for (const asset of assets) {
      expect(validateDiscoveredAssetDetailed(asset).valid).toBe(true);
    }
  });

  it("yields neither LIBRARY assets nor relationships when opted out", async () => {
    mockFetch([
      ...BASE_ROUTES,
      { path: "/repos/testorg/repo/dependency-graph/sbom", body: spdxDoc() },
    ]);

    const assets = await collectAssets({
      ...MINIMAL_CONFIG,
      includeDependencyGraph: true,
    });
    const repo = assets.find((a) => a.name === "testorg/repo")!;
    expect(assets.filter((a) => a.category === "LIBRARY")).toHaveLength(0);
    expect(repo.relationships).toBeUndefined();
    expect(repo.bomEntries).toBeDefined();
  });

  it("emits no relationships on the lockfile-fallback path", async () => {
    const lockfile = {
      packages: {
        "": { name: "repo", version: "1.0.0" },
        "node_modules/lodash": { version: "4.17.21" },
      },
    };
    mockFetch([
      ...BASE_ROUTES,
      {
        path: "/repos/testorg/repo/dependency-graph/sbom",
        status: 403,
        body: { message: "Dependency graph is disabled" },
      },
      {
        path: "/repos/testorg/repo/contents",
        body: [{ type: "file", name: "package-lock.json", path: "package-lock.json" }],
      },
      {
        path: "/repos/testorg/repo/contents/package-lock.json",
        body: {
          type: "file",
          encoding: "base64",
          content: Buffer.from(JSON.stringify(lockfile)).toString("base64"),
        },
      },
    ]);

    const assets = await collectAssets({
      ...MINIMAL_CONFIG,
      includeDependencyGraph: true,
      importDeclaredEdges: true,
    });
    const repo = assets.find((a) => a.name === "testorg/repo")!;
    expect(repo.relationships).toBeUndefined();
    // Lockfiles carry no graph — no library assets either.
    expect(assets.filter((a) => a.category === "LIBRARY")).toHaveLength(0);
    expect(repo.bomEntries).toBeDefined();
  });
});
