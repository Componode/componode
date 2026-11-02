import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { SESSION_COOKIE_NAME, csrfCookie, csrfHeader } from "../helpers/api.js";

// Spec 053 US1/US2 — Component checks list carries the compact 24h summary
// (availability, p95, coverageGap, counts) and the ≤12 recent observations
// per check in one bounded response; no per-check reads.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

function iso(offsetMs: number, from = Date.now()): string {
  return new Date(from + offsetMs).toISOString();
}

const H = 60 * 60 * 1000;

async function seedComponent(db: TestDb["db"], slug = "api") {
  const componentId = uuidv7();
  await db
    .insertInto("components")
    .values({
      id: componentId,
      name: "Checkout API",
      slug,
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
  const instanceId = uuidv7();
  await db
    .insertInto("component_instances")
    .values({
      id: instanceId,
      componentId,
      environment: "PRODUCTION",
      url: null,
      region: null,
      status: "RUNNING",
      version: null,
      deployedAt: null,
      rawConfig: null,
      externalId: `${slug}-prod`,
      slug: `${slug}-prod`,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
    } as any)
    .execute();
  return { componentId, instanceId };
}

async function seedChecks(
  db: TestDb["db"],
  slug: string,
  checks: Array<{ name: string; url: string }>,
) {
  const { componentId, instanceId } = await seedComponent(db, slug);
  const setupId = uuidv7();
  await db
    .insertInto("component_monitoring_setups")
    .values({
      id: setupId,
      componentId,
      cadenceSeconds: 300,
      vantage: "HUB",
      agentId: null,
    })
    .execute();
  const ids: string[] = [];
  for (const c of checks) {
    const checkId = uuidv7();
    await db
      .insertInto("url_checks")
      .values({
        id: checkId,
        setupId,
        componentInstanceId: instanceId,
        credentialId: null,
        name: c.name,
        url: c.url,
        method: "GET",
        enabled: true,
        cadenceSeconds: null,
        successPolicy: { codes: [], ranges: [{ min: 200, max: 299 }] },
        authMode: "NONE",
        authConfig: null,
        availabilityTarget: null,
        targetWindow: null,
        nextProbeAt: now(),
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as any)
      .execute();
    ids.push(checkId);
  }
  return { componentId, instanceId, setupId, checkIds: ids };
}

async function seedObservation(
  db: TestDb["db"],
  checkId: string,
  obs: {
    scheduledAt: string;
    outcome: "SUCCESS" | "FAILURE" | "MISSED";
    httpStatus?: number | null;
    durationMs?: number | null;
    errorType?: string | null;
    vantage?: string;
    agentId?: string | null;
  },
) {
  const id = uuidv7();
  await db
    .insertInto("url_check_observations")
    .values({
      id,
      urlCheckId: checkId,
      scheduledAt: obs.scheduledAt,
      outcome: obs.outcome,
      httpStatus: obs.httpStatus ?? null,
      durationMs: obs.durationMs ?? null,
      errorType: obs.errorType ?? null,
      vantage: obs.vantage ?? "HUB",
      agentId: obs.agentId ?? null,
      createdAt: now(),
    })
    .execute();
  return id;
}

describe("url checks list summary (spec 053)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;

    const { bootstrapAdmin } =
      await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();

    const { loginAs } = await import("../helpers/api.js");
    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD))!;
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
  });

  const authed = (session: string) => ({
    cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
    headers: csrfHeader,
  });

  const listChecks = async (componentId: string) => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(adminSession),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.payload);
  };

  it("returns 404 for a component that does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/components/${uuidv7()}/url-checks`,
      ...authed(adminSession),
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.payload).code).toBe("NOT_FOUND");
  });

  it("embeds a 24h summary per check with the metric-endpoint formulas", async () => {
    const { componentId, checkIds } = await seedChecks(testDb.db, "sum-1", [
      { name: "watched", url: "https://example.com/health" },
    ]);
    const checkId = checkIds[0]!;

    // 2 SUCCESS (100/300ms), 1 FAILURE, 1 MISSED — same fixture as the
    // metrics test so the compact summary is provably consistent.
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-4 * H),
      outcome: "SUCCESS",
      httpStatus: 200,
      durationMs: 100,
    });
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-3 * H),
      outcome: "SUCCESS",
      httpStatus: 200,
      durationMs: 300,
    });
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-2 * H),
      outcome: "FAILURE",
      httpStatus: 503,
      durationMs: 80,
      errorType: "HTTP_STATUS",
    });
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-1 * H),
      outcome: "MISSED",
      errorType: "AGENT_OFFLINE",
    });
    // Outside the 24h window — must not count toward the summary.
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-30 * H),
      outcome: "SUCCESS",
      httpStatus: 200,
      durationMs: 50,
    });

    const body = await listChecks(componentId);
    const item = body.checks.find((c: any) => c.id === checkId);
    expect(item).toBeTruthy();
    expect(item.summary).toBeTruthy();
    expect(item.summary.window).toBe("24h");
    // availability = SUCCESS/(S+F+M) — the MISSED slot counts against it.
    expect(item.summary.availability).toBeCloseTo(2 / 4);
    // p95 over SUCCESS durations only (100, 300) → interpolates to 290.
    expect(item.summary.p95).toBeCloseTo(290);
    expect(item.summary.coverageGap).toBeCloseTo(1 / 4);
    expect(item.summary.counts).toEqual({ success: 2, failure: 1, missed: 1 });
  });

  it("embeds the ≤12 most recent observations newest-first per check", async () => {
    const { componentId, checkIds } = await seedChecks(testDb.db, "sum-2", [
      { name: "chatty", url: "https://example.com/" },
    ]);
    const checkId = checkIds[0]!;

    const ids: string[] = [];
    for (let i = 14; i >= 1; i--) {
      ids.push(
        await seedObservation(testDb.db, checkId, {
          scheduledAt: iso(-i * H),
          outcome: i % 3 === 0 ? "FAILURE" : "SUCCESS",
          httpStatus: i % 3 === 0 ? 500 : 200,
          durationMs: 100 + i,
          errorType: i % 3 === 0 ? "HTTP_STATUS" : null,
        }),
      );
    }

    const body = await listChecks(componentId);
    const item = body.checks.find((c: any) => c.id === checkId);
    expect(item.recent).toHaveLength(12);
    // Newest-first; the 14 oldest→newest seed means the most recent 12
    // exclude the two oldest ids.
    const recentIds = item.recent.map((o: any) => o.id);
    const expected = [...ids.slice(2)].reverse();
    expect(recentIds).toEqual(expected);
    for (const o of item.recent) {
      expect(o.urlCheckId).toBe(checkId);
      expect(o.outcome).toBeTruthy();
    }
  });

  it("returns explicit no-data signals for a check with no observations", async () => {
    const { componentId, checkIds } = await seedChecks(testDb.db, "sum-3", [
      { name: "fresh", url: "https://example.com/" },
    ]);
    const checkId = checkIds[0]!;

    const body = await listChecks(componentId);
    const item = body.checks.find((c: any) => c.id === checkId);
    expect(item.latest).toBeNull();
    expect(item.summary.window).toBe("24h");
    expect(item.summary.availability).toBeNull();
    expect(item.summary.p95).toBeNull();
    expect(item.summary.coverageGap).toBe(0);
    expect(item.summary.counts).toEqual({ success: 0, failure: 0, missed: 0 });
    expect(item.recent).toEqual([]);
  });

  it("reports an all-missed window as a coverage gap, not endpoint failure", async () => {
    const { componentId, checkIds } = await seedChecks(testDb.db, "sum-4", [
      { name: "unmonitored", url: "https://example.com/" },
    ]);
    const checkId = checkIds[0]!;

    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-3 * H),
      outcome: "MISSED",
      errorType: "AGENT_OFFLINE",
    });
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-2 * H),
      outcome: "MISSED",
      errorType: "AGENT_OFFLINE",
    });
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-1 * H),
      outcome: "MISSED",
      errorType: "SATURATED",
    });

    const body = await listChecks(componentId);
    const item = body.checks.find((c: any) => c.id === checkId);
    expect(item.summary.availability).toBe(0);
    expect(item.summary.p95).toBeNull();
    expect(item.summary.coverageGap).toBe(1);
    expect(item.summary.counts).toEqual({ success: 0, failure: 0, missed: 3 });
    expect(item.recent).toHaveLength(3);
    expect(item.recent.every((o: any) => o.outcome === "MISSED")).toBe(true);
  });

  it("returns independent summaries for many checks in the single list response", async () => {
    const { componentId, checkIds } = await seedChecks(testDb.db, "sum-5", [
      { name: "alpha", url: "https://a.example.com/" },
      { name: "beta", url: "https://b.example.com/" },
      { name: "gamma", url: "https://c.example.com/" },
    ]);
    const [alpha, beta, gamma] = checkIds;

    // alpha: healthy — 3 successes.
    for (let i = 3; i >= 1; i--) {
      await seedObservation(testDb.db, alpha!, {
        scheduledAt: iso(-i * H),
        outcome: "SUCCESS",
        httpStatus: 200,
        durationMs: 100,
      });
    }
    // beta: degraded — 1 success, 1 failure.
    await seedObservation(testDb.db, beta!, {
      scheduledAt: iso(-2 * H),
      outcome: "SUCCESS",
      httpStatus: 200,
      durationMs: 400,
    });
    await seedObservation(testDb.db, beta!, {
      scheduledAt: iso(-1 * H),
      outcome: "FAILURE",
      httpStatus: 500,
      errorType: "HTTP_STATUS",
    });
    // gamma: no observations at all.

    const body = await listChecks(componentId);
    expect(body.checks).toHaveLength(3);

    const byId = new Map(body.checks.map((c: any) => [c.id, c]));
    const a = byId.get(alpha!);
    expect(a.summary.availability).toBe(1);
    expect(a.summary.p95).toBeCloseTo(100);
    expect(a.summary.coverageGap).toBe(0);
    expect(a.recent).toHaveLength(3);

    const b = byId.get(beta!);
    expect(b.summary.availability).toBeCloseTo(0.5);
    expect(b.summary.p95).toBeCloseTo(400);
    expect(b.summary.counts).toEqual({ success: 1, failure: 1, missed: 0 });
    expect(b.recent).toHaveLength(2);
    // Desc by scheduledAt — the FAILURE (1h ago) precedes the SUCCESS (2h ago).
    expect(b.recent[0].outcome).toBe("FAILURE");

    const g = byId.get(gamma!);
    expect(g.summary.availability).toBeNull();
    expect(g.recent).toEqual([]);
  });
});
