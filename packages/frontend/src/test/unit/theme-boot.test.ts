import { describe, it, expect } from "vitest";
import html from "../../../index.html?raw";
import boot from "../../../public/theme-boot.js?raw";

/**
 * The no-flash boot contract (T031): the theme class must apply synchronously
 * in <head> before first paint — a module script at the bottom of <body>
 * would flash the wrong theme. The script lives in public/theme-boot.js
 * (external file) because CSP script-src 'self' forbids inline scripts.
 */
describe("theme boot script", () => {
  it("loads synchronously in <head> before the module entry", () => {
    const headEnd = html.indexOf("</head>");
    const bodyIdx = html.indexOf("<body");
    expect(headEnd).toBeGreaterThan(-1);
    const head = html.slice(0, headEnd);
    expect(head).toContain('<script src="/theme-boot.js"></script>');
    expect(head).not.toContain("defer");
    expect(head).not.toContain("async");
    expect(bodyIdx).toBeGreaterThan(-1);
  });

  it("applies the stored/system theme class before paint", () => {
    expect(boot).toContain('localStorage.getItem("theme")');
    expect(boot).toContain("prefers-color-scheme: dark");
    expect(boot).toContain('classList.add("dark")');
    expect(boot).toContain('stored === "dark"');
    expect(boot).toContain('stored === "system"');
  });
});
