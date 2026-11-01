import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { csrfCookie, csrfHeader, loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("quickstart: 003-component-catalog", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
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

    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
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

  async function waitForRun(configId: string, runId: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < 50; i++) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/importer-configs/${configId}/runs/${runId}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      const body = JSON.parse(res.payload);
      if (["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(body.run.status)) {
        if (body.run.status === "FAILED") {
          const errors = await testDb.db
            .selectFrom("import_run_errors")
            .select(["errorType", "errorMessage"])
            .where("runId", "=", runId)
            .execute();
          throw new Error(`Import run failed: ${JSON.stringify(body.run)} / ${JSON.stringify(errors)}`);
        }
        return body.run;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Run did not reach terminal state in time");
  }

  async function createConfigAndRun(importerName: string, scope: unknown): Promise<{ configId: string; runId: string }> {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        importerName,
        label: importerName,
        scope,
        secretRefs: [],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { config } = JSON.parse(createRes.payload);

    const triggerRes = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(triggerRes.statusCode).toBe(202);
    const { runId } = JSON.parse(triggerRes.payload);

    await waitForRun(config.id, runId);
    return { configId: config.id, runId };
  }

  it("runs the quickstart steps end-to-end", async () => {
    // 1. Trigger an importer (AWS) so the catalog has components
    const { configId, runId } = await createConfigAndRun("aws", { region: "us-east-1", resourceTypes: ["ec2:instance"], sourceKey: "acct-it" });
    const run = await waitForRun(configId, runId);
    expect(run.status).toBe("COMPLETED");

    // 2. List components
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/components?page=1&pageSize=50",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.payload);
    expect(listBody.data).toBeInstanceOf(Array);
    expect(listBody.data.length).toBeGreaterThanOrEqual(1);
    expect(listBody.pagination).toMatchObject({
      page: 1,
      pageSize: 50,
      total: expect.any(Number),
      pageCount: expect.any(Number),
      hasNext: expect.any(Boolean),
    });

    const component = listBody.data[0];

    // 3. Search by prefix
    const searchRes = await app.inject({
      method: "GET",
      url: "/api/v1/components?search=ec2",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(searchRes.statusCode).toBe(200);
    const searchBody = JSON.parse(searchRes.payload);
    expect(searchBody.data.length).toBeGreaterThanOrEqual(1);

    // 4. Filter by category and provider
    const filterRes = await app.inject({
      method: "GET",
      url: "/api/v1/components?category=COMPUTE&provider=AWS",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(filterRes.statusCode).toBe(200);
    const filterBody = JSON.parse(filterRes.payload);
    expect(filterBody.data.length).toBeGreaterThanOrEqual(1);

    // 5. View a component detail
    const detailRes = await app.inject({
      method: "GET",
      url: `/api/v1/components/${component.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = JSON.parse(detailRes.payload);
    expect(detailBody.component.id).toBe(component.id);
    expect(detailBody.component.instances).toBeInstanceOf(Array);

    // 6. Create a ComponentGroup
    const groupRes = await app.inject({
      method: "POST",
      url: "/api/v1/component-groups",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        name: "My Group",
        slug: "my-group",
        description: "Quickstart group",
      },
    });
    expect(groupRes.statusCode).toBe(201);
    const groupBody = JSON.parse(groupRes.payload);
    const group = groupBody.group;

    // 7. Assign a component to the group
    const assignRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${component.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        componentGroupId: group.id,
      },
    });
    expect(assignRes.statusCode).toBe(200);
    const assignBody = JSON.parse(assignRes.payload);
    expect(assignBody.component.componentGroupId).toBe(group.id);

    // 8. Filter by component group
    const groupFilterRes = await app.inject({
      method: "GET",
      url: `/api/v1/components?componentGroup=my-group`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(groupFilterRes.statusCode).toBe(200);
    const groupFilterBody = JSON.parse(groupFilterRes.payload);
    expect(groupFilterBody.data).toHaveLength(1);
    expect(groupFilterBody.data[0].id).toBe(component.id);

    // 9. Run another importer (Azure) as the "other importer integration"
    const { configId: azureConfigId, runId: azureRunId } = await createConfigAndRun("azure", {
      subscriptionId: "test-sub",
      resourceTypes: ["Microsoft.Compute/virtualMachines"],
    });
    const azureRun = await waitForRun(azureConfigId, azureRunId);
    expect(azureRun.status).toBe("COMPLETED");
  });
});
