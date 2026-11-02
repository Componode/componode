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

// Spec 051 US1 — URL Check management: create/read/update/enable/disable/
// delete checks attached to ComponentInstances; shared monitoring setup.

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
      componentGroupId: null,
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

describe("url checks (US1)", () => {
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

  it("creates a check and auto-creates the setup with HUB/300 defaults", async () => {
    const { componentId, instanceId } = await seedComponent(testDb.db);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(adminSession),
      payload: {
        name: "storefront",
        url: "https://example.com/",
        componentInstanceId: instanceId,
      },
    });
    expect(res.statusCode).toBe(201);
    const { check } = JSON.parse(res.payload);
    expect(check.id).toBeTruthy();
    expect(check.method).toBe("GET");
    expect(check.enabled).toBe(true);
    expect(check.nextProbeAt).toBeTruthy();

    const setup = await testDb.db
      .selectFrom("component_monitoring_setups")
      .selectAll()
      .where("componentId", "=", componentId)
      .executeTakeFirstOrThrow();
    expect(setup.vantage).toBe("HUB");
    expect(setup.cadenceSeconds).toBe(300);

    const audit = await testDb.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityType", "=", "url_check")
      .where("entityId", "=", check.id)
      .where("action", "=", "created")
      .executeTakeFirst();
    expect(audit).toBeTruthy();
  });

  it("rejects an instance that does not belong to the component", async () => {
    const a = await seedComponent(testDb.db, "api-a");
    const b = await seedComponent(testDb.db, "api-b");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/components/${a.componentId}/url-checks`,
      ...authed(adminSession),
      payload: {
        name: "cross",
        url: "https://example.com/",
        componentInstanceId: b.instanceId,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects URLs failing ADR-106 destination validation", async () => {
    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "api-unsafe",
    );
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(adminSession),
      payload: {
        name: "bad",
        url: "http://127.0.0.1:8080/",
        componentInstanceId: instanceId,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).code).toBe("VALIDATION_FAILED");
  });

  it("upserts the monitoring setup and requires agentId for AGENT vantage", async () => {
    const { componentId } = await seedComponent(testDb.db, "api-setup");
    const missing = await app.inject({
      method: "PUT",
      url: `/api/v1/components/${componentId}/monitoring-setup`,
      ...authed(adminSession),
      payload: { vantage: "AGENT" },
    });
    expect(missing.statusCode).toBe(400);

    const ok = await app.inject({
      method: "PUT",
      url: `/api/v1/components/${componentId}/monitoring-setup`,
      ...authed(adminSession),
      payload: { cadenceSeconds: 120, vantage: "HUB" },
    });
    expect(ok.statusCode).toBe(200);
    const { setup } = JSON.parse(ok.payload);
    expect(setup.cadenceSeconds).toBe(120);
    expect(setup.vantage).toBe("HUB");
  });

  it("toggles enabled via PATCH, preserving identity and history on URL edit", async () => {
    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "api-toggle",
    );
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(adminSession),
      payload: {
        name: "ready",
        url: "https://example.com/ready",
        componentInstanceId: instanceId,
      },
    });
    const checkId = JSON.parse(created.payload).check.id;

    const disabled = await app.inject({
      method: "PATCH",
      url: `/api/v1/url-checks/${checkId}`,
      ...authed(adminSession),
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(JSON.parse(disabled.payload).check.nextProbeAt).toBeNull();

    const edited = await app.inject({
      method: "PATCH",
      url: `/api/v1/url-checks/${checkId}`,
      ...authed(adminSession),
      payload: { url: "https://example.com/ready/v2" },
    });
    const { check } = JSON.parse(edited.payload);
    expect(check.id).toBe(checkId);
    expect(check.url).toBe("https://example.com/ready/v2");
  });

  it("deletes a check and cascades its observations", async () => {
    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "api-del",
    );
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(adminSession),
      payload: {
        name: "doomed",
        url: "https://example.com/",
        componentInstanceId: instanceId,
      },
    });
    const checkId = JSON.parse(created.payload).check.id;
    await testDb.db
      .insertInto("url_check_observations")
      .values({
        id: uuidv7(),
        urlCheckId: checkId,
        scheduledAt: now(),
        outcome: "SUCCESS",
        httpStatus: 200,
        durationMs: 120,
        errorType: null,
        vantage: "HUB",
        agentId: null,
        createdAt: now(),
      })
      .execute();

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/url-checks/${checkId}`,
      ...authed(adminSession),
    });
    expect(res.statusCode).toBe(204);
    const obs = await testDb.db
      .selectFrom("url_check_observations")
      .selectAll()
      .where("urlCheckId", "=", checkId)
      .execute();
    expect(obs).toHaveLength(0);
  });

  it("lists checks for a component with latest observation summary", async () => {
    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "api-list",
    );
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(adminSession),
      payload: {
        name: "probe",
        url: "https://example.com/",
        componentInstanceId: instanceId,
      },
    });
    const checkId = JSON.parse(created.payload).check.id;
    await testDb.db
      .insertInto("url_check_observations")
      .values({
        id: uuidv7(),
        urlCheckId: checkId,
        scheduledAt: now(),
        outcome: "FAILURE",
        httpStatus: 503,
        durationMs: 80,
        errorType: "HTTP_STATUS",
        vantage: "HUB",
        agentId: null,
        createdAt: now(),
      })
      .execute();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(viewerSession),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.checks).toHaveLength(1);
    expect(body.checks[0].latest.outcome).toBe("FAILURE");
    expect(body.checks[0].latest.httpStatus).toBe(503);
  });

  it("rejects check creation from a VIEWER session", async () => {
    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "api-rbac",
    );
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(viewerSession),
      payload: {
        name: "nope",
        url: "https://example.com/",
        componentInstanceId: instanceId,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  describe("url check onboarding role boundaries (spec 054)", () => {
    it("lets an EDITOR create ordinary checks but rejects Credential and Agent writes", async () => {
      const { componentId, instanceId } = await seedComponent(
        testDb.db,
        `api-${uuidv7()}`,
      );
      const hubCheck = await app.inject({
        method: "POST",
        url: `/api/v1/components/${componentId}/url-checks`,
        ...authed(editorSession),
        payload: {
          name: "ordinary",
          url: "https://example.com/health",
          componentInstanceId: instanceId,
        },
      });
      expect(hubCheck.statusCode).toBe(201);

      const credentialed = await app.inject({
        method: "POST",
        url: `/api/v1/components/${componentId}/url-checks`,
        ...authed(editorSession),
        payload: {
          name: "credential",
          url: "https://example.com/private",
          componentInstanceId: instanceId,
          authMode: "BEARER",
          credentialId: uuidv7(),
          authConfig: { tokenKey: "token" },
        },
      });
      expect(credentialed.statusCode).toBe(403);
      expect(JSON.parse(credentialed.payload).code).toBe("AUTH_FORBIDDEN");

      const agentSetup = await app.inject({
        method: "PUT",
        url: `/api/v1/components/${componentId}/monitoring-setup`,
        ...authed(editorSession),
        payload: {
          vantage: "AGENT",
          agentId: uuidv7(),
        },
      });
      expect(agentSetup.statusCode).toBe(403);
      expect(JSON.parse(agentSetup.payload).code).toBe("AUTH_FORBIDDEN");
    });

    it("lets an EDITOR preserve but not reselect an Agent vantage", async () => {
      const { componentId } = await seedComponent(testDb.db, `api-${uuidv7()}`);
      const agentId = uuidv7();
      await testDb.db
        .insertInto("import_agents")
        .values({ id: agentId, name: `agent-${uuidv7()}` } as any)
        .execute();
      const configured = await app.inject({
        method: "PUT",
        url: `/api/v1/components/${componentId}/monitoring-setup`,
        ...authed(adminSession),
        payload: { cadenceSeconds: 300, vantage: "AGENT", agentId },
      });
      expect(configured.statusCode).toBe(200);

      const preserve = await app.inject({
        method: "PUT",
        url: `/api/v1/components/${componentId}/monitoring-setup`,
        ...authed(editorSession),
        payload: { cadenceSeconds: 600 },
      });
      expect(preserve.statusCode).toBe(200);
      expect(JSON.parse(preserve.payload).setup).toMatchObject({
        cadenceSeconds: 600,
        vantage: "AGENT",
        agentId,
      });

      for (const payload of [
        { vantage: "AGENT", agentId: uuidv7() },
        { agentId: uuidv7() },
      ]) {
        const res = await app.inject({
          method: "PUT",
          url: `/api/v1/components/${componentId}/monitoring-setup`,
          ...authed(editorSession),
          payload,
        });
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.payload).code).toBe("AUTH_FORBIDDEN");
      }

      const backToHub = await app.inject({
        method: "PUT",
        url: `/api/v1/components/${componentId}/monitoring-setup`,
        ...authed(editorSession),
        payload: { vantage: "HUB" },
      });
      expect(backToHub.statusCode).toBe(200);
      expect(JSON.parse(backToHub.payload).setup).toMatchObject({
        vantage: "HUB",
        agentId: null,
      });
    });

    it("lets an EDITOR preserve but not reconfigure an existing credential", async () => {
      const { componentId, instanceId } = await seedComponent(
        testDb.db,
        `api-${uuidv7()}`,
      );
      const credentialId = uuidv7();
      await testDb.db
        .insertInto("credentials")
        .values({
          id: credentialId,
          slug: `cred-${uuidv7().slice(0, 8)}`,
          label: "API token",
          status: "ACTIVE",
          kind: "STORED",
          encryptedPayload: { token: "test-only" },
          secretRefMap: null,
          keyVersion: 1,
          keyHints: { token: "test-only" },
          expiresAt: null,
          lastUsedAt: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now(),
          updatedAt: now(),
        } as any)
        .execute();

      const created = await app.inject({
        method: "POST",
        url: `/api/v1/components/${componentId}/url-checks`,
        ...authed(adminSession),
        payload: {
          name: "private",
          url: "https://example.com/private",
          componentInstanceId: instanceId,
          authMode: "BEARER",
          credentialId,
          authConfig: { tokenKey: "token" },
        },
      });
      expect(created.statusCode).toBe(201);
      const checkId = JSON.parse(created.payload).check.id;

      const preserve = await app.inject({
        method: "PATCH",
        url: `/api/v1/url-checks/${checkId}`,
        ...authed(editorSession),
        payload: {
          name: "private renamed",
          authMode: "BEARER",
          credentialId,
          authConfig: { tokenKey: "token" },
        },
      });
      expect(preserve.statusCode).toBe(200);
      expect(JSON.parse(preserve.payload).check.name).toBe("private renamed");

      for (const payload of [
        { authConfig: { tokenKey: "other" } },
        {
          authMode: "BASIC",
          authConfig: { usernameKey: "u", passwordKey: "p" },
        },
        { credentialId: uuidv7() },
      ]) {
        const res = await app.inject({
          method: "PATCH",
          url: `/api/v1/url-checks/${checkId}`,
          ...authed(editorSession),
          payload,
        });
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.payload).code).toBe("AUTH_FORBIDDEN");
      }

      const row = await testDb.db
        .selectFrom("url_checks")
        .select(["credentialId", "authMode", "authConfig"])
        .where("id", "=", checkId)
        .executeTakeFirstOrThrow();
      expect(row.credentialId).toBe(credentialId);
      expect(row.authMode).toBe("BEARER");

      for (const authConfig of [null, { usernameKey: "u", passwordKey: "p" }]) {
        const mismatched = await app.inject({
          method: "PATCH",
          url: `/api/v1/url-checks/${checkId}`,
          ...authed(adminSession),
          payload: { authConfig },
        });
        expect(mismatched.statusCode).toBe(400);
        expect(JSON.parse(mismatched.payload).code).toBe("VALIDATION_FAILED");
      }
    });

    it("rejects credential fields on a NONE check before updating it", async () => {
      const { componentId, instanceId } = await seedComponent(
        testDb.db,
        `api-${uuidv7()}`,
      );
      const created = await app.inject({
        method: "POST",
        url: `/api/v1/components/${componentId}/url-checks`,
        ...authed(editorSession),
        payload: {
          name: "ordinary",
          url: "https://example.com/public",
          componentInstanceId: instanceId,
        },
      });
      expect(created.statusCode).toBe(201);
      const checkId = JSON.parse(created.payload).check.id;

      for (const [session, statusCode] of [
        [editorSession, 403],
        [adminSession, 400],
      ] as const) {
        for (const payload of [
          { credentialId: uuidv7() },
          { authConfig: { tokenKey: "token" } },
        ]) {
          const res = await app.inject({
            method: "PATCH",
            url: `/api/v1/url-checks/${checkId}`,
            ...authed(session),
            payload,
          });
          expect(res.statusCode).toBe(statusCode);
        }
      }
    });
  });
});
