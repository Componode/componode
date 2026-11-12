import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  createPersonInDb,
  createSessionInDb,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
  truncateImportTables,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

// Spec 071: humans can override a ComponentInstance's environment; the
// importer-reported value stays recorded as provenance and import runs
// keep refreshing it underneath (persistence covered in
// auto-component-groups.test.ts where the run harness lives).
describe("component instance environment override (spec 071)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let viewerSession: string;
  let adminUserId: string;
  let originalDbUrl: string | undefined;
  let originalNodeEnv: string | undefined;
  let originalBootstrapUsername: string | undefined;
  let originalBootstrapPassword: string | undefined;

  beforeAll(async () => {
    originalDbUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    originalBootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
    originalBootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

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
    adminUserId = (
      await testDb.db
        .selectFrom("persons")
        .select("id")
        .where("username", "=", ADMIN_USERNAME)
        .executeTakeFirstOrThrow()
    ).id;

    const viewerId = await createPersonInDb(testDb.db as any, {
      username: "viewer",
      passwordHash: null,
      role: "VIEWER",
    });
    viewerSession = (await createSessionInDb(testDb.db as any, viewerId)).token;
  });

  beforeEach(async () => {
    await truncateImportTables(testDb.db);
  });

  afterAll(async () => {
    if (app) await app.close();
    await testDb.cleanup();
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    else delete process.env.DATABASE_URL;
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalBootstrapUsername !== undefined) process.env.BOOTSTRAP_ADMIN_USERNAME = originalBootstrapUsername;
    else delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    if (originalBootstrapPassword !== undefined) process.env.BOOTSTRAP_ADMIN_PASSWORD = originalBootstrapPassword;
    else delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  });

  async function mkInstance(
    environment = "OTHER",
    status = "RUNNING",
  ): Promise<{ componentId: string; instanceId: string }> {
    const componentId = uuidv7();
    const instanceId = uuidv7();
    await testDb.db
      .insertInto("components")
      .values({
        id: componentId,
        name: "Payment API",
        slug: `payment-api-${componentId.slice(0, 8)}`,
        category: "API",
        provider: "GITHUB",
        resourceType: "github:repository",
        lifecycle: "ACTIVE",
        externalId: `ext-${componentId.slice(0, 8)}`,
        details: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as any)
      .execute();
    await testDb.db
      .insertInto("component_instances")
      .values({
        id: instanceId,
        componentId,
        environment,
        url: null,
        region: null,
        status,
        version: null,
        externalId: `inst-${instanceId.slice(0, 8)}`,
        slug: `inst-${instanceId.slice(0, 8)}`,
        deployedAt: null,
        rawConfig: null,
        lastSeenAt: null,
        lastSeenInRunId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as any)
      .execute();
    return { componentId, instanceId };
  }

  function patch(instanceId: string, payload: unknown, session = adminSession) {
    return app.inject({
      method: "PATCH",
      url: `/api/v1/component-instances/${instanceId}`,
      cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
      headers: csrfHeader,
      payload,
    });
  }

  it("sets an override; payload exposes effective, reported, and provenance", async () => {
    const { componentId, instanceId } = await mkInstance("OTHER");

    const res = await patch(instanceId, { environment: "PRODUCTION" });
    expect(res.statusCode).toBe(200);
    const { instance } = JSON.parse(res.payload);
    expect(instance.environment).toBe("PRODUCTION");
        expect(instance.reportedEnvironment).toBe("OTHER");
    expect(instance.environmentOverride).toBe("PRODUCTION");
    expect(instance.environmentOverriddenBy).toBe(adminUserId);
    expect(instance.environmentOverriddenAt).toBeTruthy();

    // Detail read shows the same effective/provenance shape.
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/components/${componentId}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(detail.statusCode).toBe(200);
    const row = JSON.parse(detail.payload).component.instances.find(
      (i: any) => i.id === instanceId,
    );
    expect(row.environment).toBe("PRODUCTION");
    expect(row.reportedEnvironment).toBe("OTHER");
    expect(row.environmentOverride).toBe("PRODUCTION");
  });

  it("environment:null clears the override — effective returns to reported", async () => {
    const { instanceId } = await mkInstance("STAGING");
    await patch(instanceId, { environment: "DEMO" });

    const res = await patch(instanceId, { environment: null });
    expect(res.statusCode).toBe(200);
    const { instance } = JSON.parse(res.payload);
    expect(instance.environment).toBe("STAGING");
    expect(instance.reportedEnvironment).toBe("STAGING");
    expect(instance.environmentOverride).toBeNull();
    expect(instance.environmentOverriddenBy).toBeNull();
    expect(instance.environmentOverriddenAt).toBeNull();
  });

  it("re-overriding updates provenance", async () => {
    const { instanceId } = await mkInstance("DEV");
    await patch(instanceId, { environment: "TEST" });
    const first = await testDb.db
      .selectFrom("component_instances")
      .select("environmentOverriddenAt")
      .where("id", "=", instanceId)
      .executeTakeFirstOrThrow();

    const res = await patch(instanceId, { environment: "PRODUCTION" });
    expect(res.statusCode).toBe(200);
    const { instance } = JSON.parse(res.payload);
    expect(instance.environment).toBe("PRODUCTION");
    expect(instance.environmentOverride).toBe("PRODUCTION");
    const second = await testDb.db
      .selectFrom("component_instances")
      .select("environmentOverriddenAt")
      .where("id", "=", instanceId)
      .executeTakeFirstOrThrow();
    expect(second.environmentOverriddenAt).not.toBe(first.environmentOverriddenAt);
  });

  it("writes an audit entity_changes row per set and clear", async () => {
    const { instanceId } = await mkInstance("OTHER");
    await patch(instanceId, { environment: "PRODUCTION" });
    await patch(instanceId, { environment: null });

    const rows = await testDb.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityType", "=", "component_instance")
      .where("entityId", "=", instanceId)
      .orderBy("createdAt")
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.action).toBe("update");
    const setChanges = rows[0]!.changes as Record<string, unknown>;
    expect(setChanges.environment).toBe("PRODUCTION");
    expect(setChanges.previousEnvironment).toBe("OTHER");
    const clearChanges = rows[1]!.changes as Record<string, unknown>;
    expect(clearChanges.environment).toBe("OTHER");
    expect(clearChanges.environmentOverride).toBeNull();
  });

  it("rejects invalid payloads: bad env, missing key, extra field", async () => {
    const { instanceId } = await mkInstance();
    for (const payload of [
      { environment: "NOPE" },
      {},
      { environment: "PRODUCTION", url: "https://x" },
    ]) {
      const res = await patch(instanceId, payload);
      expect(res.statusCode).toBe(400);
    }
  });

  it("returns 404 for an unknown instance", async () => {
    const res = await patch(uuidv7(), { environment: "PRODUCTION" });
    expect(res.statusCode).toBe(404);
  });

  it("rejects VIEWER role", async () => {
    const { instanceId } = await mkInstance();
    const res = await patch(instanceId, { environment: "PRODUCTION" }, viewerSession);
    expect(res.statusCode).toBe(403);
  });

  it("a GONE instance remains editable — override never changes visibility", async () => {
    const { componentId, instanceId } = await mkInstance("OTHER", "GONE");
    const res = await patch(instanceId, { environment: "PRODUCTION" });
    expect(res.statusCode).toBe(200);

    // GONE rows stay hidden from the default detail payload.
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/components/${componentId}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(
      JSON.parse(detail.payload).component.instances.find(
        (i: any) => i.id === instanceId,
      ),
    ).toBeUndefined();
  });
});
