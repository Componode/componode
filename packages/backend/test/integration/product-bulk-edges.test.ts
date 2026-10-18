import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
} from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

/**
 * Spec 019 / ADR-110 §3: `componentIds[]` bulk form of DEPENDS_ON — atomic,
 * idempotent, one audit entry per edge.
 */
describe("product bulk component dependencies", () => {
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
    cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
    headers: csrfHeader,
  });

  async function mkProduct(slug: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(),
      payload: { name: slug, slug, type: "BUSINESS_CAPABILITY" },
    });
    expect(res.statusCode).toBe(201);
    return res.json().product.id as string;
  }

  async function mkComponent(slug: string) {
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
        lifecycle: "ACTIVE",
        details: null,
        componentGroupId: null,
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

  async function addDep(productId: string, payload: unknown) {
    return app.inject({
      method: "POST",
      url: `/api/v1/products/${productId}/depends-on`,
      ...authed(),
      payload,
    });
  }

  async function edgeCount(productId: string) {
    const rows = await testDb.db
      .selectFrom("product_depends_on_component")
      .selectAll()
      .where("productId", "=", productId)
      .execute();
    return rows.length;
  }

  it("creates all edges in one transaction with one audit row per edge", async () => {
    const productId = await mkProduct("bulk-a");
    const [c1, c2, c3] = await Promise.all([
      mkComponent("bulk-a-1"),
      mkComponent("bulk-a-2"),
      mkComponent("bulk-a-3"),
    ]);

    const res = await addDep(productId, { componentIds: [c1, c2, c3] });
    expect(res.statusCode).toBe(204);
    expect(await edgeCount(productId)).toBe(3);

    const auditRows = await testDb.db
      .selectFrom("edge_changes")
      .selectAll()
      .where("fromEntityId", "=", productId)
      .where("edgeType", "=", "DEPENDS_ON_COMPONENT")
      .where("action", "=", "added")
      .execute();
    expect(auditRows).toHaveLength(3);
    expect(auditRows.map((r) => r.toEntityId).sort()).toEqual(
      [c1, c2, c3].sort(),
    );
    expect(auditRows.every((r) => r.toEntityType === "component")).toBe(true);
  });

  it("is idempotent — repeating the bulk request adds no duplicates", async () => {
    const productId = await mkProduct("bulk-idem");
    const [c1, c2] = await Promise.all([
      mkComponent("bulk-i-1"),
      mkComponent("bulk-i-2"),
    ]);

    expect((await addDep(productId, { componentIds: [c1, c2] })).statusCode).toBe(204);
    expect((await addDep(productId, { componentIds: [c1, c2] })).statusCode).toBe(204);
    expect(await edgeCount(productId)).toBe(2);
  });

  it("dedupes repeated ids within one request", async () => {
    const productId = await mkProduct("bulk-dupes");
    const [c1, c2] = await Promise.all([
      mkComponent("bulk-d-1"),
      mkComponent("bulk-d-2"),
    ]);

    expect(
      (await addDep(productId, { componentIds: [c1, c1, c2] })).statusCode,
    ).toBe(204);
    expect(await edgeCount(productId)).toBe(2);
  });

  it("fails atomically — one unknown id rejects the whole request with 404", async () => {
    const productId = await mkProduct("bulk-atomic");
    const good = await mkComponent("bulk-good");
    const missing = uuidv7();

    const res = await addDep(productId, { componentIds: [good, missing] });
    expect(res.statusCode).toBe(404);
    expect(res.json().details.missingIds).toContain(missing);
    expect(await edgeCount(productId)).toBe(0);
  });

  it("rejects empty arrays and mixed forms with 400", async () => {
    const productId = await mkProduct("bulk-validate");
    const comp = await mkComponent("bulk-v-1");

    for (const payload of [
      { componentIds: [] },
      { componentId: comp, componentIds: [comp] },
      { componentIds: [comp], componentGroupId: uuidv7() },
    ]) {
      const res = await addDep(productId, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    }
    expect(await edgeCount(productId)).toBe(0);
  });
});
