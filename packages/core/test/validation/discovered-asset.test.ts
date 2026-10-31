import { describe, it, expect } from "vitest";
import { validateDiscoveredAsset } from "../../src/validation/discovered-asset.js";

const baseAsset = {
  category: "REPOSITORY" as const,
  provider: "GITHUB" as const,
  resourceType: "github:repository",
  name: "org/repo",
  externalId: "org/repo",
  slug: "repo",
  instances: [
    {
      environment: "PRODUCTION" as const,
      externalId: "main",
      deployedAt: "2024-01-01T00:00:00Z",
    },
  ],
  details: null,
};

describe("validateDiscoveredAsset", () => {
  it("accepts a valid discovered asset with per-instance externalId", () => {
    expect(validateDiscoveredAsset(baseAsset)).toBe(true);
  });

  it("rejects an instance missing externalId", () => {
    expect(
      validateDiscoveredAsset({
        ...baseAsset,
        instances: [{ environment: "PRODUCTION" }],
      }),
    ).toBe(false);
  });

  it("rejects an empty instance externalId", () => {
    expect(
      validateDiscoveredAsset({
        ...baseAsset,
        instances: [{ environment: "PRODUCTION", externalId: "" }],
      }),
    ).toBe(false);
  });

  it("rejects a null instance externalId", () => {
    expect(
      validateDiscoveredAsset({
        ...baseAsset,
        instances: [{ environment: "PRODUCTION", externalId: null }],
      }),
    ).toBe(false);
  });

  it("accepts an asset without an optional slug", () => {
    const { slug, ...withoutSlug } = baseAsset;
    expect(validateDiscoveredAsset(withoutSlug)).toBe(true);
  });

  it("rejects an unknown category", () => {
    expect(
      validateDiscoveredAsset({
        ...baseAsset,
        category: "UNKNOWN_CATEGORY",
      }),
    ).toBe(false);
  });

  it("rejects an unknown provider", () => {
    expect(
      validateDiscoveredAsset({
        ...baseAsset,
        provider: "UNKNOWN_PROVIDER",
      }),
    ).toBe(false);
  });

  it("rejects a missing instances array", () => {
    expect(validateDiscoveredAsset({ ...baseAsset, instances: undefined })).toBe(false);
  });

  it("accepts asset-level and instance-level sourceDetails", () => {
    expect(
      validateDiscoveredAsset({
        ...baseAsset,
        sourceDetails: { arn: "arn:x", identityType: "AK" },
        instances: [
          {
            environment: "PRODUCTION" as const,
            externalId: "main",
            sourceDetails: { node: "i-1" },
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects a non-object sourceDetails", () => {
    expect(
      validateDiscoveredAsset({ ...baseAsset, sourceDetails: "nope" }),
    ).toBe(false);
    expect(
      validateDiscoveredAsset({
        ...baseAsset,
        instances: [
          {
            environment: "PRODUCTION" as const,
            externalId: "main",
            sourceDetails: 42,
          },
        ],
      }),
    ).toBe(false);
  });
});
