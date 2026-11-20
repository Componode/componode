import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import { normalizePurlIdentity } from "@componode/core";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  createPersonInDb,
  createSessionInDb,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
} from "../helpers/api.js";

const now = () => new Date().toISOString();

describe("packages routes", () => {
  let testDb: TestDb;
  let app: any;
  let viewerSession: string;
  const saved: Record<string, string | undefined> = {};
  let componentId = "";

  beforeAll(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV"]) saved[k] = process.env[k];
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    const viewerId = await createPersonInDb(testDb.db as any, {
      username: "viewer", passwordHash: null, role: "VIEWER",
    });
    viewerSession = (await createSessionInDb(testDb.db as any, viewerId)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    await testDb.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  beforeEach(async () => {
    await testDb.db.deleteFrom("bom_entries").execute();
    componentId = uuidv7();
    await testDb.db
      .insertInto("components")
      .values({
        id: componentId, name: "app", slug: `app-${componentId}`, category: "REPOSITORY",
        provider: "GITHUB", resourceType: "github:repository",
        lifecycle: "ACTIVE", teamOwnerId: null, externalId: "app",
        details: null, sunsetAt: null, lastSeenAt: null,
        lastSeenInRunId: null, createdBy: null, updatedBy: null,
        createdAt: now(), updatedAt: now(),
      } as never)
      .execute();
    await sql`
      INSERT INTO bom_entries
        (id, "componentId", purl, "purlIdentity", name, version, ecosystem,
         scope, "evidenceSource", licenses, direct, "lastReportedAt",
         "createdAt", "updatedAt")
      VALUES (${uuidv7()}, ${componentId}, 'pkg:npm/lodash@4.17.21',
              ${normalizePurlIdentity("pkg:npm/lodash@4.17.21")}, 'lodash',
              '4.17.21', 'npm', 'RUNTIME', 'REGISTRY_API', '[]'::jsonb,
              true, ${now()}, ${now()}, ${now()})
    `.execute(testDb.db);
  });

  const get = (path: string, session?: string) =>
    app.inject({
      method: "GET",
      url: `/api/v1${path}`,
      cookies: session ? { [SESSION_COOKIE_NAME]: session, ...csrfCookie } : csrfCookie,
      headers: csrfHeader,
    });

  it("returns the paginated rollup envelope to a Viewer", async () => {
    const res = await get("/packages", viewerSession);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pagination.total).toBe(1);
    expect(body.data[0].purl).toBe("pkg:npm/lodash");
    expect(body.data[0].componentCount).toBe(1);
    expect(body.data[0].catalogComponent).toBeNull();
  });

  it("rejects unknown query params (strict schema)", async () => {
    const res = await get("/packages?bogus=1", viewerSession);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await get("/packages");
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty page on no inventory (not an error)", async () => {
    await testDb.db.deleteFrom("bom_entries").execute();
    const res = await get("/packages", viewerSession);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});
