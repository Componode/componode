import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  createPersonInDb,
  createSessionInDb,
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("sessions", () => {
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

  it("session persists across multiple requests", async () => {
    // First request with the session
    const res1 = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      cookies: { [SESSION_COOKIE_NAME]: adminSession! },
    });
    expect(res1.statusCode).toBe(200);

    // Second request with the same session should still work
    const res2 = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      cookies: { [SESSION_COOKIE_NAME]: adminSession! },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().user.username).toBe(ADMIN_USERNAME);
  });

  it("logout revokes the session so the next request is 401", async () => {
    // Logout
    const logoutRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(logoutRes.statusCode).toBe(204);

    // Re-using the same session token should now be rejected
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      cookies: { [SESSION_COOKIE_NAME]: adminSession! },
    });
    expect(res.statusCode).toBe(401);
  });

  it("admin lists a user's sessions via GET /api/v1/users/:id/sessions → 200", async () => {
    // Create a separate user with a session directly in the DB
    const userId = await createPersonInDb(testDb!.db, { username: "sessioned-user" });
    const { publicId: sessionPublicId } = await createSessionInDb(testDb!.db, userId);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/users/${userId}/sessions`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession! },
    });

    expect(res.statusCode).toBe(200);
    const sessions = res.json().sessions;
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.some((s: { id: string }) => s.id === sessionPublicId)).toBe(true);
  });

  it("admin revokes a session via POST /api/v1/sessions/:id/revoke → 204", async () => {
    const userId = await createPersonInDb(testDb!.db, { username: "revokable-user" });
    const { token, publicId } = await createSessionInDb(testDb!.db, userId);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${publicId}/revoke`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(res.statusCode).toBe(204);

    // A request using the revoked session token should now be 401
    const authRes = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(authRes.statusCode).toBe(401);
  });

  it("a user revokes their own session via publicId → 204", async () => {
    const userId = await createPersonInDb(testDb!.db, { username: "self-revoker" });
    const { token, publicId } = await createSessionInDb(testDb!.db, userId);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${publicId}/revoke`,
      cookies: { [SESSION_COOKIE_NAME]: token, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(res.statusCode).toBe(204);
  });

  it("a non-admin cannot revoke another user's session → 403", async () => {
    const victimId = await createPersonInDb(testDb!.db, { username: "victim-user" });
    const { publicId: victimPublicId, token: victimToken } = await createSessionInDb(testDb!.db, victimId);
    const attackerId = await createPersonInDb(testDb!.db, { username: "other-user" });
    const { token: attackerToken } = await createSessionInDb(testDb!.db, attackerId);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${victimPublicId}/revoke`,
      cookies: { [SESSION_COOKIE_NAME]: attackerToken, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("AUTH_FORBIDDEN");

    // Victim session must remain valid
    const authRes = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      cookies: { [SESSION_COOKIE_NAME]: victimToken },
    });
    expect(authRes.statusCode).toBe(200);
  });

  it("revoking an unknown session publicId → 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${crypto.randomUUID()}/revoke`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(res.statusCode).toBe(404);
  });

  it("stores sessions.id as a SHA-256 hash, not the bearer token (ADR-099)", async () => {
    const rows = await testDb!.db
      .selectFrom("sessions")
      .select(["id", "tokenLast4", "userId"])
      .execute();
    const adminRow = rows.find((r) => r.id.length === 64);
    expect(adminRow).toBeDefined();
    // The stored id must not equal the cookie token
    for (const row of rows) {
      expect(row.id).not.toBe(adminSession);
      expect(row.id).toMatch(/^[0-9a-f]{64}$/);
      expect(adminSession!.endsWith(row.tokenLast4)).toBe(true);
    }
  });

  it("GET /sessions returns tokenLast4 for display", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      cookies: { [SESSION_COOKIE_NAME]: adminSession! },
    });
    expect(res.statusCode).toBe(200);
    const sessions = res.json().sessions;
    expect(sessions.length).toBeGreaterThan(0);
    const mine = sessions.find((s: { tokenLast4?: string }) => adminSession!.endsWith(s.tokenLast4 ?? ""));
    expect(mine).toBeDefined();
  });

  it("a pre-migration plaintext-token session row cannot authenticate", async () => {
    // Rows created before migration 009 stored the raw token in `id`; the
    // migration revoked them. A fresh plaintext-id row must never match.
    const userId = await createPersonInDb(testDb!.db, { username: "plaintext-sess" });
    const { randomBytes } = await import("crypto");
    const { uuidv7 } = await import("uuidv7");
    const rawToken = randomBytes(32).toString("base64url");
    const now = new Date();
    await testDb!.db
      .insertInto("sessions")
      .values({
        id: rawToken, // plaintext — the old, vulnerable format
        publicId: uuidv7(),
        tokenLast4: rawToken.slice(-4),
        userId,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
      })
      .execute();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      cookies: { [SESSION_COOKIE_NAME]: rawToken },
    });
    expect(res.statusCode).toBe(401);
  });
});
