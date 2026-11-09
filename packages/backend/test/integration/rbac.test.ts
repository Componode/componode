import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("RBAC", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let viewerSession: string | undefined;
  let editorSession: string | undefined;
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

    // Create a Viewer and an Editor via admin
    const viewerRes = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: { username: "viewer", password: "ViewerPass123!", role: "VIEWER" },
    });
    expect(viewerRes.statusCode).toBe(201);
    viewerSession = await loginAs(app, "viewer", "ViewerPass123!");

    const editorRes = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: { username: "editor", password: "EditorPass123!", role: "EDITOR" },
    });
    expect(editorRes.statusCode).toBe(201);
    editorSession = await loginAs(app, "editor", "EditorPass123!");
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
    vi.resetModules();
  });

  const createUserPayload = {
    username: "rbac-created-user",
    password: "RbacUser123!",
    role: "VIEWER",
  };

  it("Viewer POST /api/v1/users → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: viewerSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: createUserPayload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("AUTH_FORBIDDEN");
  });

  it("Editor POST /api/v1/users → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: editorSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: createUserPayload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("AUTH_FORBIDDEN");
  });

  it("Admin POST /api/v1/users → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: { username: "admin-created", password: "AdminCreated123!", role: "VIEWER" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("Viewer GET /api/v1/users → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: viewerSession! },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("AUTH_FORBIDDEN");
  });

  it("Admin GET /api/v1/users → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession! },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});
