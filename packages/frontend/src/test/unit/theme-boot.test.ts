import { describe, it, expect } from "vitest";
import html from "../../../index.html?raw";

/**
 * The no-flash boot contract (T031): index.html must apply the stored/system
 * theme class synchronously in <head> before first paint — a module script at
 * the bottom of <body> would flash the wrong theme.
 */
describe("theme boot script", () => {

  it("has an inline script in <head> before the module entry", () => {
    const headEnd = html.indexOf("</head>");
    const bodyIdx = html.indexOf("<body");
    expect(headEnd).toBeGreaterThan(-1);
    const head = html.slice(0, headEnd);
    expect(head).toContain("localStorage.getItem(\"theme\")");
    expect(head).toContain("prefers-color-scheme: dark");
    expect(head).toContain("classList.add(\"dark\")");
    expect(bodyIdx).toBeGreaterThan(-1);
  });

  it("treats missing or 'system' theme as system preference", () => {
    expect(html).toContain("stored === \"dark\"");
    expect(html).toContain("stored === \"system\"");
  });
});
