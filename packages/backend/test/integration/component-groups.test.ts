import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { createPersonInDb, createSessionInDb, SESSION_COOKIE_NAME, csrfCookie, csrfHeader, truncateImportTables } from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

describe("component groups", () => {
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

    const { loginAs } = await import("../helpers/api.js");
    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD))!;

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

  it("creates and lists a component group", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/component-groups",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        name: "Payment Services",
        slug: "payment-services",
        description: "Payment microservices",
      },
    });
    expect(create.statusCode).toBe(201);
    const createBody = JSON.parse(create.payload);
    expect(createBody.group.name).toBe("Payment Services");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/component-groups",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(list.statusCode).toBe(200);
    const listBody = JSON.parse(list.payload);
    expect(listBody.groups).toHaveLength(1);
  });

  it("rejects duplicate slug with 409", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/component-groups",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name: "Group A", slug: "group-a" },
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/component-groups",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name: "Group B", slug: "group-a" },
    });
    expect(duplicate.statusCode).toBe(409);
    const body = JSON.parse(duplicate.payload);
    expect(body.code).toBe("SLUG_CONFLICT");
  });

  it("updates and deletes a group", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/component-groups",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name: "Old Name", slug: "old-name" },
    });
    const { id } = JSON.parse(create.payload).group;

    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/component-groups/${id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name: "New Name" },
    });
    expect(update.statusCode).toBe(200);
    const updateBody = JSON.parse(update.payload);
    expect(updateBody.group.name).toBe("New Name");

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/component-groups/${id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({
      method: "GET",
      url: `/api/v1/component-groups/${id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(get.statusCode).toBe(404);
  });

  it("prevents VIEWER from creating a group", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/component-groups",
      cookies: { [SESSION_COOKIE_NAME]: viewerSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name: "Viewer Group", slug: "viewer-group" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("assigns and unassigns a component from a group", async () => {
    const group = await app.inject({
      method: "POST",
      url: "/api/v1/component-groups",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name: "Assigned Group", slug: "assigned-group" },
    });
    const groupId = JSON.parse(group.payload).group.id;

    await testDb.db
      .insertInto("components")
      .values({
        id: "018f0000-0000-7e10-a000-000000000001",
        name: "API",
        slug: "api",
        category: "API",
        provider: "GITHUB",
        resourceType: "github:repository",
        lifecycle: "ACTIVE",
        componentGroupId: null,
        externalId: null,
        details: null,
        lastSeenAt: null,
        lastSeenInRunId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as any)
      .execute();

    const assign = await app.inject({
      method: "PATCH",
      url: "/api/v1/components/018f0000-0000-7e10-a000-000000000001",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { componentGroupId: groupId },
    });
    expect(assign.statusCode).toBe(200);
    const assignBody = JSON.parse(assign.payload);
    expect(assignBody.component.componentGroupId).toBe(groupId);

    const unassign = await app.inject({
      method: "PATCH",
      url: "/api/v1/components/018f0000-0000-7e10-a000-000000000001",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { componentGroupId: null },
    });
    expect(unassign.statusCode).toBe(200);
    const unassignBody = JSON.parse(unassign.payload);
    expect(unassignBody.component.componentGroupId).toBeNull();
  });

  // Bugfix 066: the update schema must accept explicit nulls — the service
  // already persists `?? null` for both fields (owner/description clearing).
  it("clears teamOwnerId and description with explicit nulls", async () => {
    const team = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name: "Group Owners" },
    });
    expect(team.statusCode).toBe(201);
    const teamId = JSON.parse(team.payload).team.id;

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/component-groups",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        name: "Owned Group",
        slug: "owned-group",
        description: "temporary notes",
        teamOwnerId: teamId,
      },
    });
    expect(create.statusCode).toBe(201);
    const { id } = JSON.parse(create.payload).group;

    const clear = await app.inject({
      method: "PATCH",
      url: `/api/v1/component-groups/${id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { teamOwnerId: null, description: null },
    });
    expect(clear.statusCode).toBe(200);
    const clearBody = JSON.parse(clear.payload);
    expect(clearBody.group.teamOwnerId).toBeNull();
    expect(clearBody.group.teamOwnerName).toBeNull();
    expect(clearBody.group.description).toBeNull();
  });
});
