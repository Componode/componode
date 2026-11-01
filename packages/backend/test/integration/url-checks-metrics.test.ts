import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
} from "../helpers/api.js";

// Spec 051 US3 — URL Check metrics + observation history (task T046).
// Covers GET /url-checks/:id/metrics (availability, errorRate, coverageGap,
// SUCCESS-only percentiles, window filtering, target echo) and the
// observations `nextBefore` cursor, plus sibling-isolation of dispatchProbe
// failures (gap G5).

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

function iso(offsetMs: number, from = Date.now()): string {
  return new Date(from + offsetMs).toISOString();
}

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

// Component + shared setup + checks seeded directly (bypasses HTTP so
// sibling checks can share one setup and dispatch can be driven directly).
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

const okResponse = (status: number) =>
  ({
    status,
    body: { cancel: async () => {} },
  }) as unknown as Response;

describe("url check metrics + observations (US3)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let dispatchProbe: typeof import("../../src/services/probe-dispatcher.js").dispatchProbe;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;

    const { bootstrapAdmin } = await import(
      "../../src/services/bootstrap-service.js"
    );
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();

    ({ dispatchProbe } = await import(
      "../../src/services/probe-dispatcher.js"
    ));

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

  it("computes availability, errorRate, coverageGap, percentiles, counts, latest, and target echo", async () => {
    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "m-full",
    );
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(adminSession),
      payload: {
        name: "metrics",
        url: "https://example.com/health",
        componentInstanceId: instanceId,
        availabilityTarget: 99.5,
        targetWindow: "30D",
      },
    });
    expect(created.statusCode).toBe(201);
    const checkId = JSON.parse(created.payload).check.id;

    // 2 SUCCESS (durations 100/300), 1 FAILURE, 1 MISSED — MISSED is the
    // most recent so `latest` surfaces it.
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-4 * 60 * 60 * 1000),
      outcome: "SUCCESS",
      httpStatus: 200,
      durationMs: 100,
    });
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-3 * 60 * 60 * 1000),
      outcome: "SUCCESS",
      httpStatus: 200,
      durationMs: 300,
    });
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-2 * 60 * 60 * 1000),
      outcome: "FAILURE",
      httpStatus: 503,
      durationMs: 80,
      errorType: "HTTP_STATUS",
    });
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-1 * 60 * 60 * 1000),
      outcome: "MISSED",
      errorType: "AGENT_OFFLINE",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/url-checks/${checkId}/metrics?window=24h`,
      ...authed(adminSession),
    });
    expect(res.statusCode).toBe(200);
    const m = JSON.parse(res.payload);

    expect(m.window).toBe("24h");
    // availability = SUCCESS/(S+F+M) — the MISSED slot counts against it.
    expect(m.availability).toBeCloseTo(2 / 4);
    // errorRate = FAILURE/(S+F) — MISSED excluded.
    expect(m.errorRate).toBeCloseTo(1 / 3);
    // coverageGap = MISSED/total.
    expect(m.coverageGap).toBeCloseTo(1 / 4);
    // Percentiles over SUCCESS durationMs only (100, 300); percentile_cont
    // interpolates: p50=200, p95=290, p99=298.
    expect(m.p50).toBeCloseTo(200);
    expect(m.p95).toBeCloseTo(290);
    expect(m.p99).toBeCloseTo(298);
    expect(m.counts).toEqual({ success: 2, failure: 1, missed: 1 });
    expect(m.latest.outcome).toBe("MISSED");
    expect(m.latest.errorType).toBe("AGENT_OFFLINE");
    expect(m.vantage).toBe("HUB");
    expect(m.target).toEqual({ availability: 99.5, window: "30D" });
  });

  it("excludes observations older than the window and reports null target when unset", async () => {
    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "m-window",
    );
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(adminSession),
      payload: {
        name: "windowed",
        url: "https://example.com/",
        componentInstanceId: instanceId,
      },
    });
    const checkId = JSON.parse(created.payload).check.id;

    // Outside the 24h window — must not count.
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-25 * 60 * 60 * 1000),
      outcome: "SUCCESS",
      httpStatus: 200,
      durationMs: 50,
    });
    await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-1 * 60 * 60 * 1000),
      outcome: "FAILURE",
      httpStatus: 500,
      durationMs: 40,
      errorType: "HTTP_STATUS",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/url-checks/${checkId}/metrics?window=24h`,
      ...authed(adminSession),
    });
    expect(res.statusCode).toBe(200);
    const m = JSON.parse(res.payload);
    expect(m.counts).toEqual({ success: 0, failure: 1, missed: 0 });
    expect(m.availability).toBe(0);
    expect(m.errorRate).toBe(1);
    expect(m.coverageGap).toBe(0);
    // No SUCCESS rows in-window → null percentiles.
    expect(m.p50).toBeNull();
    expect(m.p95).toBeNull();
    expect(m.p99).toBeNull();
    expect(m.latest.outcome).toBe("FAILURE");
    expect(m.target).toBeNull();
  });

  it("paginates observations with the nextBefore cursor", async () => {
    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "m-pages",
    );
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(adminSession),
      payload: {
        name: "paged",
        url: "https://example.com/",
        componentInstanceId: instanceId,
      },
    });
    const checkId = JSON.parse(created.payload).check.id;

    const oldest = await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-3 * 60 * 60 * 1000),
      outcome: "FAILURE",
      httpStatus: 500,
      errorType: "HTTP_STATUS",
    });
    const middle = await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-2 * 60 * 60 * 1000),
      outcome: "SUCCESS",
      httpStatus: 200,
      durationMs: 90,
    });
    const newest = await seedObservation(testDb.db, checkId, {
      scheduledAt: iso(-1 * 60 * 60 * 1000),
      outcome: "SUCCESS",
      httpStatus: 200,
      durationMs: 110,
    });

    const first = await app.inject({
      method: "GET",
      url: `/api/v1/url-checks/${checkId}/observations?limit=2`,
      ...authed(adminSession),
    });
    expect(first.statusCode).toBe(200);
    const page1 = JSON.parse(first.payload);
    // Newest-first ordering.
    expect(page1.observations.map((o: any) => o.id)).toEqual([newest, middle]);
    expect(page1.nextBefore).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/url-checks/${checkId}/observations?limit=2&before=${encodeURIComponent(page1.nextBefore)}`,
      ...authed(adminSession),
    });
    expect(second.statusCode).toBe(200);
    const page2 = JSON.parse(second.payload);
    expect(page2.observations.map((o: any) => o.id)).toEqual([oldest]);
    expect(page2.nextBefore).toBeNull();
  });

  it("isolates sibling checks: one probe failure does not affect the other", async () => {
    const { checkIds } = await seedChecks(testDb.db, "m-siblings", [
      { name: "fails", url: "https://down.example.com/" },
      { name: "works", url: "https://up.example.com/" },
    ]);
    const [failingId, workingId] = checkIds;

    await dispatchProbe(failingId, iso(-60_000), {
      fetchImpl: async () => {
        throw Object.assign(new Error("refused"), {
          cause: { code: "ECONNREFUSED" },
        });
      },
    });
    await dispatchProbe(workingId, iso(-60_000), {
      fetchImpl: async () => okResponse(200),
    });

    const failing = await testDb.db
      .selectFrom("url_check_observations")
      .selectAll()
      .where("urlCheckId", "=", failingId)
      .execute();
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({
      outcome: "FAILURE",
      errorType: "CONNECT",
      vantage: "HUB",
    });

    const working = await testDb.db
      .selectFrom("url_check_observations")
      .selectAll()
      .where("urlCheckId", "=", workingId)
      .execute();
    expect(working).toHaveLength(1);
    expect(working[0]).toMatchObject({
      outcome: "SUCCESS",
      httpStatus: 200,
      errorType: null,
      vantage: "HUB",
    });
  });
});
