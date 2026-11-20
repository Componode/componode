import { describe, it, expect } from "vitest";
import {
  validateDiscoveredAsset,
  validateDiscoveredAssetDetailed,
} from "../../src/validation/discovered-asset.js";

const baseAsset = {
  category: "REPOSITORY",
  provider: "GITHUB",
  resourceType: "github:repository",
  name: "repo",
  externalId: "owner/repo",
  instances: [],
};

const entry = {
  purl: "pkg:npm/lodash@4.17.21",
  name: "lodash",
  evidenceSource: "LOCK_FILE",
};

describe("validateDiscoveredAsset — bomEntries (ADR-057 A1)", () => {
  it("accepts an asset without bomEntries (field absent preserved)", () => {
    expect(validateDiscoveredAsset(baseAsset)).toBe(true);
  });

  it("accepts bomEntries: [] (empty = finished, truth is empty)", () => {
    expect(validateDiscoveredAsset({ ...baseAsset, bomEntries: [] })).toBe(true);
  });

  it("accepts a full entry and defaults nothing in", () => {
    const asset = { ...baseAsset, bomEntries: [entry] };
    expect(validateDiscoveredAsset(asset)).toBe(true);
  });

  it("accepts nested children recursively", () => {
    const nested = {
      ...entry,
      purl: "pkg:deb/debian@bullseye",
      name: "debian",
      scope: "SYSTEM",
      children: [
        { purl: "pkg:deb/libc6@2.31", name: "libc6", evidenceSource: "IMAGE_LAYER" },
      ],
    };
    expect(
      validateDiscoveredAsset({ ...baseAsset, bomEntries: [nested] }),
    ).toBe(true);
  });

  it("accepts bomEntries on instances (instance scope)", () => {
    const asset = {
      ...baseAsset,
      instances: [
        { environment: "PRODUCTION", externalId: "i-1", bomEntries: [entry] },
      ],
    };
    expect(validateDiscoveredAsset(asset)).toBe(true);
  });

  it("rejects an invalid purl", () => {
    const bad = { ...entry, purl: "not-a-purl" };
    const result = validateDiscoveredAssetDetailed({
      ...baseAsset,
      bomEntries: [bad],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects missing required fields", () => {
    const noName = { purl: "pkg:npm/lodash@4.17.21", evidenceSource: "LOCK_FILE" };
    const noEvidence = { purl: "pkg:npm/lodash@4.17.21", name: "lodash" };
    expect(validateDiscoveredAsset({ ...baseAsset, bomEntries: [noName] })).toBe(false);
    expect(validateDiscoveredAsset({ ...baseAsset, bomEntries: [noEvidence] })).toBe(false);
  });

  it("rejects unknown enum values", () => {
    const badScope = { ...entry, scope: "WHATEVER" };
    const badEvidence = { ...entry, evidenceSource: "MAGIC" };
    const badCdx = { ...entry, cdxType: "spaceship" };
    expect(validateDiscoveredAsset({ ...baseAsset, bomEntries: [badScope] })).toBe(false);
    expect(validateDiscoveredAsset({ ...baseAsset, bomEntries: [badEvidence] })).toBe(false);
    expect(validateDiscoveredAsset({ ...baseAsset, bomEntries: [badCdx] })).toBe(false);
  });
});
