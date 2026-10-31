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

    // Seed: 2 products (1 older than the 7-day delta window), 2 components
    // (1 RETIRED), 3 instances (1 ERROR, 1 GONE), 1 importer config with a
    // FAILED run, 1 OFFLINE agent with a bound config + closed session,
    // 4 credentials (expiring, expired, far-future, no-expiry).
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

    // Outside the trailing-7-day delta window — counted in totals, not deltas.
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await testDb.db
      .insertInto("digital_products")
      .values({
        id: uuidv7(),
        name: "Legacy Billing",
        slug: "legacy-billing",
        type: "BUSINESS_CAPABILITY",
        lifecycle: "ACTIVE",
        description: null,
        lobOwnerId: null,
        teamOwnerId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: tenDaysAgo,
        updatedAt: tenDaysAgo,
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

    // OFFLINE agent that still owns a bound config — an operator action
    // item (spec 027 US5) with a detail line.
    const agentId = uuidv7();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await testDb.db
      .insertInto("import_agents")
      .values({
        id: agentId,
        name: "edge-offline",
        status: "OFFLINE",
        lastSeenAt: twoHoursAgo,
      } as any)
      .execute();
    await testDb.db
      .insertInto("importer_configs")
      .values({
        id: uuidv7(),
        importerName: "kubernetes",
        label: "cluster-scan",
        scope: {},
        secretRefs: null,
        schedule: null,
        enabled: true,
        agentId,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as any)
      .execute();
    await testDb.db
      .insertInto("agent_sessions")
      .values({
        id: uuidv7(),
        agentId,
        connectedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        disconnectedAt: twoHoursAgo,
        disconnectReason: "heartbeat_timeout",
        remoteAddress: null,
        agentVersion: null,
        protocolVersion: null,
        importerVersions: [],
      } as any)
      .execute();

    const mkCredential = (label: string, slug: string, expiresAt: string | null) =>
      testDb.db
        .insertInto("credentials")
        .values({
          id: uuidv7(),
          slug,
          label,
          status: "ACTIVE",
          kind: "STORED",
          encryptedPayload: { token: "not-real" },
          secretRefMap: null,
          keyVersion: 1,
          keyHints: {},
          expiresAt,
          lastUsedAt: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now(),
          updatedAt: now(),
        } as any)
        .execute();
    const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const in60Days = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    await mkCredential("expiring-token", "expiring-token", in3Days);
    await mkCredential("expired-token", "expired-token", twoDaysAgo);
    await mkCredential("future-token", "future-token", in60Days);
    await mkCredential("no-expiry-token", "no-expiry-token", null);
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
    expect(body.counts.products.total).toBe(2);
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

  it("returns trailing-7-day deltas scoped to each headline population (spec 040)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/summary",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 2 products total but one is 10 days old → delta 1.
    expect(body.deltas.products).toBe(1);
    // RETIRED component excluded — delta mirrors the ACTIVE-only total.
    expect(body.deltas.components).toBe(1);
    // GONE instance excluded — delta mirrors the non-GONE total.
    expect(body.deltas.instances).toBe(2);
  });

  it("attention rows carry detail lines and CREDENTIAL_EXPIRING ranks below OFFLINE_AGENT (spec 040)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/summary",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const body = res.json();
    const kinds = body.attention.map((a: any) => a.kind);

    // Every row exposes the field; kinds with context fill it.
    for (const item of body.attention) {
      expect(item).toHaveProperty("detail");
    }
    const failedRun = body.attention.find((a: any) => a.kind === "FAILED_RUN");
    expect(failedRun.detail).toContain("boom");
    const offlineAgent = body.attention.find((a: any) => a.kind === "OFFLINE_AGENT");
    expect(offlineAgent).toBeTruthy();
    expect(offlineAgent.detail).toContain("heartbeat_timeout");

    // Expiring + expired credentials surface; far-future and null do not.
    const expiring = body.attention.filter((a: any) => a.kind === "CREDENTIAL_EXPIRING");
    expect(expiring).toHaveLength(2);
    const labels = expiring.map((a: any) => a.label);
    expect(labels).toContain("expiring-token");
    expect(labels).toContain("expired-token");
    const exp = expiring.find((a: any) => a.label === "expiring-token");
    expect(exp.href).toMatch(/^\/credentials\//);
    expect(exp.detail).toMatch(/expires in 3d/i);
    const gone = expiring.find((a: any) => a.label === "expired-token");
    expect(gone.detail).toMatch(/expired 2d ago/i);
    // Expired (sooner expiresAt) sorts ahead of still-valid expiring.
    expect(expiring[0].label).toBe("expired-token");

    // Actionable but warning-tone: below OFFLINE_AGENT, above sunsets.
    expect(kinds.indexOf("CREDENTIAL_EXPIRING")).toBeGreaterThan(
      kinds.indexOf("OFFLINE_AGENT"),
    );

    // Full-queue importer-issue count: 1 failed run + 1 bound offline agent.
    expect(body.importerIssues).toBe(2);
  });

  it("returns lastRuns per importer config with run counters", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/summary",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const body = res.json();
    expect(body.lastRuns).toHaveLength(2); // org-scan + agent-bound cluster-scan
    const orgScan = body.lastRuns.find((r: any) => r.configLabel === "org-scan");
    expect(orgScan.status).toBe("FAILED");
    expect(orgScan.assetsProcessed).toBe(10);
    expect(body.lastImportAt).not.toBeNull();
  });
});
