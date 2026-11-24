import { describe, it, expect } from "vitest";
import { slugify } from "../src/utils/slug.js";

// Normative corpus from specs/081-security-code-fixes/contracts/slug.md —
// every expectation reflects the byte-identical output of the duplicated
// implementations this replaces.
describe("slugify", () => {
  it("lowercases and replaces non-alphanumeric runs with single hyphens", () => {
    expect(slugify("My Cool Repo!")).toBe("my-cool-repo");
    expect(slugify("a!!!b")).toBe("a-b");
  });

  it("trims whitespace and leading/trailing separators", () => {
    expect(slugify("  --Foo Bar--  ")).toBe("foo-bar");
    expect(slugify("-leading")).toBe("leading");
    expect(slugify("trailing-")).toBe("trailing");
  });

  it("returns empty string for inputs with no a-z0-9 content", () => {
    expect(slugify("")).toBe("");
    expect(slugify("---")).toBe("");
    expect(slugify("!!!")).toBe("");
    expect(slugify("   ")).toBe("");
  });

  it("collapses non-Latin and unicode characters", () => {
    expect(slugify("héllo wörld")).toBe("h-llo-w-rld");
    expect(slugify("café")).toBe("caf");
  });

  it("never produces double separators", () => {
    expect(slugify("a-b--c---d")).toBe("a-b-c-d");
  });

  it("applies maxLength without leaving a dangling separator", () => {
    const long = "x".repeat(200);
    expect(slugify(long, 100)).toBe("x".repeat(100));
    // cut lands immediately after a separator → strip the dangling '-'
    const withBoundary = "a".repeat(99) + "-" + "b".repeat(50);
    expect(slugify(withBoundary, 100)).toBe("a".repeat(99));
    expect(slugify("a-b-c", 3)).toBe("a-b");
  });

  it("runs in linear time on adversarial separator runs", () => {
    const hostile = "x" + "-".repeat(1_000_000) + "y";
    const start = performance.now();
    const result = slugify(hostile);
    const elapsed = performance.now() - start;
    expect(result).toBe("x-y");
    expect(elapsed).toBeLessThan(500);
  });
});
