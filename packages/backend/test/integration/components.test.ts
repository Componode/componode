import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME, truncateImportTables } from "../helpers/api.js";

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
});
