import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { SESSION_COOKIE_NAME, createSessionInDb } from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe.skipIf(!process.env.PERF)("audit activity feed performance", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
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

    const baseTime = new Date("2026-09-08T10:00:00.000Z");
    const batchSize = 1000;
    const total = 100_000;

    for (let offset = 0; offset < total; offset += batchSize) {
      const rows = [];
      const count = Math.min(batchSize, total - offset);
      for (let i = 0; i < count; i++) {
        rows.push({
          id: uuidv7(),
          entityType: "component",
          entityId: uuidv7(),
          action: "updated",
          changes: { name: `component-${offset + i}` },
          importRunId: null,
          createdBy: adminRow.id,
          createdByName: "admin",
          createdAt: new Date(baseTime.getTime() + (offset + i)).toISOString(),
        });
      }
      await testDb.db.insertInto("entity_changes").values(rows as never).execute();
    }
  }, 600_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("handles a 100k-row feed in under 2 seconds", async () => {
    const start = performance.now();
    const res = await app.inject({
      method: "GET",
      // Spec 068 caps pageSize at 100 — the service still scans the full
      // 100k-row feed server-side before slicing the page.
      url: "/api/v1/audit/activity?page=1&pageSize=100",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const elapsed = performance.now() - start;
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pagination.total).toBe(100_000);
    expect(body.data).toHaveLength(100);
    expect(elapsed).toBeLessThan(2000);
  });
});
