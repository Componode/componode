import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";

// Spec 081 US2 — issuer validation matrix (contracts/oidc-issuer.md).
// Rejected issuers must fail with 422 OIDC_DISCOVERY_FAILED *before* any
// outbound request; accepted issuers must reach the discovery fetch.
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function discoveryResponse(issuer: string) {
  return new Response(
    JSON.stringify({ issuer }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("OIDC issuer validation (SSRF hardening)", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let originalDbUrl: string | undefined;
  let originalNodeEnv: string | undefined;
  let originalBootstrapUsername: string | undefined;
  let originalBootstrapPassword: string | undefined;

  beforeEach(async () => {
    originalDbUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    originalBootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
    originalBootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    vi.resetModules();

    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();

    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return discoveryResponse(url.replace("/.well-known/openid-configuration", ""));
      }
      return new Response("unexpected fetch target", { status: 500 });
    });
  });

  afterEach(async () => {
    fetchSpy?.mockRestore();
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    else delete process.env.DATABASE_URL;
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalBootstrapUsername !== undefined) process.env.BOOTSTRAP_ADMIN_USERNAME = originalBootstrapUsername;
    else delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    if (originalBootstrapPassword !== undefined) process.env.BOOTSTRAP_ADMIN_PASSWORD = originalBootstrapPassword;
    else delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    vi.resetModules();
  });

  function putOidc(issuer: string) {
    return app.inject({
      method: "PUT",
      url: "/api/v1/settings/oidc",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        enabled: true,
        issuer,
        clientId: "test-client",
        clientSecretRef: "env:OIDC_CLIENT_SECRET",
      },
    });
  }

  it.each([
    ["ftp://idp.example.com", "non-http scheme"],
    ["file:///etc/passwd", "non-http scheme"],
    ["http://10.0.0.1:8080", "non-loopback http"],
    ["http://idp.internal.example", "non-loopback http"],
    ["https://user:pass@idp.example.com", "embedded credentials"],
    ["https://idp.example.com?x=1", "query component"],
    ["https://idp.example.com#frag", "fragment"],
  ])("rejects %s (%s) with 422 and no outbound fetch", async (issuer) => {
    const res = await putOidc(issuer);

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("OIDC_DISCOVERY_FAILED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
    "https://idp.example.com",
  ])("accepts %s and performs discovery fetch", async (issuer) => {
    const res = await putOidc(issuer);

    expect(res.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetched = String(fetchSpy.mock.calls[0][0]);
    expect(fetched).toMatch(/\/\.well-known\/openid-configuration$/);
  });

  it("rejects when discovery response content-length exceeds 64 KiB", async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response("{}", {
        status: 200,
        headers: { "content-length": String(70 * 1024) },
      });
    });

    const res = await putOidc("https://idp.example.com");
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("OIDC_DISCOVERY_FAILED");
  });

  it("rejects when discovery body exceeds 64 KiB without content-length", async () => {
    fetchSpy.mockImplementation(async () => {
      const body = JSON.stringify({
        issuer: "https://idp.example.com",
        padding: "x".repeat(70 * 1024),
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await putOidc("https://idp.example.com");
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("OIDC_DISCOVERY_FAILED");
  });
});
