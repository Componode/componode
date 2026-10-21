import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveAgentToken, resolveEnrollmentToken } from "../src/config.js";

// Spec 025 US5 / T037: env parsing rules for the agent runtime.

describe("loadConfig", () => {
  it("requires HUB_URL", () => {
    expect(() => loadConfig({})).toThrow(/HUB_URL/);
  });

  it("accepts https hub URLs and a CA bundle", () => {
    const cfg = loadConfig({
      HUB_URL: "https://hub.corp.internal",
      CA_BUNDLE: "/etc/ssl/corp-ca.pem",
      AGENT_TOKEN: "tok",
    });
    expect(cfg.hubUrl).toBe("https://hub.corp.internal");
    expect(cfg.caBundle).toBe("/etc/ssl/corp-ca.pem");
  });

  it("refuses insecure ws:// or http:// to non-loopback hosts", () => {
    expect(() => loadConfig({ HUB_URL: "ws://hub.corp.internal" })).toThrow(/TLS|insecure|http/i);
    expect(() => loadConfig({ HUB_URL: "http://10.0.0.5" })).toThrow(/TLS|insecure|http/i);
  });

  it("allows http:// to loopback for local dev", () => {
    const cfg = loadConfig({ HUB_URL: "http://localhost:3000" });
    expect(cfg.hubUrl).toBe("http://localhost:3000");
    const cfg2 = loadConfig({ HUB_URL: "http://127.0.0.1:3000" });
    expect(cfg2.hubUrl).toBe("http://127.0.0.1:3000");
  });

  it("translates ws(s) hub URLs to http(s)", () => {
    expect(loadConfig({ HUB_URL: "wss://hub.corp" }).hubUrl).toBe("https://hub.corp");
    expect(loadConfig({ HUB_URL: "ws://localhost:1" }).hubUrl).toBe("http://localhost:1");
  });

  it("defaults AGENT_STATE_DIR and MAX_JOBS", () => {
    const cfg = loadConfig({ HUB_URL: "https://hub.corp" });
    expect(cfg.stateDir).toBeTruthy();
    expect(cfg.maxJobs).toBe(1);
  });

  it("parses proxy variables", () => {
    const cfg = loadConfig({
      HUB_URL: "https://hub.corp",
      HTTPS_PROXY: "http://proxy:3128",
      NO_PROXY: "localhost,.internal",
    });
    expect(cfg.httpsProxy).toBe("http://proxy:3128");
    expect(cfg.noProxy).toBe("localhost,.internal");
  });

  it("rejects a non-positive MAX_JOBS", () => {
    expect(() => loadConfig({ HUB_URL: "https://hub.corp", MAX_JOBS: "0" })).toThrow();
  });
});

describe("credential precedence", () => {
  it("prefers AGENT_TOKEN_FILE over AGENT_TOKEN", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-cfg-"));
    const file = join(dir, "token");
    writeFileSync(file, "file-token\n");
    const cfg = loadConfig({
      HUB_URL: "https://hub.corp",
      AGENT_TOKEN: "env-token",
      AGENT_TOKEN_FILE: file,
    });
    expect(resolveAgentToken(cfg)).toBe("file-token");
  });

  it("falls back to AGENT_TOKEN when no file is set", () => {
    const cfg = loadConfig({ HUB_URL: "https://hub.corp", AGENT_TOKEN: "env-token" });
    expect(resolveAgentToken(cfg)).toBe("env-token");
  });

  it("prefers AGENT_ENROLLMENT_TOKEN_FILE over the env var", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-cfg-"));
    const file = join(dir, "enroll");
    writeFileSync(file, "file-enroll");
    const cfg = loadConfig({
      HUB_URL: "https://hub.corp",
      AGENT_ENROLLMENT_TOKEN: "env-enroll",
      AGENT_ENROLLMENT_TOKEN_FILE: file,
    });
    expect(resolveEnrollmentToken(cfg)).toBe("file-enroll");
  });

  it("returns undefined when no credential material exists", () => {
    const cfg = loadConfig({ HUB_URL: "https://hub.corp" });
    expect(resolveAgentToken(cfg)).toBeUndefined();
    expect(resolveEnrollmentToken(cfg)).toBeUndefined();
  });
});
