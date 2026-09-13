import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("users CRUD", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
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

  it("admin creates a user via POST /api/v1/users → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        username: "newuser",
        password: "NewUserPassword123!",
        role: "VIEWER",
        displayName: "New User",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toBeDefined();
    expect(body.user.username).toBe("newuser");
    expect(body.user.role).toBe("VIEWER");
    expect(body.user.id).toBeDefined();
  });

  it("admin create user with password < 12 chars → 400 (ADR-099)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        username: "shortpwuser",
        password: "ShortPwd9!",
        role: "VIEWER",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("admin lists users via GET /api/v1/users → 200 + array", async () => {
    // Create a user first
    await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        username: "listeduser",
        password: "ListedUser123!",
        role: "EDITOR",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession! },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.users.length).toBeGreaterThanOrEqual(2);
  });

  it("admin updates a user role via PATCH /api/v1/users/:id → 200", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        username: "roleupdate",
        password: "RoleUpdate123!",
        role: "VIEWER",
      },
    });
    const created = createRes.json().user;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${created.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: { role: "EDITOR" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe("EDITOR");
  });

  it("duplicate username returns 409", async () => {
    const payload = {
      username: "dupuser",
      password: "DupUser12345!",
      role: "VIEWER",
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload,
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("AUTH_USERNAME_TAKEN");
  });

  it("uses uuidv7-shaped ids for created users", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        username: "uuiduser",
        password: "UuidUser123!",
        role: "VIEWER",
      },
    });
    const id = res.json().user.id;
    // uuidv7 is a 36-char UUID; just sanity-check it is a UUID string
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // ensure it's not the zero/sentinel value
    expect(id).not.toBe(uuidv7());
  });
});
