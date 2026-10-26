import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  SESSION_COOKIE_NAME,
  createSessionInDb,
} from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const UUID_SHAPED_SLUG = "12345678-1234-1234-1234-123456789abc";

describe("detail reads — teams/lobs/groups by id or slug (G7/G8/G9)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  const ids: Record<string, string> = {};
  const now = () => new Date().toISOString();

  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"]) {
      saved[k] = process.env[k];
    }
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

    const adminRow = await testDb.db
      .selectFrom("persons")
      .select(["id"])
      .where("username", "=", ADMIN_USERNAME)
      .executeTakeFirstOrThrow();
    adminSession = (await createSessionInDb(testDb.db, adminRow.id)).token;

    ids.team = uuidv7();
    await testDb.db.insertInto("teams").values({
      id: ids.team, name: "Platform Eng", slug: "platform-eng",
      description: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    // A team whose derived slug is itself UUID-shaped — must still resolve.
    ids.weirdTeam = uuidv7();
    await testDb.db.insertInto("teams").values({
      id: ids.weirdTeam, name: UUID_SHAPED_SLUG, slug: UUID_SHAPED_SLUG,
      description: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    ids.lob = uuidv7();
    await testDb.db.insertInto("line_of_businesses").values({
      id: ids.lob, name: "Payments", slug: "payments",
      description: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    ids.group = uuidv7();
    await testDb.db.insertInto("component_groups").values({
      id: ids.group, name: "Data Services", slug: "data-services",
      description: null, lifecycle: "ACTIVE", teamOwnerId: null,
      createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const get = (url: string, session = adminSession) =>
    app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE_NAME]: session } });

  it("GET /teams/:id resolves by id", async () => {
    const res = await get(`/api/v1/teams/${ids.team}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().team.slug).toBe("platform-eng");
  });

  it("GET /teams/:id resolves by slug", async () => {
    const res = await get("/api/v1/teams/platform-eng");
    expect(res.statusCode).toBe(200);
    expect(res.json().team.id).toBe(ids.team);
  });

  it("UUID-shaped slug still resolves via slug fallback", async () => {
    const res = await get(`/api/v1/teams/${UUID_SHAPED_SLUG}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().team.id).toBe(ids.weirdTeam);
  });

  it("GET /lobs/:id resolves by id and slug", async () => {
    const byId = await get(`/api/v1/lobs/${ids.lob}`);
    expect(byId.statusCode).toBe(200);
    expect(byId.json().lob.slug).toBe("payments");
    const bySlug = await get("/api/v1/lobs/payments");
    expect(bySlug.statusCode).toBe(200);
    expect(bySlug.json().lob.id).toBe(ids.lob);
  });

  it("GET /teams/:id/members resolves members when addressed by slug", async () => {
    const { createPersonInDb } = await import("../helpers/api.js");
    const memberId = await createPersonInDb(testDb.db, { username: "member-1" });
    await testDb.db
      .updateTable("persons")
      .set({ teamId: ids.team })
      .where("id", "=", memberId)
      .execute();
    const res = await get("/api/v1/teams/platform-eng/members");
    expect(res.statusCode).toBe(200);
    expect(res.json().members.map((m: { id: string }) => m.id)).toContain(memberId);
  });

  it("GET /component-groups/:id resolves by slug", async () => {
    const res = await get("/api/v1/component-groups/data-services");
    expect(res.statusCode).toBe(200);
    expect(res.json().group.id).toBe(ids.group);
  });

  it("unknown identifiers return 404 NOT_FOUND", async () => {
    for (const url of [
      `/api/v1/teams/${uuidv7()}`,
      "/api/v1/lobs/no-such-lob",
      "/api/v1/component-groups/no-such-group",
    ]) {
      const res = await get(url);
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
    }
  });

  it("requires authentication", async () => {
    for (const url of ["/api/v1/teams/x", "/api/v1/lobs/x"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    }
  });
});
