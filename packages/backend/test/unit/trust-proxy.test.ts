import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

// Regression for 2026-09-10 assessment finding 8.2.3: trustProxy: true let
// clients spoof X-Forwarded-For and evade IP-based rate limiting.
describe("trustProxy configuration", () => {
  let app: FastifyInstance | undefined;
  const original = process.env.TRUSTED_PROXY_IP;
  const originalDbUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    // db/connection.ts requires DATABASE_URL at module load; the /__ip probe
    // route never issues a query.
    process.env.DATABASE_URL = "postgres://127.0.0.1:1/componode-test";
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    if (original === undefined) delete process.env.TRUSTED_PROXY_IP;
    else process.env.TRUSTED_PROXY_IP = original;
    if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDbUrl;
  });

  it("defaults to no proxy trust when TRUSTED_PROXY_IP is unset", async () => {
    delete process.env.TRUSTED_PROXY_IP;
    const { resolveTrustProxy } = await import("../../src/app.js");
    expect(resolveTrustProxy()).toBe(false);
  });

  it("parses a single IP, a comma-separated list, and a hop count", async () => {
    const { resolveTrustProxy } = await import("../../src/app.js");
    process.env.TRUSTED_PROXY_IP = "10.0.0.1";
    expect(resolveTrustProxy()).toBe("10.0.0.1");
    process.env.TRUSTED_PROXY_IP = "10.0.0.1, 10.0.0.2";
    expect(resolveTrustProxy()).toEqual(["10.0.0.1", "10.0.0.2"]);
    process.env.TRUSTED_PROXY_IP = "2";
    expect(resolveTrustProxy()).toBe(2);
  });

  it("ignores a forged X-Forwarded-For when no trusted proxy is configured", async () => {
    delete process.env.TRUSTED_PROXY_IP;
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    app.get("/__ip", (req, reply) => reply.send({ ip: req.ip }));
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/__ip",
      headers: { "x-forwarded-for": "203.0.113.99" },
    });
    expect(res.json().ip).toBe("127.0.0.1");
  });

  it("honors X-Forwarded-For when the peer is in TRUSTED_PROXY_IP", async () => {
    process.env.TRUSTED_PROXY_IP = "127.0.0.1";
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    app.get("/__ip", (req, reply) => reply.send({ ip: req.ip }));
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/__ip",
      headers: { "x-forwarded-for": "203.0.113.99" },
    });
    expect(res.json().ip).toBe("203.0.113.99");
  });
});
