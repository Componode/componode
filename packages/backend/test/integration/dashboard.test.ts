import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

describe("dashboard summary", () => {
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

    // Seed: 1 product, 2 components (1 RETIRED), 3 instances (1 ERROR, 1 GONE),
    // 1 importer config with a FAILED run.
    const productId = uuidv7();
    await testDb.db
      .insertInto("digital_products")
      .values({
        id: productId,
        name: "Payments Platform",
        slug: "payments-platform",
        type: "PLATFORM",
        lifecycle: "ACTIVE",
        description: null,
        lobOwnerId: null,
        teamOwnerId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as any)
      .execute();

    const compActive = uuidv7();
    const compRetired = uuidv7();
    for (const [id, lifecycle] of [[compActive, "ACTIVE"], [compRetired, "RETIRED"]] as const) {
      await testDb.db
        .insertInto("components")
        .values({
          id,
          name: `comp-${id.slice(-8)}`,
          slug: `comp-${id.slice(-8)}`,
          category: "REPOSITORY",
          provider: "GITHUB",
          resourceType: "repo",
          lifecycle,
          details: null,
          componentGroupId: null,
          externalId: null,
          lastSeenAt: null,
          lastSeenInRunId: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now(),
          updatedAt: now(),
        } as any)
        .execute();
    }

    const mkInstance = (status: string) =>
      testDb.db
        .insertInto("component_instances")
        .values({
          id: uuidv7(),
          componentId: compActive,
          environment: "PRODUCTION",
          externalId: `ext-${status}`,
          slug: `inst-${status.toLowerCase()}-${uuidv7().slice(-6)}`,
          url: null,
          region: null,
          status,
          version: "1.0.0",
          deployedAt: now(),
          rawConfig: null,
          lastSeenAt: now(),
          lastSeenInRunId: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now(),
          updatedAt: now(),
        } as any)
        .execute();
    await mkInstance("RUNNING");
    await mkInstance("ERROR");
    await mkInstance("GONE");

    const configId = uuidv7();
    await testDb.db
      .insertInto("importer_configs")
      .values({
        id: configId,
        importerName: "github",
        label: "org-scan",
        scope: {},
        secretRefs: null,
        schedule: null,
        enabled: true,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as any)
      .execute();
    await testDb.db
      .insertInto("import_runs")
      .values({
        id: uuidv7(),
        configId,
        status: "FAILED",
        triggeredBy: null,
        startedAt: now(),
        completedAt: now(),
        assetsProcessed: 10,
        assetsCreated: 2,
        assetsUpdated: 8,
        instancesOrphaned: 0,
        componentsRetired: 0,
        errorMessage: "boom",
        errorStack: null,
        errorType: "SOURCE_ERROR",
        createdAt: now(),
      } as any)
      .execute();
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDbUrl;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalBootstrapUsername === undefined) delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    else process.env.BOOTSTRAP_ADMIN_USERNAME = originalBootstrapUsername;
    if (originalBootstrapPassword === undefined) delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    else process.env.BOOTSTRAP_ADMIN_PASSWORD = originalBootstrapPassword;
  });

  it("returns 401 without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/dashboard/summary" });
    expect(res.statusCode).toBe(401);
  });

  it("returns counts excluding RETIRED components and GONE instances from totals", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/summary",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.counts.products.total).toBe(1);
    expect(body.counts.products.byType.PLATFORM).toBe(1);
    expect(body.counts.components.total).toBe(1); // RETIRED excluded
    expect(body.counts.components.byLifecycle.RETIRED).toBe(1);
    expect(body.counts.instances.byStatus.RUNNING).toBe(1);
    expect(body.counts.instances.byStatus.ERROR).toBe(1);
    expect(body.counts.instances.byStatus.GONE).toBe(1);
    expect(body.counts.instances.total).toBe(2); // GONE excluded
  });

  it("lists failed runs and ERROR/GONE instances in attention with deep links", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/summary",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const body = res.json();
    const kinds = body.attention.map((a: any) => a.kind);
    expect(kinds).toContain("FAILED_RUN");
    expect(kinds).toContain("INSTANCE_ERROR");
    expect(kinds).toContain("INSTANCE_GONE");
    expect(kinds[0]).toBe("FAILED_RUN"); // failed runs first
    const failedRun = body.attention.find((a: any) => a.kind === "FAILED_RUN");
    expect(failedRun.label).toContain("github");
    expect(failedRun.href).toMatch(/^\/importers\/.+\/runs\//);
    // Component links must be slug-keyed — the frontend route resolves slugs,
    // not ids (038 FR-001).
    const instError = body.attention.find((a: any) => a.kind === "INSTANCE_ERROR");
    expect(instError.href).toMatch(/^\/components\/comp-/);
    const instGone = body.attention.find((a: any) => a.kind === "INSTANCE_GONE");
    expect(instGone.href).toMatch(/^\/components\/comp-/);
  });

  it("returns lastRuns per importer config with run counters", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/summary",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const body = res.json();
    expect(body.lastRuns).toHaveLength(1);
    expect(body.lastRuns[0].status).toBe("FAILED");
    expect(body.lastRuns[0].assetsProcessed).toBe(10);
    expect(body.lastImportAt).not.toBeNull();
  });
});
