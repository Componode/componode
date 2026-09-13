import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
  createSessionInDb,
} from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

async function latestAuditRow(db: TestDb["db"], filters: Partial<{ entityType: string; action: string; entityId: string }>) {
  let q = db.selectFrom("entity_changes").selectAll().orderBy("createdAt", "desc").limit(1);
  if (filters.entityType) q = q.where("entityType", "=", filters.entityType);
  if (filters.action) q = q.where("action", "=", filters.action);
  if (filters.entityId) q = q.where("entityId", "=", filters.entityId);
  return q.executeTakeFirst();
}

async function authEventCount(db: TestDb["db"], action: string) {
  const row = await db
    .selectFrom("entity_changes")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("entityType", "=", "auth")
    .where("action", "=", action)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

describe("audit coverage for consequential mutations", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let viewerId: string;
  let viewerPassword = "ViewerPass123!";
  let groupId: string;
  let componentId: string;
  let importerId: string;

  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"]) {
      saved[k] = process.env[k];
    }
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;

    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();

    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD))!;

    const createViewer = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        username: "audit-viewer",
        password: viewerPassword,
        role: "VIEWER",
        displayName: "Audit Viewer",
      },
    });
    viewerId = createViewer.json().user.id;

    const groupRes = await app.inject({
      method: "POST",
      url: "/api/v1/component-groups",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        name: "Audit Group",
        slug: "audit-group",
      },
    });
    groupId = groupRes.json().group.id;

    componentId = uuidv7();
    await testDb.db
      .insertInto("components")
      .values({
        id: componentId,
        name: "audit-component",
        slug: "audit-component",
        category: "REPOSITORY",
        provider: "GITHUB",
        resourceType: "repo",
        lifecycle: "ACTIVE",
        details: null,
        componentGroupId: null,
        externalId: null,
        lastSeenAt: null,
        lastSeenInRunId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never)
      .execute();

    const importerRes = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        importerName: "web-url",
        label: "Audit Web URL",
        scope: { url: "https://example.com" },
        secretRefs: [],
        enabled: false,
      },
    });
    importerId = importerRes.json().config.id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("records login_success events", async () => {
    const before = await authEventCount(testDb.db, "login");
    await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
    const after = await authEventCount(testDb.db, "login");
    expect(after).toBe(before + 1);
    const row = await latestAuditRow(testDb.db, { entityType: "auth", action: "login" });
    expect(row?.createdByName).toBe("admin");
  });

  it("records login_failed events", async () => {
    const before = await authEventCount(testDb.db, "login_failed");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { username: ADMIN_USERNAME, password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
    const after = await authEventCount(testDb.db, "login_failed");
    expect(after).toBe(before + 1);
    const row = await latestAuditRow(testDb.db, { entityType: "auth", action: "login_failed" });
    expect(row?.changes).toMatchObject({ identity: ADMIN_USERNAME });
  });

  it("records logout events", async () => {
    const { token: session } = await createSessionInDb(testDb.db, viewerId);
    const before = await authEventCount(testDb.db, "logout");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(res.statusCode).toBe(204);
    const after = await authEventCount(testDb.db, "logout");
    expect(after).toBe(before + 1);
  });

  it("records password_change events", async () => {
    const { token: session } = await createSessionInDb(testDb.db, viewerId);
    const before = await authEventCount(testDb.db, "password_change");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/change",
      cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
      headers: csrfHeader,
      payload: { currentPassword: viewerPassword, newPassword: "NewPassword123!" },
    });
    expect(res.statusCode).toBe(204);
    viewerPassword = "NewPassword123!";
    const after = await authEventCount(testDb.db, "password_change");
    expect(after).toBe(before + 1);
  });

  it("records session revocation events", async () => {
    await createSessionInDb(testDb.db, viewerId);
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/users/${viewerId}/sessions`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(list.statusCode).toBe(200);
    const sessions = list.json().sessions;
    expect(sessions.length).toBeGreaterThan(0);

    const before = await authEventCount(testDb.db, "revoked");
    const revoke = await app.inject({
      method: "POST",
      url: `/api/v1/sessions/${sessions[0].id}/revoke`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(revoke.statusCode).toBe(204);
    const after = await authEventCount(testDb.db, "revoked");
    expect(after).toBe(before + 1);
  });

  it("records user creation and role change events", async () => {
    const createRow = await latestAuditRow(testDb.db, { entityType: "user", action: "created", entityId: viewerId });
    expect(createRow).toBeDefined();
    expect(createRow?.changes).toMatchObject({ role: "VIEWER" });

    const before = await authEventCount(testDb.db, "role_changed");
    // Wrong metric: auth vs user; we query user table below.
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${viewerId}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { role: "EDITOR" },
    });
    expect(res.statusCode).toBe(200);
    const row = await latestAuditRow(testDb.db, { entityType: "user", action: "role_changed", entityId: viewerId });
    expect(row).toBeDefined();
    expect(row?.changes).toMatchObject({ role: "EDITOR" });
  });

  it("records settings update events", async () => {
    const before = await testDb.db
      .selectFrom("entity_changes")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("entityType", "=", "settings")
      .where("action", "=", "updated")
      .executeTakeFirst();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        allowSelfRegistration: false,
        sessionIdleTimeoutMs: 1200000,
        sessionAbsoluteTimeoutMs: 3600000,
      },
    });
    expect(res.statusCode).toBe(200);
    const after = await testDb.db
      .selectFrom("entity_changes")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("entityType", "=", "settings")
      .where("action", "=", "updated")
      .executeTakeFirst();
    expect(Number(after?.count)).toBe(Number(before?.count) + 1);
  });

  it("records component group update events", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/component-groups/${groupId}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { description: "Updated description" },
    });
    expect(res.statusCode).toBe(200);
    const row = await latestAuditRow(testDb.db, { entityType: "component_group", action: "updated", entityId: groupId });
    expect(row).toBeDefined();
    expect(row?.createdByName).toBe("admin");
  });

  it("records component assignment update events", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${componentId}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { componentGroupId: groupId },
    });
    expect(res.statusCode).toBe(200);
    const row = await latestAuditRow(testDb.db, { entityType: "component", action: "updated", entityId: componentId });
    expect(row).toBeDefined();
    expect(row?.changes).toMatchObject({ componentGroupId: groupId });
  });

  it("records importer config update events", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/importer-configs/${importerId}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { label: "Updated Web URL" },
    });
    expect(res.statusCode).toBe(200);
    const row = await latestAuditRow(testDb.db, { entityType: "importer_config", action: "updated", entityId: importerId });
    expect(row).toBeDefined();
  });

  it("records password reset issuance and confirmation", async () => {
    const before = await testDb.db
      .selectFrom("entity_changes")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("entityType", "=", "user")
      .where("action", "=", "password_reset_issued")
      .executeTakeFirst();

    const generate = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { userId: viewerId },
    });
    expect(generate.statusCode).toBe(200);
    const token = generate.json().token;

    const after = await testDb.db
      .selectFrom("entity_changes")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("entityType", "=", "user")
      .where("action", "=", "password_reset_issued")
      .executeTakeFirst();
    expect(Number(after?.count)).toBe(Number(before?.count) + 1);

    const pbefore = await authEventCount(testDb.db, "password_change");
    const confirm = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset/confirm",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { token, newPassword: "ResetPass123!" },
    });
    expect(confirm.statusCode).toBe(204);
    const pafter = await authEventCount(testDb.db, "password_change");
    expect(pafter).toBe(pbefore + 1);
  });
});
