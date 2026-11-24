import { describe, it, expect } from "vitest";
import { SLUG_RE, deriveSlug } from "@/ux/lib/slug";

// Parity corpus with @componode/core slugify (spec 081,
// specs/081-security-code-fixes/contracts/slug.md). deriveSlug is the
// browser-side mirror — the expectations are identical by contract.
describe("deriveSlug", () => {
  it("lowercases and replaces non-alphanumeric runs with single hyphens", () => {
    expect(deriveSlug("My Cool Repo!")).toBe("my-cool-repo");
    expect(deriveSlug("a!!!b")).toBe("a-b");
  });

  it("trims whitespace and leading/trailing separators", () => {
    expect(deriveSlug("  --Foo Bar--  ")).toBe("foo-bar");
    expect(deriveSlug("-leading")).toBe("leading");
    expect(deriveSlug("trailing-")).toBe("trailing");
  });

  it("returns empty string for inputs with no a-z0-9 content", () => {
    expect(deriveSlug("")).toBe("");
    expect(deriveSlug("---")).toBe("");
    expect(deriveSlug("!!!")).toBe("");
  });

  it("collapses non-Latin and unicode characters", () => {
    expect(deriveSlug("héllo wörld")).toBe("h-llo-w-rld");
    expect(deriveSlug("café")).toBe("caf");
  });

  it("never produces double separators", () => {
    expect(deriveSlug("a-b--c---d")).toBe("a-b-c-d");
  });

  it("produces only SLUG_RE-valid output for non-empty results", () => {
    for (const input of ["My Cool Repo!", "a!!!b", "foo bar", "x".repeat(500)]) {
      expect(SLUG_RE.test(deriveSlug(input))).toBe(true);
    }
  });

  it("runs in linear time on adversarial separator runs", () => {
    const hostile = "x" + "-".repeat(1_000_000) + "y";
    const start = performance.now();
    const result = deriveSlug(hostile);
    const elapsed = performance.now() - start;
    expect(result).toBe("x-y");
    expect(elapsed).toBeLessThan(500);
  });
});
