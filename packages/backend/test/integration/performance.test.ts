import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

function buildComponentRecord(i: number) {
  return {
    id: uuidv7(),
    name: `Perf Component ${i}`,
    slug: `perf-component-${i}`,
    category: "API",
    provider: "GITHUB",
    resourceType: "github:repository",
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
  };
}

describe("components catalog performance", () => {
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

    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD)) ?? "";
  });

  beforeEach(async () => {
    await testDb.db.deleteFrom("component_instances").execute();
    await testDb.db.deleteFrom("components").execute();
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

  it("returns the first page within one second for 1,000 components", async () => {
    const records = Array.from({ length: 1000 }, (_, i) => buildComponentRecord(i));
    await testDb.db.insertInto("components").values(records as any).execute();

    const start = Date.now();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components?page=1&pageSize=50",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const body = JSON.parse(res.payload);
    const duration = Date.now() - start;

    expect(res.statusCode).toBe(200);
    expect(body.data).toHaveLength(50);
    expect(body.pagination.total).toBe(1000);

    // Target: the catalog list API should remain responsive with 1,000 rows.
    // Testcontainers on constrained CI runners can occasionally be slower, so
    // the threshold is relaxed to 1,500 ms when 1,000 ms proves too tight.
    const MAX_DURATION_MS = 1000;
    expect(duration).toBeLessThan(MAX_DURATION_MS);
  });

// Spec 059 — related-product enrichment on the detail read is a bounded
// batch: query count stays constant as related-product count grows.
describe("product detail bounded topology read (spec 059)", () => {
  it("enriches many related products with a constant query count", async () => {
    // Stop the Fastify app first: its background plugins (probe dispatcher,
    // sweeps, metrics) share the pool and pollute any query counting window.
    // getProductDetail talks to the db singleton directly and doesn't need it.
    await app.close();
    const suffix = Date.now().toString(36);
    const hubId = uuidv7();
    const stamp = new Date().toISOString();
    const mkProduct = (name: string) => ({
      id: uuidv7(),
      name,
      slug: name,
      description: null,
      type: "PLATFORM",
      lifecycle: "ACTIVE",
      lobOwnerId: null,
      teamOwnerId: null,
      links: "[]",
      tags: [],
      criticality: null,
      sunsetAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await testDb.db
      .insertInto("digital_products")
      .values({ ...mkProduct(`perf-hub-${suffix}`), id: hubId } as never)
      .execute();

    const relatedIds: string[] = [];
    const compEdges: { productId: string; componentId: string }[] = [];
    for (let i = 0; i < 40; i++) {
      const relId = uuidv7();
      relatedIds.push(relId);
      await testDb.db
        .insertInto("digital_products")
        .values({ ...mkProduct(`perf-rel-${i}-${suffix}`), id: relId } as never)
        .execute();
      await testDb.db
        .insertInto("product_composes")
        .values({ parentId: hubId, childId: relId })
        .execute();
      for (let j = 0; j < 2; j++) {
        const componentId = uuidv7();
        await testDb.db
          .insertInto("components")
          .values({ ...buildComponentRecord(i * 10 + j), id: componentId } as never)
          .execute();
        compEdges.push({ productId: relId, componentId });
      }
    }
    await testDb.db
      .insertInto("product_depends_on_component")
      .values(compEdges)
      .execute();

    // Count SQL statements issued through the shared pool while the service
    // resolves detail reads. The live app emits background queries through
    // the same pool, so the check is a dense-vs-sparse delta: enrichment is
    // a bounded batch, so 40 related products must cost ≈ the same as zero
    // (a per-node fan-out would add ≥40).
    const sparseSlug = `perf-sparse-${suffix}`;
    await testDb.db
      .insertInto("digital_products")
      .values({ ...mkProduct(sparseSlug), id: uuidv7() } as never)
      .execute();

    const { pool } = await import("../../src/db/connection.js");
    const { getProductDetail } = await import(
      "../../src/services/product-service.js"
    );
    let queries = 0;
    const origConnect = pool.connect.bind(pool);
    const spy = vi
      .spyOn(pool, "connect")
      .mockImplementation(async (...args: Parameters<typeof pool.connect>) => {
        const client = await origConnect(...args);
        // Pool clients are reused across checkouts — wrap each once so
        // stacked wrappers don't multiply-count later queries.
        if (!(client as { __qcounted?: boolean }).__qcounted) {
          (client as { __qcounted?: boolean }).__qcounted = true;
          const origQuery = client.query.bind(client);
          client.query = ((...qArgs: unknown[]) => {
            queries += 1;
            return (origQuery as (...a: unknown[]) => unknown)(...qArgs);
          }) as typeof client.query;
        }
        return client;
      });
    try {
      const measure = async (slug: string) => {
        queries = 0;
        await getProductDetail(slug);
        return queries;
      };
      const detail = await getProductDetail(`perf-hub-${suffix}`);
      expect(detail).not.toBeNull();
      expect(detail!.composes).toHaveLength(40);
      for (const ref of detail!.composes) {
        expect(ref).toHaveProperty("health");
        expect(ref).toHaveProperty("componentCount");
        expect(ref.componentCount).toBe(2);
      }

      const sparse: number[] = [];
      const dense: number[] = [];
      for (let i = 0; i < 3; i++) {
        sparse.push(await measure(sparseSlug));
        dense.push(await measure(`perf-hub-${suffix}`));
      }
      const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[1];
      // Enrichment adds a constant few queries (CTEs + batch reads), not one
      // per related product — a fan-out would exceed 40 extra.
      expect(median(dense) - median(sparse)).toBeLessThanOrEqual(15);
      expect(median(dense)).toBeLessThanOrEqual(30);
    } finally {
      spy.mockRestore();
    }
  });
  });
});
