import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
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
    expect(body.pagination.pageSize).toBe(50);
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

  it("searches by name prefix", async () => {
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
});
});
