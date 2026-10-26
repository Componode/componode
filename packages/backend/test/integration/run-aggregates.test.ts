import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("GET /api/v1/importer-configs/:id/run-aggregates (spec 031)", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let session: string | undefined;
  let db: any;
  const origEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"]) {
      origEnv[k] = process.env[k];
    }
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    vi.resetModules();

    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    ({ db } = await import("../../src/db/connection.js"));
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    session = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    for (const [k, v] of Object.entries(origEnv)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
    vi.resetModules();
  });

  function isoDaysAgo(n: number) {
    return new Date(Date.now() - n * 86400000).toISOString();
  }

  async function seedConfigWithRuns() {
    const configId = uuidv7();
    const now = new Date().toISOString();
    await db
      .insertInto("importer_configs")
      .values({
        id: configId,
        importerName: "github",
        label: "agg-test",
        scope: {},
        secretRefs: null,
        schedule: null,
        enabled: true,
        agentId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    const run = (status: string, createdAt: string, created = 0, updated = 0) =>
      db
        .insertInto("import_runs")
        .values({
          id: uuidv7(),
          configId,
          agentId: null,
          status,
          triggeredBy: null,
          startedAt: createdAt,
          completedAt: createdAt,
          assetsProcessed: created + updated,
          assetsCreated: created,
          assetsUpdated: updated,
          instancesOrphaned: 0,
          componentsRetired: 0,
          currentPhase: null,
          cancelRequestedAt: null,
          credentialIds: null,
          errorMessage: null,
          errorStack: null,
          errorType: null,
          createdAt,
        })
        .execute();

    // today: 2 ok + 1 failed; 3 days ago: 1 ok; 100 days ago: outside window
    await run("COMPLETED", isoDaysAgo(0), 10, 2);
    await run("COMPLETED", isoDaysAgo(0), 5, 1);
    await run("FAILED", isoDaysAgo(0), 0, 0);
    await run("COMPLETED", isoDaysAgo(3), 20, 4);
    await run("COMPLETED", isoDaysAgo(100), 99, 9);
    return configId;
  }

  it("returns per-day buckets matching seeded runs, zero-filled", async () => {
    const configId = await seedConfigWithRuns();
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/run-aggregates?days=7`,
      cookies: { [SESSION_COOKIE_NAME]: session! },
    });

    expect(res.statusCode).toBe(200);
    const days = res.json().days;
    expect(days).toHaveLength(7);
    expect(days[0].day < days[6].day).toBe(true);

    const today = days[6];
    expect(today.runs).toBe(3);
    expect(today.failed).toBe(1);
    expect(today.created).toBe(15);
    expect(today.updated).toBe(3);

    const threeBack = days[3];
    expect(threeBack.runs).toBe(1);
    expect(threeBack.failed).toBe(0);
    expect(threeBack.created).toBe(20);
    expect(threeBack.updated).toBe(4);

    // zero-filled day (1 day back has nothing)
    expect(days[5].runs).toBe(0);
    // 100-day-old run excluded → no day exceeds seeded sums
    expect(Math.max(...days.map((d: { created: number }) => d.created))).toBe(20);
  });

  it("defaults to a 14-day window and clamps days to 90", async () => {
    const configId = await seedConfigWithRuns();
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/run-aggregates`,
      cookies: { [SESSION_COOKIE_NAME]: session! },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().days).toHaveLength(14);

    const clamped = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/run-aggregates?days=999`,
      cookies: { [SESSION_COOKIE_NAME]: session! },
    });
    expect(clamped.json().days).toHaveLength(90);
  });

  it("empty series for a config with no runs / unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${uuidv7()}/run-aggregates?days=7`,
      cookies: { [SESSION_COOKIE_NAME]: session! },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().days).toHaveLength(7);
    expect(res.json().days.every((d: { runs: number }) => d.runs === 0)).toBe(true);
  });

  it("unauthenticated → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${uuidv7()}/run-aggregates`,
      cookies: csrfCookie,
      headers: csrfHeader,
    });
    expect(res.statusCode).toBe(401);
  });
});
