import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, createPersonInDb, createSessionInDb, SESSION_COOKIE_NAME, csrfCookie, csrfHeader, truncateImportTables } from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

async function insertComponent(db: TestDb["db"], values: Record<string, unknown>) {
  await db
    .insertInto("components")
    .values({
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
      ...values,
    } as any)
    .execute();
}

async function insertInstance(db: TestDb["db"], values: Record<string, unknown>) {
  await db
    .insertInto("component_instances")
    .values({
      environment: "PRODUCTION",
      url: null,
      region: null,
      version: "1.0.0",
      deployedAt: now(),
      rawConfig: null,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
      ...values,
    } as any)
    .execute();
}

describe("components catalog", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let viewerSession: string;
  let editorSession: string;
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
  });

  beforeEach(async () => {
    await truncateImportTables(testDb.db);
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

  it("returns an empty list by default", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.pageSize).toBe(25);
    expect(body.pagination.pageCount).toBe(0);
    expect(body.pagination.hasNext).toBe(false);
  });

  it("lists ACTIVE components and excludes RETIRED by default", async () => {
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000001",
      name: "Active Repo",
      slug: "active-repo",
      category: "REPOSITORY",
      provider: "GITHUB",
      resourceType: "github:repository",
      lifecycle: "ACTIVE",
    });
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000002",
      name: "Retired Repo",
      slug: "retired-repo",
      category: "REPOSITORY",
      provider: "GITHUB",
      resourceType: "github:repository",
      lifecycle: "RETIRED",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Active Repo");
    expect(body.pagination.total).toBe(1);
  });

  it("includes RETIRED components when includeRetired=true", async () => {
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000001",
      name: "Active Repo",
      slug: "active-repo",
      category: "REPOSITORY",
      provider: "GITHUB",
      resourceType: "github:repository",
      lifecycle: "ACTIVE",
    });
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000002",
      name: "Retired Repo",
      slug: "retired-repo",
      category: "REPOSITORY",
      provider: "GITHUB",
      resourceType: "github:repository",
      lifecycle: "RETIRED",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components?includeRetired=true",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toHaveLength(2);
    expect(body.pagination.total).toBe(2);
  });

  it("excludes components with only GONE instances by default", async () => {
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000001",
      name: "Missing Instance",
      slug: "missing-instance",
      category: "API",
      provider: "GITHUB",
      resourceType: "github:repository",
      lifecycle: "ACTIVE",
    });
    await insertInstance(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000101",
      componentId: "018f0000-0000-7e10-a000-000000000001",
      environment: "PRODUCTION",
      status: "GONE",
      externalId: "missing-instance:0",
      slug: "missing-instance-0",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toHaveLength(0);
    expect(body.pagination.total).toBe(0);

    const includeRes = await app.inject({
      method: "GET",
      url: "/api/v1/components?includeGone=true",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(includeRes.statusCode).toBe(200);
    const includeBody = JSON.parse(includeRes.payload);
    expect(includeBody.data).toHaveLength(1);
    expect(includeBody.pagination.total).toBe(1);
  });

  it("filters by category and provider", async () => {
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000003",
      name: "GitHub Repo",
      slug: "github-repo",
      category: "REPOSITORY",
      provider: "GITHUB",
      resourceType: "github:repository",
    });
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000004",
      name: "AWS Bucket",
      slug: "aws-bucket",
      category: "STORAGE",
      provider: "AWS",
      resourceType: "aws:s3:bucket",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components?category=STORAGE&provider=AWS",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("AWS Bucket");
  });

  it("filters with repeated multi-value query parameters (OR within, AND across)", async () => {
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000005",
      name: "GitHub Repo",
      slug: "github-repo",
      category: "REPOSITORY",
      provider: "GITHUB",
      resourceType: "github:repository",
    });
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000006",
      name: "GitHub API",
      slug: "github-api",
      category: "API",
      provider: "GITHUB",
      resourceType: "github:repository",
    });
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000007",
      name: "AWS Bucket",
      slug: "aws-bucket",
      category: "STORAGE",
      provider: "AWS",
      resourceType: "aws:s3:bucket",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components?category=REPOSITORY&category=API&provider=GITHUB",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toHaveLength(2);
    expect(body.data.map((c: { name: string }) => c.name).sort()).toEqual(["GitHub API", "GitHub Repo"]);

    const emptyRes = await app.inject({
      method: "GET",
      url: "/api/v1/components?category=REPOSITORY&category=API&provider=AWS",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(emptyRes.statusCode).toBe(200);
    const emptyBody = JSON.parse(emptyRes.payload);
    expect(emptyBody.data).toHaveLength(0);
    expect(emptyBody.pagination.total).toBe(0);
  });

  it("searches by name substring", async () => {
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000005",
      name: "service-alpha",
      slug: "service-alpha",
      category: "API",
      provider: "GITHUB",
      resourceType: "github:repository",
    });
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000006",
      name: "service-beta",
      slug: "service-beta",
      category: "API",
      provider: "GITHUB",
      resourceType: "github:repository",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components?search=service-al",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("service-alpha");
  });

  it("paginates results", async () => {
    for (let i = 0; i < 3; i++) {
      await insertComponent(testDb.db, {
        id: `018f0000-0000-7e10-a000-0000000000${10 + i}`,
        name: `repo-${i}`,
        slug: `repo-${i}`,
        category: "REPOSITORY",
        provider: "GITHUB",
        resourceType: "github:repository",
      });
    }

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components?page=1&pageSize=2",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data).toHaveLength(2);
    expect(body.pagination.total).toBe(3);
    expect(body.pagination.pageSize).toBe(2);
    expect(body.pagination.pageCount).toBe(2);
    expect(body.pagination.hasNext).toBe(true);
  });

describe("list enrichment — worstStatus + lastSeenAt (spec 039, G21)", () => {
  it("returns worstStatus and lastSeenAt per row; nulls for zero-instance rows", async () => {
    const mixed = "11111111-1111-1111-1111-111111111111";
    const empty = "22222222-2222-2222-2222-222222222222";
    await insertComponent(testDb.db, {
      id: mixed, slug: "mixed", name: "mixed",
      category: "API", provider: "GITHUB", resourceType: "github:repository",
    });
    await insertComponent(testDb.db, {
      id: empty, slug: "empty", name: "empty",
      category: "API", provider: "GITHUB", resourceType: "github:repository",
    });
    await insertInstance(testDb.db, {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      componentId: mixed,
      status: "RUNNING",
      externalId: "mixed:0",
      slug: "mixed-0",
      lastSeenAt: "2026-10-01T00:00:00Z",
    });
    await insertInstance(testDb.db, {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      componentId: mixed,
      status: "ERROR",
      externalId: "mixed:1",
      slug: "mixed-1",
      lastSeenAt: "2026-10-20T00:00:00Z",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.payload).data;
    const m = rows.find((r: any) => r.slug === "mixed");
    const e = rows.find((r: any) => r.slug === "empty");
    expect(m.worstStatus).toBe("ERROR");
    expect(m.lastSeenAt).toBeTruthy();
    expect(new Date(m.lastSeenAt).toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(e.worstStatus).toBeNull();
    expect(e.lastSeenAt).toBeNull();
  });
});

// Spec 042 / G29: manual component creation mirrors the component-groups
// precedent — uuid v7, unique slug, audit event, EDITOR-only.
describe("POST /components — manual creation (spec 042, G29)", () => {
  const create = (session: string = adminSession, payload: unknown = {
    name: "Manual Service",
    slug: "manual-service",
    category: "API",
    provider: "OTHER",
    resourceType: "service",
  }) =>
    app.inject({
      method: "POST",
      url: "/api/v1/components",
      cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
      headers: csrfHeader,
      payload,
    });

  it("creates a component with a uuid v7 id and an audit event", async () => {
    const res = await create();
    expect(res.statusCode).toBe(201);
    const { component } = JSON.parse(res.payload);
    expect(component.name).toBe("Manual Service");
    expect(component.slug).toBe("manual-service");
    expect(component.lifecycle).toBe("ACTIVE");
    // uuid v7: version nibble 7, variant 8/9/a/b.
    expect(component.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const audit = await testDb.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityType", "=", "component")
      .where("entityId", "=", component.id)
      .where("action", "=", "created")
      .execute();
    expect(audit).toHaveLength(1);
  });

  it("rejects a duplicate slug with 409 SLUG_CONFLICT", async () => {
    const first = await create();
    expect(first.statusCode).toBe(201);

    const dup = await create(adminSession, {
      name: "Another Service",
      slug: "manual-service",
      category: "API",
      provider: "OTHER",
      resourceType: "service",
    });
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.payload).code).toBe("SLUG_CONFLICT");
  });

  it("rejects invalid bodies with 400 VALIDATION_FAILED", async () => {
    const missing = await create(adminSession, { name: "No fields" });
    expect(missing.statusCode).toBe(400);
    expect(JSON.parse(missing.payload).code).toBe("VALIDATION_FAILED");

    const badEnum = await create(adminSession, {
      name: "Bad Category",
      slug: "bad-category",
      category: "NOT_A_CATEGORY",
      provider: "OTHER",
      resourceType: "service",
    });
    expect(badEnum.statusCode).toBe(400);
    expect(JSON.parse(badEnum.payload).code).toBe("VALIDATION_FAILED");

    const unknownKey = await create(adminSession, {
      name: "Extra",
      slug: "extra",
      category: "API",
      provider: "OTHER",
      resourceType: "service",
      externalId: "hacker",
    });
    expect(unknownKey.statusCode).toBe(400);
  });

  it("404s on unknown teamOwnerId/componentGroupId references", async () => {
    const res = await create(adminSession, {
      name: "Bad Ref",
      slug: "bad-ref",
      category: "API",
      provider: "OTHER",
      resourceType: "service",
      teamOwnerId: "018f0000-0000-7e10-a000-000000000099",
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).code).toBe("NOT_FOUND");
  });

  it("forbids VIEWER sessions", async () => {
    const res = await create(viewerSession, {
      name: "Viewer Component",
      slug: "viewer-component",
      category: "API",
      provider: "OTHER",
      resourceType: "service",
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects the retired monitoring block with 410 (spec 058)", async () => {
    const monitoring = (slug: string) => ({
      name: `Monitored ${slug}`,
      slug,
      category: "API",
      provider: "OTHER",
      resourceType: "service",
      instance: { environment: "PRODUCTION" },
      monitoring: {
        setup: { cadenceSeconds: 300, vantage: "HUB", agentId: null },
        checks: [
          {
            name: "Readiness",
            url: "https://api.example.com/ready",
            method: "GET",
            enabled: false,
            authMode: "NONE",
            successPolicy: { codes: [200, 204], ranges: [] },
          },
        ],
      },
    });

    const slug = `composite-${uuidv7().slice(0, 8)}`;
    const created = await create(editorSession, monitoring(slug));
    expect(created.statusCode).toBe(410);
    expect(JSON.parse(created.payload).code).toBe(
      "URL_CHECK_WRITE_DEPRECATED",
    );
    const leaked = await testDb.db
      .selectFrom("components")
      .select("id")
      .where("slug", "=", slug)
      .execute();
    expect(leaked).toHaveLength(0);
  });
});

describe("POST /components/:id/instances — first-instance recovery (spec 054)", () => {
  const componentId = uuidv7();
  const post = (session: string = editorSession, payload: unknown = {
    environment: "PRODUCTION",
    url: "https://api.example.com",
    version: "1.2.3",
    region: "us-east-1",
  }) =>
    app.inject({
      method: "POST",
      url: `/api/v1/components/${componentId}/instances`,
      cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
      headers: csrfHeader,
      payload,
    });

  beforeEach(async () => {
    await insertComponent(testDb.db, {
      id: componentId,
      name: "Recovered API",
      slug: "recovered-api",
      category: "API",
      provider: "OTHER",
      resourceType: "service",
    });
  });

  it("creates the first manual instance for an EDITOR and audits it", async () => {
    const res = await post();
    expect(res.statusCode).toBe(201);
    const { instance } = JSON.parse(res.payload);
    expect(instance.componentId).toBe(componentId);
    expect(instance.environment).toBe("PRODUCTION");
    expect(instance.status).toBe("RUNNING");
    expect(instance.externalId).toBe("manual:recovered-api");

    const audit = await testDb.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityType", "=", "component_instance")
      .where("entityId", "=", instance.id)
      .where("action", "=", "created")
      .execute();
    expect(audit).toHaveLength(1);
  });

  it("returns 400 on invalid input and 409 once an instance exists", async () => {
    const bad = await post(editorSession, { environment: "BAD" });
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.payload).code).toBe("VALIDATION_FAILED");

    expect((await post()).statusCode).toBe(201);
    const conflict = await post();
    expect(conflict.statusCode).toBe(409);
    expect(JSON.parse(conflict.payload).code).toBe("CONFLICT");
  });

  it("requires authentication and returns 404 for a nonexistent component", async () => {
    const unauthenticated = await app.inject({
      method: "POST",
      url: `/api/v1/components/${componentId}/instances`,
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { environment: "PRODUCTION" },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/components/${uuidv7()}/instances`,
      cookies: { [SESSION_COOKIE_NAME]: editorSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { environment: "PRODUCTION" },
    });
    expect(missing.statusCode).toBe(404);
    expect(JSON.parse(missing.payload).code).toBe("NOT_FOUND");
  });

  it("forbids VIEWER sessions and hides unavailable components", async () => {
    expect((await post(viewerSession)).statusCode).toBe(403);
    const retiredId = uuidv7();
    await insertComponent(testDb.db, {
      id: retiredId,
      name: "Retired API",
      slug: "retired-api",
      category: "API",
      provider: "OTHER",
      resourceType: "service",
      lifecycle: "RETIRED",
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/components/${retiredId}/instances`,
      cookies: { [SESSION_COOKIE_NAME]: editorSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { environment: "PRODUCTION" },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).code).toBe("NOT_FOUND");
  });
});

describe("GET /components/:id/relationships — read-only view (spec 060)", () => {
  it("rejects unauthenticated requests and unknown components", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: `/api/v1/components/${uuidv7()}/relationships`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const missing = await app.inject({
      method: "GET",
      url: `/api/v1/components/${uuidv7()}/relationships`,
      cookies: { [SESSION_COOKIE_NAME]: viewerSession },
    });
    expect(missing.statusCode).toBe(404);
    expect(JSON.parse(missing.payload).code).toBe("NOT_FOUND");
  });

  it("is side-effect-free — the read writes no audit rows", async () => {
    const componentId = uuidv7();
    await insertComponent(testDb.db, {
      id: componentId,
      name: "Rel Target",
      slug: "rel-target",
      category: "API",
      provider: "OTHER",
      resourceType: "service",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/components/${componentId}/relationships`,
      cookies: { [SESSION_COOKIE_NAME]: viewerSession },
    });
    expect(res.statusCode).toBe(200);

    const [entityRows, edgeRows] = await Promise.all([
      testDb.db.selectFrom("entity_changes").selectAll().execute(),
      testDb.db.selectFrom("edge_changes").selectAll().execute(),
    ]);
    expect(entityRows).toHaveLength(0);
    expect(edgeRows).toHaveLength(0);
  });
});

describe("non-UUID :id params", () => {
  // A slug or malformed id must fail validation (400), never reach the
  // uuid column and blow up as a 500.
  it.each([
    "GET /api/v1/components/not-a-uuid",
    "GET /api/v1/components/not-a-uuid/dependents",
    "PATCH /api/v1/components/not-a-uuid",
    "POST /api/v1/components/not-a-uuid/promote-to-platform",
  ])("%s → 400", async (req) => {
    const [method, url] = req.split(" ");
    const res = await app.inject({
      method: method as "GET" | "PATCH" | "POST",
      url,
      cookies: { [SESSION_COOKIE_NAME]: viewerSession },
      ...(method === "POST" || method === "PATCH"
        ? { headers: csrfHeader, cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie }, payload: {} }
        : {}),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).code).toBe("VALIDATION_FAILED");
  });
});

describe("spec 068 — standardized list contract", () => {
  const get = (qs = "") =>
    app.inject({
      method: "GET",
      url: `/api/v1/components${qs}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });

  const seedPageComponents = async () => {
    for (let i = 0; i < 5; i++) {
      await insertComponent(testDb.db, {
        id: `018f0000-0000-7e10-a000-${String(100 + i).padStart(12, "0")}`,
        name: `page-comp-${i}`,
        slug: `page-comp-${i}`,
        category: "API",
        provider: "GITHUB",
        resourceType: "github:repository",
      });
    }
  };

  it("computes the pagination envelope across pages", async () => {
    await seedPageComponents();

    const p1 = JSON.parse((await get("?page=1&pageSize=2")).payload);
    expect(p1.data).toHaveLength(2);
    expect(p1.pagination).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 5,
      pageCount: 3,
      hasNext: true,
    });

    const p2 = JSON.parse((await get("?page=2&pageSize=2")).payload);
    expect(p2.data).toHaveLength(2);
    expect(p2.pagination).toMatchObject({ page: 2, total: 5, pageCount: 3, hasNext: true });
    // Pages must not overlap.
    expect(p2.data.map((c: any) => c.id)).not.toEqual(
      expect.arrayContaining(p1.data.map((c: any) => c.id)),
    );

    const p3 = JSON.parse((await get("?page=3&pageSize=2")).payload);
    expect(p3.data).toHaveLength(1);
    expect(p3.pagination.hasNext).toBe(false);

    // Contract default page size is 25.
    const def = JSON.parse((await get("")).payload);
    expect(def.pagination.pageSize).toBe(25);
  });

  it("rejects invalid pagination, sort, and unknown params with 400", async () => {
    for (const qs of [
      "?page=0",
      "?page=-1",
      "?page=abc",
      "?pageSize=0",
      "?pageSize=101",
      "?sort=bogus",
      "?order=sideways",
      "?bogusParam=1",
      "?q=legacy-param",
    ]) {
      const res = await get(qs);
      expect(res.statusCode, qs).toBe(400);
      expect(JSON.parse(res.payload).code).toBe("VALIDATION_FAILED");
    }
  });

  it("sorts by whitelisted columns with a deterministic id tiebreak", async () => {
    const id1 = "018f0000-0000-7e10-a000-000000000011";
    const id2 = "018f0000-0000-7e10-a000-000000000012";
    const id3 = "018f0000-0000-7e10-a000-000000000013";
    await insertComponent(testDb.db, {
      id: id1, name: "Bravo", slug: "bravo-sort",
      category: "API", provider: "GITHUB", resourceType: "gamma-res",
    });
    await insertComponent(testDb.db, {
      id: id2, name: "Alpha", slug: "alpha-sort",
      category: "STORAGE", provider: "AWS", resourceType: "alpha-res",
    });
    await insertComponent(testDb.db, {
      id: id3, name: "Charlie", slug: "charlie-sort",
      category: "API", provider: "GITHUB", resourceType: "beta-res",
    });

    const slugs = (body: any) => body.data.map((c: any) => c.slug);

    expect(slugs(JSON.parse((await get("?sort=name&order=asc")).payload)))
      .toEqual(["alpha-sort", "bravo-sort", "charlie-sort"]);
    expect(slugs(JSON.parse((await get("?sort=name&order=desc")).payload)))
      .toEqual(["charlie-sort", "bravo-sort", "alpha-sort"]);
    // category: API rows first (id tiebreak → bravo before charlie), then STORAGE.
    expect(slugs(JSON.parse((await get("?sort=category&order=asc")).payload)))
      .toEqual(["bravo-sort", "charlie-sort", "alpha-sort"]);
    expect(slugs(JSON.parse((await get("?sort=resourceType&order=asc")).payload)))
      .toEqual(["alpha-sort", "charlie-sort", "bravo-sort"]);
  });

  it("sorts owner by the joined team name and instances/health/lastSeenAt by their rollups", async () => {
    const teamZ = "018f0000-0000-7e10-b000-0000000000a1";
    const teamA = "018f0000-0000-7e10-b000-0000000000a2";
    await testDb.db.insertInto("teams").values([
      { id: teamZ, name: "Zeta Team", slug: "zeta-team", description: null, lobId: null, createdAt: now(), updatedAt: now() },
      { id: teamA, name: "Alpha Team", slug: "alpha-team", description: null, lobId: null, createdAt: now(), updatedAt: now() },
    ] as any).execute();

    const owned = "018f0000-0000-7e10-a000-000000000021";
    const otherOwned = "018f0000-0000-7e10-a000-000000000022";
    const unowned = "018f0000-0000-7e10-a000-000000000023";
    await insertComponent(testDb.db, {
      id: owned, name: "Owned Z", slug: "owned-z",
      category: "API", provider: "GITHUB", resourceType: "svc",
      teamOwnerId: teamZ,
    });
    await insertComponent(testDb.db, {
      id: otherOwned, name: "Owned A", slug: "owned-a",
      category: "API", provider: "GITHUB", resourceType: "svc",
      teamOwnerId: teamA,
    });
    await insertComponent(testDb.db, {
      id: unowned, name: "Unowned", slug: "unowned",
      category: "API", provider: "GITHUB", resourceType: "svc",
    });

    // instances: owned=2, otherOwned=1, unowned=0
    await insertInstance(testDb.db, { id: "018f0000-0000-7e10-a000-000000000101", componentId: owned, status: "RUNNING", externalId: "o:0", slug: "o-0", lastSeenAt: "2026-10-01T00:00:00Z" });
    await insertInstance(testDb.db, { id: "018f0000-0000-7e10-a000-000000000102", componentId: owned, status: "ERROR", externalId: "o:1", slug: "o-1", lastSeenAt: "2026-10-20T00:00:00Z" });
    await insertInstance(testDb.db, { id: "018f0000-0000-7e10-a000-000000000103", componentId: otherOwned, status: "STOPPED", externalId: "oa:0", slug: "oa-0", lastSeenAt: "2026-10-10T00:00:00Z" });

    const slugs = (body: any) => body.data.map((c: any) => c.slug);

    // owner asc: Alpha Team, Zeta Team, NULL last.
    expect(slugs(JSON.parse((await get("?sort=owner&order=asc")).payload)))
      .toEqual(["owned-a", "owned-z", "unowned"]);
    // instances asc: 0, 1, 2.
    expect(slugs(JSON.parse((await get("?sort=instances&order=asc")).payload)))
      .toEqual(["unowned", "owned-a", "owned-z"]);
    // health asc (worstStatus string): ERROR < RUNNING? — owned-z=ERROR,
    // owned-a=STOPPED, unowned=null → ERROR, STOPPED, NULL last.
    expect(slugs(JSON.parse((await get("?sort=health&order=asc")).payload)))
      .toEqual(["owned-z", "owned-a", "unowned"]);
    // lastSeenAt asc: owned-a(10-10) < owned-z(10-20) < unowned(null last).
    expect(slugs(JSON.parse((await get("?sort=lastSeenAt&order=asc")).payload)))
      .toEqual(["owned-a", "owned-z", "unowned"]);
  });

  it("searches name, slug, resourceType, externalId, and tags", async () => {
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000031",
      name: "Payments API", slug: "payments-api",
      category: "API", provider: "GITHUB",
      resourceType: "aws:s3:bucket", externalId: "ext-bucket-1",
      tags: ["payments-core"],
    });
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000032",
      name: "Unrelated", slug: "unrelated-svc",
      category: "API", provider: "OTHER",
      resourceType: "service", tags: [],
    });

    const find = async (qs: string) =>
      JSON.parse((await get(qs)).payload).data.map((c: any) => c.slug);

    expect(await find("?search=bucket")).toEqual(["payments-api"]); // resourceType
    expect(await find("?search=ext-bucket")).toEqual(["payments-api"]); // externalId
    expect(await find("?search=payments")).toEqual(["payments-api"]); // name + tag
    expect(await find("?search=PAYMENTS-CORE")).toEqual(["payments-api"]); // tag, case-insensitive
    expect(await find("?search=unrelated")).toEqual(["unrelated-svc"]); // name substring
    expect(await find("?search=zzz-no-match")).toEqual([]);
  });

  it("worstStatus omits the GONE rung when includeGone=false", async () => {
    const comp = "018f0000-0000-7e10-a000-000000000041";
    await insertComponent(testDb.db, {
      id: comp, name: "Mixed Health", slug: "mixed-health",
      category: "API", provider: "GITHUB", resourceType: "svc",
    });
    await insertInstance(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000141",
      componentId: comp, status: "RUNNING",
      externalId: "mh:0", slug: "mh-0", lastSeenAt: "2026-10-01T00:00:00Z",
    });
    await insertInstance(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000142",
      componentId: comp, status: "GONE",
      externalId: "mh:1", slug: "mh-1", lastSeenAt: "2026-10-20T00:00:00Z",
    });

    // includeGone=false: GONE instances are invisible — worstStatus must not
    // report GONE and the instance count excludes them.
    const hidden = JSON.parse((await get("")).payload);
    const rowHidden = hidden.data.find((c: any) => c.slug === "mixed-health");
    expect(rowHidden).toBeTruthy();
    expect(rowHidden.worstStatus).toBe("RUNNING");
    expect(rowHidden.instanceCount).toBe(1);

    // includeGone=true: the GONE rung returns (ERROR > GONE > STOPPED > RUNNING).
    const shown = JSON.parse((await get("?includeGone=true")).payload);
    const rowShown = shown.data.find((c: any) => c.slug === "mixed-health");
    expect(rowShown.worstStatus).toBe("GONE");
    expect(rowShown.instanceCount).toBe(2);
  });

  it("explicit lifecycle filter overrides the default RETIRED exclusion", async () => {
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000051",
      name: "Active One", slug: "active-one",
      category: "API", provider: "GITHUB", resourceType: "svc",
      lifecycle: "ACTIVE",
    });
    await insertComponent(testDb.db, {
      id: "018f0000-0000-7e10-a000-000000000052",
      name: "Retired One", slug: "retired-one",
      category: "API", provider: "GITHUB", resourceType: "svc",
      lifecycle: "RETIRED",
    });

    const slugs = async (qs: string) =>
      JSON.parse((await get(qs)).payload).data.map((c: any) => c.slug);

    // Bugfix: lifecycle=RETIRED must return rows WITHOUT includeRetired.
    expect(await slugs("?lifecycle=RETIRED")).toEqual(["retired-one"]);
    expect(await slugs("?lifecycle=RETIRED&includeRetired=true")).toEqual(["retired-one"]);
    expect(await slugs("?lifecycle=ACTIVE")).toEqual(["active-one"]);
    expect((await slugs("?lifecycle=RETIRED")).length).toBe(1);
    const retiredOnly = JSON.parse((await get("?lifecycle=RETIRED")).payload);
    expect(retiredOnly.pagination.total).toBe(1);
  });
});

});
