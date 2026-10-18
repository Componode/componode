import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
  createPersonInDb,
  createSessionInDb,
} from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

async function mkProduct(
  testDb: TestDb,
  over: { name: string; slug: string; type?: string; lifecycle?: string },
) {
  const id = uuidv7();
  await testDb.db
    .insertInto("digital_products")
    .values({
      id,
      name: over.name,
      slug: over.slug,
      description: null,
      type: over.type ?? "PLATFORM",
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

async function mkComponent(testDb: TestDb, name: string) {
  const id = uuidv7();
  await testDb.db
    .insertInto("components")
    .values({
      id,
      name,
      slug: name,
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

describe("product hierarchy API", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let viewerSession: string | undefined;
  let editorSession: string | undefined;
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
    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD))!;

    const viewerId = await createPersonInDb(testDb.db, {
      username: "viewer1",
      role: "VIEWER",
    });
    viewerSession = (await createSessionInDb(testDb.db, viewerId)).token;
    const editorId = await createPersonInDb(testDb.db, {
      username: "editor1",
      role: "EDITOR",
    });
    editorSession = (await createSessionInDb(testDb.db, editorId)).token;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const authed = (session?: string) => ({
    cookies: {
      [SESSION_COOKIE_NAME]: session ?? adminSession,
      ...csrfCookie,
    },
    headers: csrfHeader,
  });

  it("GET /products requires auth and returns flat products+edges", async () => {
    const unauth = await app.inject({ method: "GET", url: "/api/v1/products" });
    expect(unauth.statusCode).toBe(401);

    const p1 = await mkProduct(testDb, {
      name: "Payments",
      slug: "payments",
      type: "BUSINESS_CAPABILITY",
    });
    const p2 = await mkProduct(testDb, { name: "Core", slug: "core" });
    const retired = await mkProduct(testDb, {
      name: "Old",
      slug: "old",
      lifecycle: "RETIRED",
    });
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId: p1, childId: p2 })
      .execute();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products",
      ...authed(viewerSession),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const slugs = body.products.map((p: any) => p.slug);
    expect(slugs).toContain("payments");
    expect(slugs).toContain("core");
    expect(slugs).not.toContain("old"); // RETIRED excluded by default
    expect(body.edges).toEqual(
      expect.arrayContaining([{ parentId: p1, childId: p2 }]),
    );

    const withRetired = await app.inject({
      method: "GET",
      url: "/api/v1/products?includeRetired=true",
      ...authed(viewerSession),
    });
    expect(
      withRetired.json().products.map((p: any) => p.slug),
    ).toContain("old");

    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/products?q=pay",
      ...authed(viewerSession),
    });
    expect(filtered.json().products).toHaveLength(1);
  });

  it("POST /products creates with derived slug; duplicate slug → 409", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "Billing Engine", type: "PLATFORM" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().product.slug).toBe("billing-engine");

    const dup = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "Other", slug: "billing-engine", type: "PLATFORM" },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("SLUG_TAKEN");
  });

  it("viewer is forbidden from product mutations", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(viewerSession),
      payload: { name: "Nope", type: "PLATFORM" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /products/:slug returns detail with declared/inherited split", async () => {
    const parent = await mkProduct(testDb, {
      name: "Storefront",
      slug: "storefront",
      type: "BUSINESS_CAPABILITY",
    });
    const child = await mkProduct(testDb, {
      name: "Checkout Svc",
      slug: "checkout-svc",
    });
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId: parent, childId: child })
      .execute();
    const comp = await mkComponent(testDb, "checkout-lib");
    await testDb.db
      .insertInto("product_depends_on_component")
      .values({ productId: child, componentId: comp })
      .execute();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products/storefront",
      ...authed(viewerSession),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.composes[0].slug).toBe("checkout-svc");
    expect(body.components.inherited).toHaveLength(1);
    expect(
      body.components.inherited[0].sources.some(
        (s: { kind: string; product?: { slug: string } }) =>
          s.kind === "INHERITED" && s.product?.slug === "checkout-svc",
      ),
    ).toBe(true);

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/products/nope",
      ...authed(viewerSession),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("COMPOSES cycle → 409 CYCLE_DETECTED; PLATFORM parent → 204; self-edge → 422 (ADR-109)", async () => {
    const a = await mkProduct(testDb, {
      name: "Cap A",
      slug: "cap-a",
      type: "BUSINESS_CAPABILITY",
    });
    const b = await mkProduct(testDb, {
      name: "Cap B",
      slug: "cap-b",
      type: "BUSINESS_CAPABILITY",
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/products/${a}/composes`,
      ...authed(editorSession),
      payload: { childId: b },
    });
    const cycle = await app.inject({
      method: "POST",
      url: `/api/v1/products/${b}/composes`,
      ...authed(editorSession),
      payload: { childId: a },
    });
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json().code).toBe("CYCLE_DETECTED");

    const platform = await mkProduct(testDb, {
      name: "Plat",
      slug: "plat",
      type: "PLATFORM",
    });
    const platformParent = await app.inject({
      method: "POST",
      url: `/api/v1/products/${platform}/composes`,
      ...authed(editorSession),
      payload: { childId: b },
    });
    expect(platformParent.statusCode).toBe(204);

    const selfEdge = await app.inject({
      method: "POST",
      url: `/api/v1/products/${platform}/composes`,
      ...authed(editorSession),
      payload: { childId: platform },
    });
    expect(selfEdge.statusCode).toBe(422);
    expect(selfEdge.json().code).toBe("INVALID_EDGE_TYPE");
  });

  it("CONSUMES_FROM requires PLATFORM target; DEPENDS_ON works", async () => {
    const consumer = await mkProduct(testDb, {
      name: "Consumer",
      slug: "consumer",
      type: "CUSTOMER_FACING",
    });
    const platform = await mkProduct(testDb, {
      name: "Plat2",
      slug: "plat2",
      type: "PLATFORM",
    });
    const nonPlat = await mkProduct(testDb, {
      name: "NotPlat",
      slug: "not-plat",
      type: "BUSINESS_CAPABILITY",
    });
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/products/${consumer}/consumes-from`,
      ...authed(editorSession),
      payload: { platformId: nonPlat },
    });
    expect(bad.statusCode).toBe(422);

    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/products/${consumer}/consumes-from`,
      ...authed(editorSession),
      payload: { platformId: platform },
    });
    expect(ok.statusCode).toBe(204);

    const comp = await mkComponent(testDb, "lib-x");
    const dep = await app.inject({
      method: "POST",
      url: `/api/v1/products/${consumer}/depends-on`,
      ...authed(editorSession),
      payload: { componentId: comp },
    });
    expect(dep.statusCode).toBe(204);
  });

  it("retype to PLATFORM keeps COMPOSES children (ADR-109); CONSUMES_FROM target retype still blocked; delete guarded", async () => {
    const parent = await mkProduct(testDb, {
      name: "P",
      slug: "p-cap",
      type: "BUSINESS_CAPABILITY",
    });
    const child = await mkProduct(testDb, {
      name: "C",
      slug: "c-plat",
      type: "PLATFORM",
    });
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId: parent, childId: child })
      .execute();

    // Retype to PLATFORM is allowed now — composes edges stay valid
    const typeChange = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${parent}`,
      ...authed(editorSession),
      payload: { type: "PLATFORM" },
    });
    expect(typeChange.statusCode).toBe(200);
    const stillComposes = await testDb.db
      .selectFrom("product_composes")
      .selectAll()
      .where("parentId", "=", parent)
      .where("childId", "=", child)
      .executeTakeFirst();
    expect(stillComposes).toBeTruthy();

    // CONSUMES_FROM target rule unchanged: retyping the target away → 409
    const consumer = await mkProduct(testDb, {
      name: "Cons",
      slug: "cons-x",
      type: "BUSINESS_CAPABILITY",
    });
    await testDb.db
      .insertInto("product_consumes_from")
      .values({ consumerId: consumer, platformId: child })
      .execute();
    const targetRetype = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${child}`,
      ...authed(editorSession),
      payload: { type: "BUSINESS_CAPABILITY" },
    });
    expect(targetRetype.statusCode).toBe(409);
    expect(targetRetype.json().code).toBe("TYPE_CHANGE_BLOCKED");
    expect(JSON.stringify(targetRetype.json().details)).toContain("CONSUMES_FROM");

    const delWired = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${parent}`,
      ...authed(editorSession),
    });
    expect(delWired.statusCode).toBe(409);
    expect(delWired.json().code).toBe("REFERENCED");

    // Retire → un-retire keeps edges
    const retire = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${parent}`,
      ...authed(editorSession),
      payload: { lifecycle: "RETIRED" },
    });
    expect(retire.statusCode).toBe(200);
    const unretire = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${parent}`,
      ...authed(editorSession),
      payload: { lifecycle: "ACTIVE" },
    });
    expect(unretire.statusCode).toBe(200);

    // Remove edge then delete succeeds
    await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${parent}/composes/${child}`,
      ...authed(editorSession),
    });
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${parent}`,
      ...authed(editorSession),
    });
    expect(del.statusCode).toBe(204);
  });

  it("writes entity_changes and edge_changes audit rows", async () => {
    const name = `audit-${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name, type: "PLATFORM" },
    });
    const id = res.json().product.id;
    const rows = await testDb.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityId", "=", id)
      .execute();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].action).toBe("created");

    const other = await mkProduct(testDb, {
      name: "AuditB",
      slug: `audit-b-${Date.now()}`,
      type: "BUSINESS_CAPABILITY",
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/products/${other}/composes`,
      ...authed(editorSession),
      payload: { childId: id },
    });
    const edgeRows = await testDb.db
      .selectFrom("edge_changes")
      .selectAll()
      .where("fromEntityId", "=", other)
      .execute();
    expect(edgeRows.some((r) => r.edgeType === "COMPOSES" && r.action === "added")).toBe(true);
  });
});
