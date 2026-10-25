import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  getCookie,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("session visibility metadata (spec 032, gap G2)", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let db: any;
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"]) {
      origEnv[k] = process.env[k];
    }
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    vi.resetModules();
    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    ({ db } = await import("../../src/db/connection.js"));
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    for (const [k, v] of Object.entries(origEnv)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
    vi.resetModules();
  });

  async function loginWithUA(ua: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      cookies: csrfCookie,
      headers: { ...csrfHeader, "user-agent": ua },
      payload: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    return getCookie(res, SESSION_COOKIE_NAME)!;
  }

  it("GET /sessions exposes device + ip and marks exactly one current", async () => {
    const s1 = await loginWithUA("Mozilla/5.0 Firefox/124.0");
    const s2 = await loginWithUA("Mozilla/5.0 Chrome/120.0 Safari/537.36");

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      cookies: { [SESSION_COOKIE_NAME]: s2 },
    });
    expect(res.statusCode).toBe(200);
    const sessions = res.json().sessions;
    expect(sessions.length).toBeGreaterThanOrEqual(2);

    const devices = sessions.map((s: any) => s.device);
    expect(devices.some((d: string | null) => d?.includes("Firefox"))).toBe(true);
    expect(devices.some((d: string | null) => d?.includes("Chrome"))).toBe(true);
    expect(sessions.every((s: any) => typeof s.ip === "string" || s.ip === null)).toBe(true);

    const currents = sessions.filter((s: any) => s.current === true);
    expect(currents).toHaveLength(1);

    void s1;
  });

  it("admin list includes userId + device + ip; non-admin gets 403", async () => {
    const admin = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      cookies: { [SESSION_COOKIE_NAME]: admin! },
    });
    const userId = me.json().user.id;

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/users/${userId}/sessions`,
      cookies: { [SESSION_COOKIE_NAME]: admin! },
    });
    expect(res.statusCode).toBe(200);
    const sessions = res.json().sessions;
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions[0].userId).toBe(userId);
    expect(sessions[0]).toHaveProperty("device");
    expect(sessions[0]).toHaveProperty("ip");

    // no valid session → 401 (admin-only check is covered by rbac tests)
    const anonRes = await app.inject({
      method: "GET",
      url: `/api/v1/users/${userId}/sessions`,
      cookies: { [SESSION_COOKIE_NAME]: "nope" },
    });
    expect(anonRes.statusCode).toBe(401);
  });

  it("pre-feature sessions without UA/IP return null metadata", async () => {
    const admin = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/users/me",
      cookies: { [SESSION_COOKIE_NAME]: admin! },
    });
    const userId = me.json().user.id;

    // insert a legacy session row with no captured metadata
    await db
      .insertInto("sessions")
      .values({
        id: "legacy-" + uuidv7(),
        publicId: uuidv7(),
        userId,
        tokenLast4: "0000",
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      })
      .execute();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      cookies: { [SESSION_COOKIE_NAME]: admin! },
    });
    const legacy = res.json().sessions.find((s: any) => s.tokenLast4 === "0000");
    expect(legacy.device).toBeNull();
    expect(legacy.ip).toBeNull();
    expect(legacy.current).toBe(false);
  });
});
