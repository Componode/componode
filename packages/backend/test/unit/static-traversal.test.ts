import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import staticPlugin from "@fastify/static";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Regression for 2026-09-10 assessment finding 8.2.2: @fastify/static path
// traversal / non-canonical path bypass (GHSA-83w8-p2f5-377r et al).
describe("static plugin traversal safety", () => {
  let app: FastifyInstance;
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "componode-static-"));
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "index.html"), "<html><title>Componode</title></html>");
    writeFileSync(join(root, "assets", "app.js"), "console.log('app')");
    writeFileSync(join(root, "..", "componode-static-secret.txt"), "TOP-SECRET");

    app = Fastify();
    await app.register(staticPlugin, { root, prefix: "/" });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("serves files inside the root", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("console.log");
  });

  it.each([
    "/../componode-static-secret.txt",
    "/%2e%2e/componode-static-secret.txt",
    "/%2e%2e%2fcomponode-static-secret.txt",
    "/assets/../../componode-static-secret.txt",
    "/assets/%2e%2e/%2e%2e/componode-static-secret.txt",
    "//../componode-static-secret.txt",
    "/..\\componode-static-secret.txt",
  ])("does not serve files outside the root: %s", async (path) => {
    const res = await app.inject({ method: "GET", url: path });
    expect(res.statusCode).not.toBe(200);
    expect(res.body ?? "").not.toContain("TOP-SECRET");
  });
});
