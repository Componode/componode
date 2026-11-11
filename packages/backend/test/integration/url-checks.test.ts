import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  createPersonInDb,
  createSessionInDb,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
} from "../helpers/api.js";

// Spec 058 — direct check-definition writes are deprecated (410); reads,
// metrics, observations, and the monitoring setup stay live. Checks are
// seeded in the DB because POST/PATCH/DELETE are retired.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

async function seedComponent(db: TestDb["db"], slug = "api") {
  const componentId = uuidv7();
  await db
    .insertInto("components")
    .values({
      id: componentId,
      name: "Checkout API",
      slug,
      category: "API",
      provider: "GITHUB",
      resourceType: "github:repository",
      lifecycle: "ACTIVE",
      externalId: null,
      details: null,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
    } as any)
    .execute();
  const instanceId = uuidv7();
  await db
    .insertInto("component_instances")
    .values({
      id: instanceId,
      componentId,
      environment: "PRODUCTION",
      url: null,
      region: null,
      status: "RUNNING",
      version: null,
      deployedAt: null,
      rawConfig: null,
      externalId: "api-prod",
      slug: `${slug}-prod`,
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

async function seedCheck(
  db: TestDb["db"],
  componentId: string,
  instanceId: string,
  opts: { managedKey?: string | null; enabled?: boolean } = {},
) {
  const setupId = uuidv7();
  await db
    .insertInto("component_monitoring_setups")
    .values({
      id: setupId,
      componentId,
      cadenceSeconds: 300,
      vantage: "HUB",
      agentId: null,
      createdAt: now(),
      updatedAt: now(),
    } as any)
    .onConflict((oc) => oc.column("componentId").doNothing())
    .execute();
  const setup = await db
    .selectFrom("component_monitoring_setups")
    .selectAll()
    .where("componentId", "=", componentId)
    .executeTakeFirstOrThrow();
  const checkId = uuidv7();
  await db
    .insertInto("url_checks")
    .values({
      id: checkId,
      setupId: setup.id,
      componentInstanceId: instanceId,
      credentialId: null,
      name: "storefront",
      url: "https://example.com/",
      method: "GET",
      enabled: opts.enabled ?? true,
      cadenceSeconds: null,
      successPolicy: JSON.stringify({ codes: [], ranges: [{ min: 200, max: 299 }] }),
      authMode: "NONE",
      authConfig: null,
      availabilityTarget: null,
      targetWindow: null,
      autoDisableAfter: null,
      consecutiveFailures: 0,
      autoDisabledAt: null,
      managedKey: opts.managedKey ?? null,
      nextProbeAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
    } as any)
    .execute();
  return { checkId, setupId: setup.id };
}

describe("url checks (spec 058)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let viewerSession: string;
  let editorSession: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;

    const { bootstrapAdmin } =
      await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();

    const { loginAs } = await import("../helpers/api.js");
    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD))!;

    const viewerId = await createPersonInDb(testDb.db as any, {
      username: "viewer",
      passwordHash: null,
      role: "VIEWER",
    });
    viewerSession = (await createSessionInDb(testDb.db as any, viewerId)).token;

    const editorId = await createPersonInDb(testDb.db as any, {
      username: "editor",
      passwordHash: null,
      role: "EDITOR",
    });
    editorSession = (await createSessionInDb(testDb.db as any, editorId)).token;
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
  });

  const authed = (session: string) => ({
    cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
    headers: csrfHeader,
  });

  it.each(["admin", "editor", "viewer"])(
    "POST returns 410 URL_CHECK_WRITE_DEPRECATED (%s)",
    async (who) => {
      const { componentId, instanceId } = await seedComponent(
        testDb.db,
        `dep-post-${who}`,
      );
      const session =
        who === "admin" ? adminSession : who === "editor" ? editorSession : viewerSession;
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/components/${componentId}/url-checks`,
        ...authed(session),
        payload: {
          name: "storefront",
          url: "https://example.com/",
          componentInstanceId: instanceId,
        },
      });
      expect(res.statusCode).toBe(410);
      expect(JSON.parse(res.payload).code).toBe("URL_CHECK_WRITE_DEPRECATED");
    },
  );

  it("PATCH returns 410 URL_CHECK_WRITE_DEPRECATED", async () => {
    const { componentId, instanceId } = await seedComponent(testDb.db, "dep-patch");
    const { checkId } = await seedCheck(testDb.db, componentId, instanceId);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/url-checks/${checkId}`,
      ...authed(adminSession),
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(410);
    expect(JSON.parse(res.payload).code).toBe("URL_CHECK_WRITE_DEPRECATED");
  });

  it("DELETE returns 410 URL_CHECK_WRITE_DEPRECATED", async () => {
    const { componentId, instanceId } = await seedComponent(testDb.db, "dep-del");
    const { checkId } = await seedCheck(testDb.db, componentId, instanceId);
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/url-checks/${checkId}`,
      ...authed(adminSession),
    });
    expect(res.statusCode).toBe(410);
    expect(JSON.parse(res.payload).code).toBe("URL_CHECK_WRITE_DEPRECATED");
  });

  it("POST /components with a monitoring block returns 410", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/components",
      ...authed(adminSession),
      payload: {
        name: "Manual",
        slug: `manual-${uuidv7().slice(0, 8)}`,
        category: "API",
        provider: "OTHER",
        resourceType: "service",
        instance: { environment: "PRODUCTION" },
        monitoring: {
          checks: [
            {
              name: "check",
              url: "https://example.com",
              method: "GET",
              enabled: true,
              successPolicy: { codes: [], ranges: [{ min: 200, max: 299 }] },
            },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(410);
    expect(JSON.parse(res.payload).code).toBe("URL_CHECK_WRITE_DEPRECATED");
  });

  it("lists checks read-only with managedKey/owner fields", async () => {
    const { componentId, instanceId } = await seedComponent(testDb.db, "list-ro");
    const { checkId } = await seedCheck(testDb.db, componentId, instanceId, {
      managedKey: "chk-key-1",
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(viewerSession),
    });
    expect(res.statusCode).toBe(200);
    const { checks } = JSON.parse(res.payload);
    const check = checks.find((c: { id: string }) => c.id === checkId);
    expect(check).toBeTruthy();
    expect(check.managedKey).toBe("chk-key-1");
    expect(check.managedByConfigId ?? null).toBeNull();
  });

  it("monitoring setup GET/PUT remains live", async () => {
    const { componentId } = await seedComponent(testDb.db, "setup-live");
    const put = await app.inject({
      method: "PUT",
      url: `/api/v1/components/${componentId}/monitoring-setup`,
      ...authed(adminSession),
      payload: { cadenceSeconds: 600, vantage: "HUB" },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({
      method: "GET",
      url: `/api/v1/components/${componentId}/monitoring-setup`,
      ...authed(viewerSession),
    });
    expect(get.statusCode).toBe(200);
    expect(JSON.parse(get.payload).setup.cadenceSeconds).toBe(600);
  });
});
