import { describe, it, expect } from "vitest";
import { getManifests, getManifest, getImporter } from "../../src/services/importer-registry.js";
import type { Importer } from "@componode/core";

describe("importer registry", () => {
  it("returns the github manifest", async () => {
    const manifests = await getManifests();
    const github = manifests.find((m) => m.name === "github");
    expect(github).toBeDefined();
    expect(github?.label).toBe("GitHub");
    expect(github?.configSchema).toBeDefined();
  });

  it("getManifest returns a manifest by name", async () => {
    const manifest = await getManifest("github");
    expect(manifest.name).toBe("github");
  });

  it("getManifest throws for unknown importers", async () => {
    await expect(getManifest("unknown")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getImporter returns a github importer instance", async () => {
    const importer = await getImporter("github");
    expect(importer.name).toBe("github");
    expect(typeof importer.run).toBe("function");
  });

  it("getImporter throws for unknown importers", async () => {
    await expect(getImporter("unknown")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // spec 013 FR-009: manifests declare the secret keys they consume so
  // save-time coverage validation and credential forms can name them.
  it("github declares the required token secret", async () => {
    const manifest = await getManifest("github");
    expect(manifest.secrets).toEqual([
      { key: "token", label: "Personal access token", required: true },
    ]);
  });

  it("ambient-credential importers declare no required secrets", async () => {
    const manifests = await getManifests();
    for (const name of ["aws", "azure", "kubernetes", "web-url", "api-url", "mcp-server"]) {
      const manifest = manifests.find((m) => m.name === name);
      expect(manifest, name).toBeDefined();
      expect(manifest?.secrets ?? [], name).toEqual([]);
    }
  });
});
