import { describe, it, expect, vi, afterEach } from "vitest";
import { SbomFileImporter } from "../src/importer.js";
import {
  validateDiscoveredAsset,
  NOOP_LOGGER,
  type DiscoveredAsset,
  type ImporterContext,
} from "@componode/core";

// Spec 073 US3 (T037) — CycloneDX JSON ingestion: nested components→children,
// scope/direct mapping, tools→evidenceDetail, and a validateDiscoveredAsset
// pass on the yielded component.

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

function mockFetch(doc: unknown) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    return new Response(JSON.stringify(doc), {
      status: 200,
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

const CDX = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  metadata: {
    component: { type: "application", name: "payments-api", "bom-ref": "root" },
    tools: [{ name: "syft", version: "1.14.0" }],
  },
  components: [
    {
      type: "library",
      "bom-ref": "ref-express",
      purl: "pkg:npm/express@4.19.2",
      name: "express",
      version: "4.19.2",
      scope: "required",
      supplier: { name: "OpenJS Foundation" },
      licenses: [{ license: { id: "MIT" } }],
      cpe: "cpe:2.3:a:expressjs:express:4.19.2:*:*:*:*:*:*:*",
      hashes: [{ alg: "SHA-256", content: "abc123" }],
      components: [
        {
          type: "library",
          "bom-ref": "ref-accepts",
          purl: "pkg:npm/accepts@1.3.8",
          name: "accepts",
          version: "1.3.8",
        },
      ],
    },
    {
      type: "library",
      "bom-ref": "ref-tsd",
      purl: "pkg:npm/tsd@0.30.0",
      name: "tsd",
      scope: "excluded",
      licenses: [{ expression: "(MIT OR Apache-2.0)" }],
    },
    {
      type: "library",
      "bom-ref": "ref-maybe",
      purl: "pkg:npm/fancy@1.0.0",
      name: "fancy",
      scope: "optional",
    },
    {
      type: "library",
      purl: "pkg:npm/defaulted@1.0.0",
      name: "defaulted",
    },
  ],
  dependencies: [
    { ref: "root", dependsOn: ["ref-express", "ref-tsd"] },
    { ref: "ref-express", dependsOn: ["ref-accepts"] },
  ],
};

describe("sbom-file CycloneDX ingestion (spec 073)", () => {
  it("parses components, maps scope, and nests children[]", async () => {
    mockFetch(CDX);
    const { assets } = await run();
    expect(assets).toHaveLength(1);
    const asset = assets[0]!;
    expect(() => validateDiscoveredAsset(asset)).not.toThrow();

    const entries = asset.bomEntries ?? [];
    expect(entries).toHaveLength(4);
    const [express, tsd, fancy, defaulted] = entries;
    expect(express!.scope).toBe("RUNTIME");
    expect(express!.version).toBe("4.19.2");
    expect(express!.children).toHaveLength(1);
    expect(express!.children![0]!.name).toBe("accepts");
    expect(tsd!.scope).toBe("DEV");
    expect(fancy!.scope).toBe("OPTIONAL");
    expect(defaulted!.scope).toBe("RUNTIME");
  });

  it("refines direct from dependencies[] — subject edges direct, deeper edges transitive", async () => {
    mockFetch(CDX);
    const { assets } = await run();
    const [express, tsd, fancy] = assets[0]!.bomEntries!;
    expect(express!.direct).toBe(true);
    expect(tsd!.direct).toBe(true);
    // Not mentioned in any dependency edge → direct stays undefined.
    expect(fancy!.direct).toBeUndefined();
    expect(express!.children![0]!.direct).toBe(false);
  });

  it("carries licenses, supplier, checksums/cpe into details, and tools into evidenceDetail", async () => {
    mockFetch(CDX);
    const { assets } = await run();
    const express = assets[0]!.bomEntries![0]!;
    expect(express.licenses).toEqual(["MIT"]);
    expect(express.supplier).toBe("OpenJS Foundation");
    expect((express.details as Record<string, unknown>).checksums).toEqual(["SHA-256:abc123"]);
    expect(express.details!.cpe).toMatch(/^cpe:2\.3/);
    expect(express.evidenceSource).toBe("SBOM_DOCUMENT");
    expect(express.evidenceDetail).toContain("syft");
    const tsd = assets[0]!.bomEntries![1]!;
    expect(tsd.licenses).toEqual(["(MIT OR Apache-2.0)"]);
  });

  it("marks the capability OK and reports the resolved identity", async () => {
    mockFetch(CDX);
    const { assets, context } = await run();
    const caps = (assets[0]!.details as Record<string, { bomInventory: { status: string } }>)
      .capabilities;
    expect(caps.bomInventory.status).toBe("OK");
    expect(context.reportSourceIdentity).toHaveBeenCalledWith({
      externalIdentity: `sbom-file:${CONFIG.sbomUrl}`,
      label: `SBOM file ${CONFIG.sbomUrl}`,
    });
    expect(assets[0]!.externalId).toBe("octo/payments-api");
    expect(assets[0]!.bomEntries).toBeDefined(); // presence = collection finished
  });

  it("skips purl-less components with an OK+message marker", async () => {
    mockFetch({
      ...CDX,
      components: [
        { type: "library", name: "no-purl" },
        { type: "library", purl: "pkg:npm/kept@1.0.0", name: "kept" },
      ],
      dependencies: [],
    });
    const { assets } = await run();
    expect(assets[0]!.bomEntries).toHaveLength(1);
    const caps = (assets[0]!.details as Record<string, { bomInventory: { status: string; message?: string } }>)
      .capabilities;
    expect(caps.bomInventory.status).toBe("OK");
    expect(caps.bomInventory.message).toMatch(/1 package/);
  });
});
