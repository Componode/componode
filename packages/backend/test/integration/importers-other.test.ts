import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { csrfCookie, csrfHeader, loginAs, SESSION_COOKIE_NAME, truncateImportTables } from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("importers other", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
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

  beforeEach(async () => {
    if (!testDb) return;
    await truncateImportTables(testDb.db);
    vi.clearAllMocks();
  });

  afterAll(async () => {
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
          const errors = await testDb!.db
            .selectFrom("import_run_errors")
            .select(["errorType", "errorMessage"])
            .where("runId", "=", runId)
            .execute();
          console.log("Run failed:", body.run, errors);
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

  it("imports AWS components", async () => {
    const { configId, runId } = await createConfigAndRun("aws", { region: "us-east-1", resourceTypes: ["ec2:instance"] });
    const run = await waitForRun(configId, runId);
    expect(run.status).toBe("COMPLETED");

    const components = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("provider", "=", "AWS")
      .execute();
    expect(components.length).toBeGreaterThanOrEqual(1);
  });

  it("imports Azure components", async () => {
    const { configId, runId } = await createConfigAndRun("azure", { subscriptionId: "test-sub", resourceTypes: ["Microsoft.Compute/virtualMachines"] });
    const run = await waitForRun(configId, runId);
    expect(run.status).toBe("COMPLETED");

    const components = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("provider", "=", "AZURE")
      .execute();
    expect(components.length).toBeGreaterThanOrEqual(1);
  });

  it("imports Kubernetes components", async () => {
    const { configId, runId } = await createConfigAndRun("kubernetes", { namespace: "default", resourceTypes: ["apps/v1:Deployment"] });
    const run = await waitForRun(configId, runId);
    expect(run.status).toBe("COMPLETED");

    const components = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("provider", "=", "KUBERNETES")
      .execute();
    expect(components.length).toBeGreaterThanOrEqual(1);
  });

  it("imports web URL components", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("OK", { status: 200 }),
    );
    const { configId, runId } = await createConfigAndRun("web-url", { url: "https://example.com" });
    const run = await waitForRun(configId, runId);
    expect(run.status).toBe("COMPLETED");
    fetchSpy.mockRestore();

    const components = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("provider", "=", "WEB_URL")
      .execute();
    expect(components.length).toBeGreaterThanOrEqual(1);
  });

  it("imports API URL components", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { configId, runId } = await createConfigAndRun("api-url", { url: "https://api.example.com/health" });
    const run = await waitForRun(configId, runId);
    expect(run.status).toBe("COMPLETED");
    fetchSpy.mockRestore();

    const components = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("provider", "=", "API_URL")
      .execute();
    expect(components.length).toBeGreaterThanOrEqual(1);
  });

  it.each(["web-url", "api-url"])(
    "rejects a %s config targeting an internal address",
    async (importerName) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      for (const url of [
        "http://127.0.0.1/admin",
        "http://169.254.169.254/latest/meta-data",
        "http://10.0.0.1/internal",
      ]) {
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/importer-configs",
          cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
          headers: csrfHeader,
          payload: {
            importerName,
            label: importerName,
            scope: { url },
            secretRefs: [],
          },
        });
        expect(res.statusCode).toBe(400);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    },
  );

  it("imports MCP server components", async () => {
    const { configId, runId } = await createConfigAndRun("mcp-server", { resourceTypes: ["tools/list"] });
    const run = await waitForRun(configId, runId);
    expect(run.status).toBe("COMPLETED");

    const components = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("provider", "=", "MCP_SERVER")
      .execute();
    expect(components.length).toBeGreaterThanOrEqual(1);
  });
});
