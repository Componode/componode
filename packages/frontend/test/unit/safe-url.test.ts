import { describe, it, expect } from "vitest";
import { safeUrl } from "../../src/ux/lib/safe-url";

describe("safeUrl", () => {
  it("returns http URLs unchanged", () => {
    expect(safeUrl("http://example.com")).toBe("http://example.com");
  });

  it("returns https URLs unchanged", () => {
    expect(safeUrl("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
  });

  it("returns undefined for javascript: URLs", () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("returns undefined for data: URLs", () => {
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
  });

  it("returns undefined for invalid URLs", () => {
    expect(safeUrl("not-a-url")).toBeUndefined();
  });

  it("returns undefined for null/undefined", () => {
    expect(safeUrl(null)).toBeUndefined();
    expect(safeUrl(undefined)).toBeUndefined();
    expect(safeUrl("")).toBeUndefined();
  });
});
