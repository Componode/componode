/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../index.css"),
  "utf-8",
);

const lightBlock = css.match(/@theme\s*\{([^}]*)\}/s)?.[1] ?? "";
const darkBlock = css.match(/\.dark\s*\{([^}]*)\}/s)?.[1] ?? "";

describe("theme tokens (US1 emerald identity)", () => {
  it("light theme primary is the ratified deep emerald", () => {
    expect(lightBlock).toContain("--color-primary: hsl(163 94% 24%)");
  });

  it("dark theme primary is the ratified lighter emerald", () => {
    expect(darkBlock).toContain("--color-primary: hsl(158 64% 52%)");
  });

  it("ring follows primary in both themes (brand focus color)", () => {
    expect(lightBlock).toContain("--color-ring: hsl(163 94% 24%)");
    expect(darkBlock).toContain("--color-ring: hsl(158 64% 52%)");
  });

  it("radius is updated to 0.625rem", () => {
    expect(lightBlock).toContain("--radius: 0.625rem");
  });

  it("status green keeps its ~142° hue in both themes (brand/status separation)", () => {
    expect(lightBlock).toMatch(/--color-success: hsl\(142\s/);
    expect(darkBlock).toMatch(/--color-success: hsl\(142\s/);
  });
});
