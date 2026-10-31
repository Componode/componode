import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
  createPersonInDb,
  createSessionInDb,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

// Import Agents management API (spec 025, US1): create returns show-once
// enrollment material; list/detail never expose token or hashes.
describe("agents", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let originalDbUrl: string | undefined;
  let originalNodeEnv: string | undefined;
  let originalBootstrapUsername: string | undefined;
  let originalBootstrapPassword: string | undefined;

  beforeEach(async () => {
    originalDbUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    originalBootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
    originalBootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    vi.resetModules();
    vi.clearAllMocks();

    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();

    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    else delete process.env.DATABASE_URL;
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalBootstrapUsername !== undefined) process.env.BOOTSTRAP_ADMIN_USERNAME = originalBootstrapUsername;
    else delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    if (originalBootstrapPassword !== undefined) process.env.BOOTSTRAP_ADMIN_PASSWORD = originalBootstrapPassword;
    else delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    vi.resetModules();
  });

  function authed(overrides: Record<string, unknown> = {}) {
    return {
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      ...overrides,
    };
  }

  async function createAgent(payload: Record<string, unknown> = { name: "edge-agent" }) {
    return app.inject({
      method: "POST",
      url: "/api/v1/agents",
      ...authed({ payload }),
    });
  }

  it("creates an agent and returns show-once enrollment material", async () => {
    const res = await createAgent();
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.agent.name).toBe("edge-agent");
    expect(body.agent.status).toBe("NEVER_CONNECTED");
    expect(body.enrollment.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(new Date(body.enrollment.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("list and detail never expose tokens or hashes", async () => {
    const createRes = await createAgent();
    const { agent } = JSON.parse(createRes.payload);
    expect(agent.hasCredential).toBe(false);
    expect(agent.pendingEnrollment).toBe(true);
    expect(JSON.stringify(agent)).not.toContain("credentialHash");
    expect(JSON.stringify(agent)).not.toContain("enrollmentToken");

    const listRes = await app.inject(
      authed({ method: "GET", url: "/api/v1/agents" }),
    );
    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.payload);
    expect(list.agents).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("enrollmentToken");

    const detailRes = await app.inject(
      authed({ method: "GET", url: `/api/v1/agents/${agent.id}` }),
    );
    expect(detailRes.statusCode).toBe(200);
    const detail = JSON.parse(detailRes.payload);
    expect(detail.agent.name).toBe("edge-agent");
    expect(JSON.stringify(detail)).not.toContain("enrollmentToken");
  });

  it("detail returns createdBy display name and live enrollment expiry (spec 040)", async () => {
    const createRes = await createAgent();
    const { agent, enrollment } = JSON.parse(createRes.payload);

    const detailRes = await app.inject(
      authed({ method: "GET", url: `/api/v1/agents/${agent.id}` }),
    );
    expect(detailRes.statusCode).toBe(200);
    const detail = JSON.parse(detailRes.payload);
    // Bootstrap admin's displayName is its username.
    expect(detail.agent.createdBy).toBe("admin");
    expect(detail.agent.enrollmentExpiresAt).toBe(enrollment.expiresAt);
    // Still never leaks token material.
    expect(JSON.stringify(detail)).not.toContain("enrollmentTokenHash");
    expect(JSON.stringify(detail)).not.toContain(enrollment.token);

    // Token consumed → no live pending enrollment → null expiry.
    await testDb!.db
      .updateTable("import_agents")
      .set({ enrollmentTokenUsedAt: new Date().toISOString() })
      .where("id", "=", agent.id)
      .execute();
    const afterUse = await app.inject(
      authed({ method: "GET", url: `/api/v1/agents/${agent.id}` }),
    );
    expect(JSON.parse(afterUse.payload).agent.enrollmentExpiresAt).toBeNull();
  });

  it("detail returns enrollmentExpiresAt null for a revoked agent's dead token (spec 040)", async () => {
    const createRes = await createAgent();
    const { agent } = JSON.parse(createRes.payload);
    // Revoke without exchanging: the unused token is dead — no live expiry.
    await testDb!.db
      .updateTable("import_agents")
      .set({ revokedAt: new Date().toISOString() })
      .where("id", "=", agent.id)
      .execute();
    const res = await app.inject(
      authed({ method: "GET", url: `/api/v1/agents/${agent.id}` }),
    );
    expect(JSON.parse(res.payload).agent.enrollmentExpiresAt).toBeNull();
  });

  it("detail returns createdBy null when the actor column is unset (spec 040)", async () => {
    const id = uuidv7();
    await testDb!.db
      .insertInto("import_agents")
      .values({ id, name: "legacy-agent", createdBy: null } as any)
      .execute();
    const res = await app.inject(
      authed({ method: "GET", url: `/api/v1/agents/${id}` }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).agent.createdBy).toBeNull();
  });

  it("rejects a duplicate name with AGENT_NAME_TAKEN", async () => {
    await createAgent();
    const res = await createAgent();
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload).code).toBe("AGENT_NAME_TAKEN");
  });

  it.each([
    "Uppercase",
    "has space",
    "-leading",
    "trailing-",
    "under_score",
    "x".repeat(64),
  ])("rejects invalid name %j with VALIDATION_FAILED", async (name) => {
    const res = await createAgent({ name });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).code).toBe("VALIDATION_FAILED");
  });

  it("rejects unknown allowedImporters with VALIDATION_FAILED", async () => {
    const res = await createAgent({ name: "edge-agent", allowedImporters: ["not-an-importer"] });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).code).toBe("VALIDATION_FAILED");
  });

  it("accepts known allowedImporters", async () => {
    const res = await createAgent({ name: "edge-agent", allowedImporters: ["github", "kubernetes"] });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload).agent.allowedImporters).toEqual(["github", "kubernetes"]);
  });

  it("returns 401 unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { name: "edge-agent" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin roles", async () => {
    const viewerId = await createPersonInDb(testDb!.db, { username: "viewer1", role: "VIEWER" });
    const { token: viewerSession } = await createSessionInDb(testDb!.db, viewerId);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      cookies: { [SESSION_COOKIE_NAME]: viewerSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name: "edge-agent" },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).code).toBe("AUTH_FORBIDDEN");
  });

  it("writes a created audit entry with entityType import_agent", async () => {
    const res = await createAgent();
    const { agent } = JSON.parse(res.payload);
    const rows = await testDb!.db
      .selectFrom("entity_changes")
      .select(["action", "entityType", "entityId"])
      .where("entityId", "=", agent.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("created");
    expect(rows[0]!.entityType).toBe("import_agent");
  });
});
