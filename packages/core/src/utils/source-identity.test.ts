import { describe, it, expect } from "vitest";
import {
  canonicalizeSourceIdentity,
  qualifyExternalId,
  isQualifiedExternalId,
  unqualifyExternalId,
} from "./source-identity.js";

describe("canonicalizeSourceIdentity", () => {
  it("strips userinfo from URL identities", () => {
    expect(
      canonicalizeSourceIdentity("https://user:secret@docker.internal:2376"),
    ).toBe("https://docker.internal:2376/");
  });

  it("strips auth query parameters and fragments", () => {
    expect(
      canonicalizeSourceIdentity(
        "https://hub.example.com/inventory?token=abc&region=eu#frag",
      ),
    ).toBe("https://hub.example.com/inventory?region=eu");
  });

  it("leaves non-URL identities untouched (trimmed)", () => {
    expect(canonicalizeSourceIdentity("  engine:3f9c1d  ")).toBe("engine:3f9c1d");
    expect(canonicalizeSourceIdentity("arn:aws:iam::123:role/x")).toBe(
      "arn:aws:iam::123:role/x",
    );
  });
});

describe("qualifyExternalId", () => {
  it("prefixes a native ID with the canonical identity", () => {
    expect(qualifyExternalId("acct-1", "us-east-1:ec2:instance")).toBe(
      "acct-1::us-east-1:ec2:instance",
    );
  });

  it("handles URL identities", () => {
    expect(
      qualifyExternalId("https://k8s.example.com/", "default:apps/v1:Deployment"),
    ).toBe("https://k8s.example.com/::default:apps/v1:Deployment");
  });
});

describe("isQualifiedExternalId / unqualifyExternalId", () => {
  it("round-trips a qualified id", () => {
    const qualified = qualifyExternalId("acct-1", "us-east-1:ec2:instance");
    expect(isQualifiedExternalId(qualified, "acct-1")).toBe(true);
    expect(unqualifyExternalId(qualified, "acct-1")).toBe(
      "us-east-1:ec2:instance",
    );
  });

  it("does not match a different source identity", () => {
    const qualified = qualifyExternalId("acct-1", "us-east-1:ec2:instance");
    expect(isQualifiedExternalId(qualified, "acct-2")).toBe(false);
    expect(unqualifyExternalId(qualified, "acct-2")).toBeNull();
  });

  it("returns null/false for unqualified ids", () => {
    expect(isQualifiedExternalId("us-east-1:ec2:instance", "acct-1")).toBe(false);
    expect(unqualifyExternalId("us-east-1:ec2:instance", "acct-1")).toBeNull();
  });

  it("preserves :: inside the native id (Alibaba ACS prefix)", () => {
    const qualified = qualifyExternalId(
      "1234567890123456",
      "ACS::ECS::Instance:i-bp1",
    );
    expect(unqualifyExternalId(qualified, "1234567890123456")).toBe(
      "ACS::ECS::Instance:i-bp1",
    );
  });

  it("strips only this identity's prefix on URL identities with ports", () => {
    const qualified = qualifyExternalId(
      "https://mcp.example.com/",
      "tools/list",
    );
    expect(unqualifyExternalId(qualified, "https://mcp.example.com/")).toBe(
      "tools/list",
    );
  });
});
