import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  createPersonInDb,
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("password change & reset", () => {
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

  it("password change with correct current password → 204", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/change",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        currentPassword: ADMIN_PASSWORD,
        newPassword: "BrandNewPassword123!",
      },
    });

    expect(res.statusCode).toBe(204);
  });

  it("password change with wrong current password → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/change",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        currentPassword: "WrongCurrent123!",
        newPassword: "BrandNewPassword123!",
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("password change with new password < 12 chars → 400 (ADR-099)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/change",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        currentPassword: ADMIN_PASSWORD,
        // 9 characters — valid under the old 8-char policy, rejected now
        newPassword: "ShortPwd9!",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("password reset confirm with new password < 12 chars → 400 (ADR-099)", async () => {
    const { hashPassword } = await import("../../src/utils/argon2.js");
    const userId = await createPersonInDb(testDb!.db, {
      username: "shortreset",
      passwordHash: await hashPassword("OldPassword123!"),
    });

    const genRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: { userId },
    });
    const token = genRes.json().token;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset/confirm",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { token, newPassword: "TooShort9!" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("admin generates a reset token via POST /api/v1/auth/password/reset → 200", async () => {
    // Create a target user
    const userId = await createPersonInDb(testDb!.db, {
      username: "resettarget",
      passwordHash: "dummy-hash",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: { userId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });

  it("user resets password via POST /api/v1/auth/password/reset/confirm → 204", async () => {
    const { hashPassword } = await import("../../src/utils/argon2.js");
    const userId = await createPersonInDb(testDb!.db, {
      username: "resetconfirm",
      passwordHash: await hashPassword("OldPassword123!"),
    });

    // Admin generates token
    const genRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: { userId },
    });
    expect(genRes.statusCode).toBe(200);
    const token = genRes.json().token;

    // User confirms reset
    const confirmRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset/confirm",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { token, newPassword: "ResetPassword123!" },
    });

    expect(confirmRes.statusCode).toBe(204);

    // The user can now log in with the new password
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { username: "resetconfirm", password: "ResetPassword123!" },
    });
    expect(loginRes.statusCode).toBe(200);
  });

  it("reused reset token → 400 AUTH_RESET_TOKEN_USED", async () => {
    const { hashPassword } = await import("../../src/utils/argon2.js");
    const userId = await createPersonInDb(testDb!.db, {
      username: "reuseuser",
      passwordHash: await hashPassword("OldPassword123!"),
    });

    const genRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: { userId },
    });
    const token = genRes.json().token;

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset/confirm",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { token, newPassword: "ResetPassword123!" },
    });
    expect(first.statusCode).toBe(204);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset/confirm",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { token, newPassword: "AnotherPassword123!" },
    });

    expect(second.statusCode).toBe(400);
    expect(second.json().code).toBe("AUTH_RESET_TOKEN_USED");
  });

  it("expired reset token → 400 AUTH_RESET_TOKEN_EXPIRED", async () => {
    const { hashPassword } = await import("../../src/utils/argon2.js");
    const { hashToken } = await import("../../src/utils/crypto.js");
    const { uuidv7 } = await import("uuidv7");

    const userId = await createPersonInDb(testDb!.db, {
      username: "expireduser",
      passwordHash: await hashPassword("OldPassword123!"),
    });

    // Insert an already-expired token directly into the DB
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    await testDb!.db
      .insertInto("password_reset_tokens")
      .values({
        id: uuidv7(),
        userId,
        tokenHash: hashToken("expired-token-value"),
        expiresAt: past,
        createdAt: past,
      })
      .execute();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset/confirm",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { token: "expired-token-value", newPassword: "NewPassword123!" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("AUTH_RESET_TOKEN_EXPIRED");
  });
});
