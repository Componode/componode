import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  createPersonInDb,
  createSessionInDb,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("settings enforcement", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let originalDbUrl: string | undefined;
  let originalNodeEnv: string | undefined;
  let originalBootstrapUsername: string | undefined;
  let originalBootstrapPassword: string | undefined;
  let originalAllowSelfRegistration: string | undefined;
  let originalSessionIdleTimeoutMs: string | undefined;
  let originalSessionAbsoluteTimeoutMs: string | undefined;
  let originalDefaultUserRole: string | undefined;

  beforeEach(async () => {
    originalDbUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    originalBootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
    originalBootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    originalAllowSelfRegistration = process.env.ALLOW_SELF_REGISTRATION;
    originalSessionIdleTimeoutMs = process.env.SESSION_IDLE_TIMEOUT_MS;
    originalSessionAbsoluteTimeoutMs = process.env.SESSION_ABSOLUTE_TIMEOUT_MS;
    originalDefaultUserRole = process.env.DEFAULT_USER_ROLE;

    delete process.env.ALLOW_SELF_REGISTRATION;
    delete process.env.SESSION_IDLE_TIMEOUT_MS;
    delete process.env.SESSION_ABSOLUTE_TIMEOUT_MS;
    delete process.env.DEFAULT_USER_ROLE;

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
  });

  afterEach(async () => {
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
    if (originalAllowSelfRegistration !== undefined) process.env.ALLOW_SELF_REGISTRATION = originalAllowSelfRegistration;
    else delete process.env.ALLOW_SELF_REGISTRATION;
    if (originalSessionIdleTimeoutMs !== undefined) process.env.SESSION_IDLE_TIMEOUT_MS = originalSessionIdleTimeoutMs;
    else delete process.env.SESSION_IDLE_TIMEOUT_MS;
    if (originalSessionAbsoluteTimeoutMs !== undefined) process.env.SESSION_ABSOLUTE_TIMEOUT_MS = originalSessionAbsoluteTimeoutMs;
    else delete process.env.SESSION_ABSOLUTE_TIMEOUT_MS;
    if (originalDefaultUserRole !== undefined) process.env.DEFAULT_USER_ROLE = originalDefaultUserRole;
    else delete process.env.DEFAULT_USER_ROLE;
    vi.resetModules();
  });

  async function patchSettings(payload: Record<string, unknown>) {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload,
    });
    expect(res.statusCode).toBe(200);
    return res.json().settings;
  }

  it("session idle timeout from settings rejects an idle request", async () => {
    await patchSettings({ sessionIdleTimeoutMs: 60000 });

    process.env.SESSION_IDLE_TIMEOUT_MS = "1";

    const viewerId = await createPersonInDb(testDb!.db, {
      username: "viewer",
      passwordHash: "$argon2id$dummy",
      role: "VIEWER",
    });
    const { token: viewerSession } = await createSessionInDb(testDb!.db, viewerId);

    await new Promise((r) => setTimeout(r, 5));

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      cookies: { [SESSION_COOKIE_NAME]: viewerSession },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("AUTH_NO_SESSION");
  });

  it("session absolute timeout from settings rejects an expired request", async () => {
    process.env.SESSION_ABSOLUTE_TIMEOUT_MS = "1";

    const viewerId = await createPersonInDb(testDb!.db, {
      username: "viewer",
      passwordHash: "$argon2id$dummy",
      role: "VIEWER",
    });

    const { createSession } = await import("../../src/services/session-service.js");
    const sessionToken = await createSession(viewerId);

    await new Promise((r) => setTimeout(r, 5));

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      cookies: { [SESSION_COOKIE_NAME]: sessionToken },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("AUTH_NO_SESSION");
  });

  it("allowSelfRegistration setting disables and enables registration", async () => {
    await patchSettings({ allowSelfRegistration: false });

    const disabled = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: {
        username: "new-user-1",
        password: "Password123!",
        displayName: "New User",
      },
    });
    expect(disabled.statusCode).toBe(404);
    expect(disabled.json().code).toBe("NOT_FOUND");

    await patchSettings({ allowSelfRegistration: true });

    const enabled = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: {
        username: "new-user-1",
        password: "Password123!",
        displayName: "New User",
      },
    });
    expect(enabled.statusCode).toBe(201);
    expect(enabled.json().user.role).toBe("VIEWER");
  });

  it("defaultUserRole setting is applied to self-registration", async () => {
    await patchSettings({
      allowSelfRegistration: true,
      defaultUserRole: "EDITOR",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: {
        username: "new-editor",
        password: "Password123!",
        displayName: "New Editor",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe("EDITOR");
  });

  it("environment variables override persisted settings", async () => {
    process.env.ALLOW_SELF_REGISTRATION = "false";
    process.env.SESSION_IDLE_TIMEOUT_MS = "1234";
    process.env.SESSION_ABSOLUTE_TIMEOUT_MS = "5678";
    process.env.DEFAULT_USER_ROLE = "ADMIN";

    await patchSettings({
      allowSelfRegistration: true,
      sessionIdleTimeoutMs: 60000,
      sessionAbsoluteTimeoutMs: 300000,
      defaultUserRole: "VIEWER",
    });

    const reg = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: {
        username: "env-override",
        password: "Password123!",
        displayName: "Env Override",
      },
    });
    expect(reg.statusCode).toBe(404);

    const settingsRes = await app.inject({
      method: "GET",
      url: "/api/v1/settings",
      cookies: { [SESSION_COOKIE_NAME]: adminSession! },
    });
    const body = settingsRes.json();
    expect(body.settings.allowSelfRegistration).toBe(false);
    expect(body.settings.sessionIdleTimeoutMs).toBe(1234);
    expect(body.settings.sessionAbsoluteTimeoutMs).toBe(5678);
    expect(body.settings.defaultUserRole).toBe("ADMIN");
  });

  it("PATCH defaultUserRole=ADMIN while self-registration is enabled → 400", async () => {
    await patchSettings({ allowSelfRegistration: true });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: { defaultUserRole: "ADMIN" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("PATCH allowSelfRegistration=true while defaultUserRole=ADMIN is stored → 400", async () => {
    await patchSettings({ defaultUserRole: "ADMIN" });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: { allowSelfRegistration: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("env-forced self-registration + ADMIN combo still registers as VIEWER", async () => {
    process.env.ALLOW_SELF_REGISTRATION = "true";
    process.env.DEFAULT_USER_ROLE = "ADMIN";

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: {
        username: "env-forced-user",
        password: "Password123!",
        displayName: "Env Forced",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe("VIEWER");
  });
});
