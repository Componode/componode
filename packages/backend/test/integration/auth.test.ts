import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  createPersonInDb,
  csrfCookie,
  csrfHeader,
  getCookie,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("auth", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let originalDbUrl: string | undefined;
  let originalBootstrapUsername: string | undefined;
  let originalBootstrapPassword: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(async () => {
    originalDbUrl = process.env.DATABASE_URL;
    originalBootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
    originalBootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    originalNodeEnv = process.env.NODE_ENV;

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
  });

  afterEach(async () => {
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    else delete process.env.DATABASE_URL;
    if (originalBootstrapUsername !== undefined) process.env.BOOTSTRAP_ADMIN_USERNAME = originalBootstrapUsername;
    else delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    if (originalBootstrapPassword !== undefined) process.env.BOOTSTRAP_ADMIN_PASSWORD = originalBootstrapPassword;
    else delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    vi.resetModules();
  });

  it("login with valid credentials returns 200 and sets a session cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toBeDefined();
    expect(body.user.username).toBe(ADMIN_USERNAME);
    const session = getCookie(res, SESSION_COOKIE_NAME);
    expect(session).toBeTruthy();
  });

  it("login with wrong password returns 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { username: ADMIN_USERNAME, password: "WrongPassword123!" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("login with non-existent user returns 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { username: "no-such-user", password: "Whatever123!" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("login for a non-existent user still runs a password verification (timing equalization)", async () => {
    const real = await vi.importActual<typeof import("../../src/utils/argon2.js")>(
      "../../src/utils/argon2.js",
    );
    const dummyVerify = vi.fn(real.verifyAgainstDummyHash);
    vi.doMock("../../src/utils/argon2.js", () => ({
      ...real,
      verifyAgainstDummyHash: dummyVerify,
    }));
    vi.resetModules();

    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    if (app) await app.close();
    app = await buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { username: "ghost-user", password: "Whatever123!" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(dummyVerify).toHaveBeenCalledWith("Whatever123!");
    vi.doUnmock("../../src/utils/argon2.js");
  });

  it("login with a legacy sub-12-char password still succeeds", async () => {
    // Passwords created before the 12-char policy must keep authenticating
    // (ADR-099 — the minimum applies to set paths only).
    const { hashPassword } = await import("../../src/utils/argon2.js");
    await createPersonInDb(testDb!.db, {
      username: "legacyuser",
      passwordHash: await hashPassword("Legacy9pw!"),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { username: "legacyuser", password: "Legacy9pw!" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("GET /auth/session with a valid cookie returns 200", async () => {
    const session = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
    expect(session).toBeTruthy();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      cookies: { [SESSION_COOKIE_NAME]: session! },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe(ADMIN_USERNAME);
  });

  it("GET /auth/session with no cookie returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("AUTH_NO_SESSION");
  });

  it("logout returns 204 and clears the session cookie", async () => {
    const session = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
    expect(session).toBeTruthy();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: { [SESSION_COOKIE_NAME]: session!, ...csrfCookie },
      headers: csrfHeader,
    });

    expect(res.statusCode).toBe(204);
    // The set-cookie header should clear the session cookie (Max-Age=0 / expired)
    const setCookie = res.headers["set-cookie"];
    const headerStr = Array.isArray(setCookie) ? setCookie.join("\n") : String(setCookie ?? "");
    expect(headerStr).toContain(SESSION_COOKIE_NAME);
  });
});
