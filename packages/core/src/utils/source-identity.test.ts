import { describe, it, expect } from "vitest";
import { canonicalizeSourceIdentity } from "./source-identity.js";

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
