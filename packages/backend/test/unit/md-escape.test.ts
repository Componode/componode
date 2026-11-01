/**
 * Regression test for CodeQL js/incomplete-sanitization (alerts 5/6 on
 * PR 212): mdCell must escape backslashes before pipes so a literal `\`
 * cannot form unintended `\|` sequences.
 */
import { describe, it, expect } from "vitest";
import { mdCell } from "../../scripts/md-escape.js";

describe("mdCell", () => {
  it("escapes pipes", () => {
    expect(mdCell("a|b")).toBe("a\\|b");
  });

  it("escapes backslashes before pipes (order matters)", () => {
    expect(mdCell("a\\|b")).toBe("a\\\\\\|b");
    expect(mdCell("a\\b")).toBe("a\\\\b");
  });

  it("collapses whitespace and trims", () => {
    expect(mdCell("  a\nb\tc  ")).toBe("a b c");
  });

  it("leaves ordinary text untouched", () => {
    expect(mdCell("plain text")).toBe("plain text");
  });
});
