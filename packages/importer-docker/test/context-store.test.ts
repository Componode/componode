import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { resolveDockerContext } from "../src/context-store.js";

const dirHash = (name: string) =>
  createHash("sha256").update(name).digest("hex");

describe("resolveDockerContext", () => {
  let store: string;

  function writeContext(name: string, meta: object) {
    const metaDir = join(store, "contexts", "meta", dirHash(name));
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(join(metaDir, "meta.json"), JSON.stringify(meta));
  }

  beforeAll(() => {
    store = mkdtempSync(join(tmpdir(), "ctx-store-"));
    writeContext("local", {
      Name: "local",
      Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } },
      Storage: {},
    });
    writeContext("npipe", {
      Name: "npipe",
      Endpoints: { docker: { Host: "npipe:////./pipe/docker_engine" } },
    });
    writeContext("bad-tls", {
      Name: "bad-tls",
      Endpoints: { docker: { Host: "tcp://h:2376", SkipTLSVerify: true } },
    });
    writeContext("ssh-ctx", {
      Name: "ssh-ctx",
      Endpoints: { docker: { Host: "ssh://u@h" } },
    });
    const tlsDir = join(store, "contexts", "tls", "th", "docker");
    mkdirSync(tlsDir, { recursive: true });
    writeFileSync(join(tlsDir, "ca.pem"), "CA");
    writeFileSync(join(tlsDir, "cert.pem"), "CERT");
    writeFileSync(join(tlsDir, "key.pem"), "KEY");
    writeContext("mtls", {
      Name: "mtls",
      Endpoints: { docker: { Host: "tcp://d.example:2376" } },
      Storage: { TLSPath: join(store, "contexts", "tls", "th") },
    });
  });

  afterAll(() => rmSync(store, { recursive: true, force: true }));

  it("resolves unix and npipe contexts to socketPath", () => {
    expect(resolveDockerContext("local", store)).toEqual({
      socketPath: "/var/run/docker.sock",
    });
    expect(resolveDockerContext("npipe", store)).toEqual({
      socketPath: "//./pipe/docker_engine",
    });
  });

  it("resolves tcp contexts with TLS material from the store", () => {
    const mtls = resolveDockerContext("mtls", store) as Record<
      string,
      unknown
    >;
    expect(mtls).toMatchObject({
      protocol: "https",
      host: "d.example",
      port: 2376,
    });
    expect((mtls.cert as Buffer).toString()).toBe("CERT");
    expect((mtls.key as Buffer).toString()).toBe("KEY");
    expect((mtls.ca as Buffer).toString()).toBe("CA");
  });

  it("rejects default, SkipTLSVerify, ssh endpoints, and missing contexts", () => {
    expect(() => resolveDockerContext("default", store)).toThrow(/default/);
    expect(() => resolveDockerContext("bad-tls", store)).toThrow(
      /SkipTLSVerify/,
    );
    expect(() => resolveDockerContext("ssh-ctx", store)).toThrow(/ssh/);
    expect(() => resolveDockerContext("missing", store)).toThrow(
      /not present/,
    );
  });
});
