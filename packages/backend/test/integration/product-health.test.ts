import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

/**
 * Spec 019 / ADR-112: derived product health on GET /products, GET /products/:slug,
 * and the dashboard attention feed. Health is read-only and computed from the
 * product's own DEPENDS_ON sources only.
 */
describe("product health", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of [
      "DATABASE_URL",
      "NODE_ENV",
      "BOOTSTRAP_ADMIN_USERNAME",
      "BOOTSTRAP_ADMIN_PASSWORD",
    ]) {
      saved[k] = process.env[k];
    }
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;

    const { bootstrapAdmin } = await import(
      "../../src/services/bootstrap-service.js"
    );
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const authed = () => ({
    cookies: { [SESSION_COOKIE_NAME]: adminSession },
  });

  async function mkProduct(slug: string, over: { type?: string; lifecycle?: string } = {}) {
    const id = uuidv7();
    await testDb.db
      .insertInto("digital_products")
      .values({
        id,
        name: slug,
        slug,
        description: null,
        type: over.type ?? "BUSINESS_CAPABILITY",
        lifecycle: over.lifecycle ?? "ACTIVE",
        lobOwnerId: null,
        teamOwnerId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function mkComponent(
    slug: string,
    over: { lifecycle?: string; componentGroupId?: string | null } = {},
  ) {
    const id = uuidv7();
    await testDb.db
      .insertInto("components")
      .values({
        id,
        name: slug,
        slug,
        category: "REPOSITORY",
        provider: "GITHUB",
        resourceType: "repo",
        lifecycle: over.lifecycle ?? "ACTIVE",
        details: null,
        componentGroupId: over.componentGroupId ?? null,
        externalId: null,
        lastSeenAt: null,
        lastSeenInRunId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function mkGroup(slug: string) {
    const id = uuidv7();
    await testDb.db
      .insertInto("component_groups")
      .values({
        id,
        name: slug,
        slug,
        description: null,
        lifecycle: "ACTIVE",
        teamOwnerId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function mkInstance(
    componentId: string,
    over: { environment?: string; status?: string } = {},
  ) {
    await testDb.db
      .insertInto("component_instances")
      .values({
        id: uuidv7(),
        componentId,
        environment: over.environment ?? "PRODUCTION",
        externalId: `ext-${uuidv7()}`,
        slug: `inst-${uuidv7().slice(-8)}`,
        url: null,
        region: null,
        status: over.status ?? "RUNNING",
        version: "1.0.0",
        deployedAt: now(),
        rawConfig: null,
        lastSeenAt: now(),
        lastSeenInRunId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();
  }

  async function mkDirectEdge(productId: string, componentId: string) {
    await testDb.db
      .insertInto("product_depends_on_component")
      .values({ productId, componentId, createdAt: now() } as never)
      .execute();
  }

  async function getDetail(slug: string) {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/products/${slug}`,
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it("detail exposes ERROR health from a PRODUCTION error instance and list rows carry status", async () => {
    const productId = await mkProduct("payments");
    const compId = await mkComponent("pg");
    await mkDirectEdge(productId, compId);
    await mkInstance(compId, { environment: "PRODUCTION", status: "ERROR" });
    await mkInstance(compId, { environment: "DEV", status: "RUNNING" });

    const detail = await getDetail("payments");
    expect(detail.health).toEqual({
      status: "ERROR",
      perEnv: { PRODUCTION: "ERROR", DEV: "RUNNING" },
      sourceCount: 1,
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/products",
      ...authed(),
    });
    const row = list.json().products.find((p: any) => p.slug === "payments");
    expect(row.status).toBe("ERROR");
  });

  it("headlines PRODUCTION over a worse non-PROD environment", async () => {
    const productId = await mkProduct("checkout");
    const compId = await mkComponent("cart-svc");
    await mkDirectEdge(productId, compId);
    await mkInstance(compId, { environment: "PRODUCTION", status: "RUNNING" });
    await mkInstance(compId, { environment: "DEV", status: "ERROR" });

    const detail = await getDetail("checkout");
    expect(detail.health.status).toBe("RUNNING");
    expect(detail.health.perEnv).toEqual({ PRODUCTION: "RUNNING", DEV: "ERROR" });
  });

  it("health is null with no deps, GONE-only instances, and RETIRED components", async () => {
    await mkProduct("lonely");
    const goneProduct = await mkProduct("gone-only");
    const goneComp = await mkComponent("gone-comp");
    await mkDirectEdge(goneProduct, goneComp);
    await mkInstance(goneComp, { environment: "PRODUCTION", status: "GONE" });

    const retiredProduct = await mkProduct("retired-dep");
    const retiredComp = await mkComponent("retired-comp", { lifecycle: "RETIRED" });
    await mkDirectEdge(retiredProduct, retiredComp);
    await mkInstance(retiredComp, { environment: "PRODUCTION", status: "ERROR" });

    expect((await getDetail("lonely")).health).toBeNull();
    expect((await getDetail("gone-only")).health).toBeNull();
    expect((await getDetail("retired-dep")).health).toBeNull();

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/products",
      ...authed(),
    });
    const products = list.json().products;
    for (const slug of ["lonely", "gone-only", "retired-dep"]) {
      expect(products.find((p: any) => p.slug === slug).status).toBeNull();
    }
  });

  it("group-expanded members feed health (junction-seeded group edge)", async () => {
    const productId = await mkProduct("grouped");
    const groupId = await mkGroup("dbs");
    const memberId = await mkComponent("db-member", { componentGroupId: groupId });
    await testDb.db
      .insertInto("product_depends_on_component_group")
      .values({ productId, componentGroupId: groupId, createdAt: now() } as never)
      .execute();
    await mkInstance(memberId, { environment: "PRODUCTION", status: "ERROR" });

    const detail = await getDetail("grouped");
    expect(detail.health.status).toBe("ERROR");
    expect(detail.health.sourceCount).toBe(1);
    expect(detail.dependsOnGroups).toEqual([
      expect.objectContaining({ id: groupId, memberCount: 1 }),
    ]);
  });

  it("COMPOSES-inherited dependencies do not feed health", async () => {
    const parentId = await mkProduct("parent-app");
    const childId = await mkProduct("child-app");
    const badComp = await mkComponent("bad-dep");
    await mkDirectEdge(childId, badComp);
    await mkInstance(badComp, { environment: "PRODUCTION", status: "ERROR" });
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId, childId, createdAt: now() } as never)
      .execute();

    // The child is affected; the parent is not (declared-only, FR-012).
    expect((await getDetail("child-app")).health.status).toBe("ERROR");
    expect((await getDetail("parent-app")).health).toBeNull();
  });

  it("dashboard attention gains PRODUCT_ERROR after FAILED_RUN and before instance items", async () => {
    // "payments" already health-ERRORs from the first test. Seed a failed run.
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
      } as never)
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
        assetsProcessed: 1,
        assetsCreated: 0,
        assetsUpdated: 0,
        instancesOrphaned: 0,
        componentsRetired: 0,
        errorMessage: "boom",
        errorStack: null,
        errorType: "SOURCE_ERROR",
        createdAt: now(),
      } as never)
      .execute();
    // Seed a raw ERROR instance with no product edge — instance-level noise.
    const orphanComp = await mkComponent("orphan-comp");
    await mkInstance(orphanComp, { environment: "PRODUCTION", status: "ERROR" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/summary",
      ...authed(),
    });
    const attention = res.json().attention as Array<{
      kind: string;
      label: string;
      href: string;
    }>;
    const kinds = attention.map((a) => a.kind);
    expect(kinds[0]).toBe("FAILED_RUN");
    expect(kinds.indexOf("PRODUCT_ERROR")).toBeGreaterThan(
      kinds.indexOf("FAILED_RUN"),
    );
    expect(kinds.indexOf("PRODUCT_ERROR")).toBeLessThan(
      kinds.indexOf("INSTANCE_ERROR"),
    );

    const productError = attention.find((a) => a.kind === "PRODUCT_ERROR");
    expect(productError?.label).toBe("payments");
    expect(productError?.href).toBe("/products/payments");

    // GONE-only and source-less products never surface.
    const labels = attention
      .filter((a) => a.kind === "PRODUCT_ERROR")
      .map((a) => a.label);
    expect(labels).not.toContain("gone-only");
    expect(labels).not.toContain("lonely");
  });

  it("excludes RETIRED products from health attention (Edge Cases / FR-016)", async () => {
    // Retired products keep computed health but follow the dashboard's
    // lifecycle filtering — a RETIRED product must not surface in attention.
    const retiredProduct = await mkProduct("retired-app", {
      lifecycle: "RETIRED",
    });
    const badComp = await mkComponent("retired-app-dep");
    await mkDirectEdge(retiredProduct, badComp);
    await mkInstance(badComp, { environment: "PRODUCTION", status: "ERROR" });

    // Detail still computes health (derived regardless of lifecycle).
    expect((await getDetail("retired-app")).health.status).toBe("ERROR");

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/summary",
      ...authed(),
    });
    const labels = (res.json().attention as Array<{ kind: string; label: string }>)
      .filter((a) => a.kind === "PRODUCT_ERROR")
      .map((a) => a.label);
    expect(labels).not.toContain("retired-app");
  });
});
