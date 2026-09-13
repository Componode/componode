import { describe, it, expect } from "vitest";
import { isUrlAllowedForImport, assertUrlAllowedForImport } from "../../src/validation/url-safety.js";

describe("urlSafetyError / isUrlAllowedForImport", () => {
  it.each([
    "https://example.com/path",
    "https://api.github.com/repos/org/repo",
    "http://8.8.8.8/dns",
    "https://203.0.113.10/service",
  ])("allows a public URL: %s", (url) => {
    expect(isUrlAllowedForImport(url)).toBe(true);
  });

  it.each([
    "http://localhost/",
    "http://localhost:8080/health",
    "http://app.localhost/",
    "http://127.0.0.1/",
    "http://127.1/", // normalized to 127.0.0.1
    "http://2130706433/", // decimal for 127.0.0.1
    "http://0x7f000001/", // hex for 127.0.0.1
    "http://10.0.0.5/internal",
    "http://10.255.255.255/",
    "http://172.16.0.1/",
    "http://172.31.255.1/",
    "http://192.168.1.1/router",
    "http://169.254.169.254/latest/meta-data",
    "http://169.254.1.1/",
    "http://100.64.0.1/", // CGNAT
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[::]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.1.2.3]/",
    "ftp://example.com/file",
    "file:///etc/passwd",
    "gopher://example.com/",
    "http://host.local/thing",
    "not-a-url",
    "http://",
  ])("rejects an internal or unsafe URL: %s", (url) => {
    expect(isUrlAllowedForImport(url)).toBe(false);
  });

  it("assertUrlAllowedForImport throws with a reason for blocked targets", () => {
    expect(() => assertUrlAllowedForImport("http://169.254.169.254/")).toThrow(
      /not allowed for import/,
    );
    expect(() => assertUrlAllowedForImport("https://example.com")).not.toThrow();
  });
});
