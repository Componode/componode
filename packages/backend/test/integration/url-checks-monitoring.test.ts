import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { randomBytes } from "node:crypto";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { SESSION_COOKIE_NAME, csrfCookie, csrfHeader } from "../helpers/api.js";

// Spec 051 US2/US4/US5 — probe dispatcher, scheduler sweep + retention, and
// composite create. Service-level tests drive dispatchProbe/sweepOnce
// directly with stubbed fetch; composite + credential tests go over HTTP.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const TEST_KEY = randomBytes(32).toString("base64");

function iso(offsetMs: number, from = Date.now()): string {
  return new Date(from + offsetMs).toISOString();
}

const okResponse = (status: number) =>
  ({
    status,
    body: { cancel: async () => {} },
  }) as unknown as Response;

async function seedComponent(
  db: TestDb["db"],
  slug: string,
  opts: { category?: string; lifecycle?: string } = {},
) {
  const componentId = uuidv7();
  await db
    .insertInto("components")
    .values({
      id: componentId,
      name: `Comp ${slug}`,
      slug,
      category: opts.category ?? "API",
      provider: "GITHUB",
      resourceType: "github:repository",
      lifecycle: opts.lifecycle ?? "ACTIVE",
      componentGroupId: null,
      externalId: null,
      details: null,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: iso(0),
      updatedAt: iso(0),
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
      createdAt: iso(0),
      updatedAt: iso(0),
    } as any)
    .execute();
  return { componentId, instanceId };
}

async function seedCheck(
  db: TestDb["db"],
  input: {
    slug: string;
    url?: string;
    enabled?: boolean;
    cadenceSeconds?: number;
    checkCadence?: number | null;
    nextProbeAt?: string | null;
    vantage?: string;
    agentId?: string | null;
    lifecycle?: string;
  },
) {
  const { componentId, instanceId } = await seedComponent(db, input.slug, {
    lifecycle: input.lifecycle,
  });
  const setupId = uuidv7();
  await db
    .insertInto("component_monitoring_setups")
    .values({
      id: setupId,
      componentId,
      cadenceSeconds: input.cadenceSeconds ?? 60,
      vantage: input.vantage ?? "HUB",
      agentId: input.agentId ?? null,
    })
    .execute();
  const checkId = uuidv7();
  const enabled = input.enabled ?? true;
  await db
    .insertInto("url_checks")
    .values({
      id: checkId,
      setupId,
      componentInstanceId: instanceId,
      credentialId: null,
      name: `check-${input.slug}`,
      url: input.url ?? "https://example.com/health",
      method: "GET",
      enabled,
      cadenceSeconds: input.checkCadence ?? null,
      successPolicy: { codes: [], ranges: [{ min: 200, max: 299 }] },
      authMode: "NONE",
      authConfig: null,
      availabilityTarget: null,
      targetWindow: null,
      nextProbeAt: input.nextProbeAt === undefined ? iso(0) : input.nextProbeAt,
      createdBy: null,
      updatedBy: null,
      createdAt: iso(0),
      updatedAt: iso(0),
    } as any)
    .execute();
  return { componentId, instanceId, setupId, checkId };
}

async function observations(db: TestDb["db"], checkId: string) {
  // Agent-vantage dispatchProbe resolves at admission (spec 052) — drain
  // the per-agent pools so deferred work finalizes before we assert.
  const { waitForAgentProbePoolsIdle } =
    await import("../../src/services/probe-dispatcher.js");
  await waitForAgentProbePoolsIdle();
  return db
    .selectFrom("url_check_observations")
    .selectAll()
    .where("urlCheckId", "=", checkId)
    .orderBy("scheduledAt", "asc")
    .execute();
}

describe("url check monitoring (US2/US4/US5)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let dispatchProbe: typeof import("../../src/services/probe-dispatcher.js").dispatchProbe;
  let setUrlCheckAgentDispatch: typeof import("../../src/services/probe-dispatcher.js").setUrlCheckAgentDispatch;
  let sweepOnce: typeof import("../../src/services/url-check-scheduler.js").sweepOnce;
  let purgeExpiredObservations: typeof import("../../src/services/url-check-scheduler.js").purgeExpiredObservations;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.COMPONODE_SECRETS_KEY = TEST_KEY;
    vi.resetModules();

    const { resetKeyringCache } =
      await import("../../src/utils/credential-crypto.js");
    resetKeyringCache();
    const { bootstrapAdmin } =
      await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    ({ dispatchProbe, setUrlCheckAgentDispatch } =
      await import("../../src/services/probe-dispatcher.js"));
    ({ sweepOnce, purgeExpiredObservations } =
      await import("../../src/services/url-check-scheduler.js"));
    const { loginAs } = await import("../helpers/api.js");
    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD))!;
  }, 120000);

  afterAll(async () => {
    setUrlCheckAgentDispatch(null);
    await app?.close();
    await testDb?.cleanup();
    delete process.env.COMPONODE_SECRETS_KEY;
  });

  const authed = (session: string) => ({
    cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
    headers: csrfHeader,
  });

  // --- Dispatcher ----------------------------------------------------------

  it("writes a SUCCESS observation for an accepted status and advances nextProbeAt", async () => {
    const { checkId } = await seedCheck(testDb.db, { slug: "d-ok" });
    const scheduledAt = iso(-60_000);
    await dispatchProbe(checkId, scheduledAt, {
      fetchImpl: async () => okResponse(200),
    });
    const obs = await observations(testDb.db, checkId);
    expect(obs).toHaveLength(1);
    expect(new Date(obs[0].scheduledAt).toISOString()).toBe(scheduledAt);
    expect(obs[0]).toMatchObject({
      outcome: "SUCCESS",
      httpStatus: 200,
      errorType: null,
      vantage: "HUB",
      agentId: null,
    });
    const check = await testDb.db
      .selectFrom("url_checks")
      .select("nextProbeAt")
      .where("id", "=", checkId)
      .executeTakeFirstOrThrow();
    expect(new Date(check.nextProbeAt!).getTime()).toBe(
      new Date(scheduledAt).getTime() + 60_000,
    );
  });

  it("writes FAILURE/HTTP_STATUS when the response is outside the success policy", async () => {
    const { checkId } = await seedCheck(testDb.db, { slug: "d-404" });
    await dispatchProbe(checkId, iso(0), {
      fetchImpl: async () => okResponse(404),
    });
    const obs = await observations(testDb.db, checkId);
    expect(obs[0]).toMatchObject({
      outcome: "FAILURE",
      httpStatus: 404,
      errorType: "HTTP_STATUS",
    });
  });

  it("writes FAILURE with the transport errorType and never touches run/instance state", async () => {
    const { checkId, instanceId } = await seedCheck(testDb.db, {
      slug: "d-conn",
    });
    await dispatchProbe(checkId, iso(0), {
      fetchImpl: async () => {
        throw Object.assign(new Error("refused"), {
          cause: { code: "ECONNREFUSED" },
        });
      },
    });
    const obs = await observations(testDb.db, checkId);
    expect(obs[0]).toMatchObject({ outcome: "FAILURE", errorType: "CONNECT" });

    const instance = await testDb.db
      .selectFrom("component_instances")
      .select("status")
      .where("id", "=", instanceId)
      .executeTakeFirstOrThrow();
    expect(instance.status).toBe("RUNNING");
    const runs = await testDb.db
      .selectFrom("import_runs")
      .selectAll()
      .execute();
    expect(runs).toHaveLength(0);
  });

  it("writes MISSED/AGENT_OFFLINE when the agent has no live session", async () => {
    const agentId = uuidv7();
    await testDb.db
      .insertInto("import_agents")
      .values({ id: agentId, name: "probe-agent", createdBy: null } as any)
      .execute();
    const { checkId } = await seedCheck(testDb.db, {
      slug: "d-agent",
      vantage: "AGENT",
      agentId,
    });
    // Real seam — app.ts wired the live session service; the agent is
    // offline, so dispatch rejects AGENT_OFFLINE → MISSED.
    await dispatchProbe(checkId, iso(0));
    const obs = await observations(testDb.db, checkId);
    expect(obs[0]).toMatchObject({
      outcome: "MISSED",
      errorType: "AGENT_OFFLINE",
      vantage: "AGENT",
      agentId,
    });
  });

  it("writes an AGENT SUCCESS observation from a stubbed probe result", async () => {
    const agentId = uuidv7();
    await testDb.db
      .insertInto("import_agents")
      .values({ id: agentId, name: "probe-agent-2", createdBy: null } as any)
      .execute();
    const { checkId } = await seedCheck(testDb.db, {
      slug: "d-agent-ok",
      vantage: "AGENT",
      agentId,
    });
    setUrlCheckAgentDispatch(async (_id, payload) => ({
      probeId: payload.probeId,
      outcome: "SUCCESS",
      httpStatus: 200,
      durationMs: 42,
      errorType: null,
    }));
    try {
      await dispatchProbe(checkId, iso(0));
    } finally {
      setUrlCheckAgentDispatch((agentId2, payload) =>
        app.agentSessions.dispatchUrlCheckProbe(agentId2, payload),
      );
    }
    const obs = await observations(testDb.db, checkId);
    expect(obs[0]).toMatchObject({
      outcome: "SUCCESS",
      httpStatus: 200,
      durationMs: 42,
      vantage: "AGENT",
      agentId,
    });
  });

  // --- Scheduler -----------------------------------------------------------

  it("sweeps a due check: MISSED rows for skipped slots, probe for the current one", async () => {
    // 60 s cadence, nextProbeAt 150 s ago → due slots at -150, -90, -30;
    // the first two land MISSED, -30 gets a real probe.
    const start = Date.now();
    const { checkId } = await seedCheck(testDb.db, {
      slug: "s-due",
      nextProbeAt: iso(-150_000, start),
    });
    await sweepOnce({ fetchImpl: async () => okResponse(200) });
    const obs = await observations(testDb.db, checkId);
    expect(obs.map((o) => o.outcome)).toEqual(["MISSED", "MISSED", "SUCCESS"]);
    expect(new Date(obs[0].scheduledAt).getTime()).toBe(start - 150_000);
    expect(new Date(obs[2].scheduledAt).getTime()).toBe(start - 30_000);
    const check = await testDb.db
      .selectFrom("url_checks")
      .select("nextProbeAt")
      .where("id", "=", checkId)
      .executeTakeFirstOrThrow();
    expect(new Date(check.nextProbeAt!).getTime()).toBe(start + 30_000);
  });

  it("accrues nothing for disabled checks or retired components", async () => {
    const disabled = await seedCheck(testDb.db, {
      slug: "s-disabled",
      enabled: false,
      nextProbeAt: iso(-300_000),
    });
    const retired = await seedCheck(testDb.db, {
      slug: "s-retired",
      lifecycle: "RETIRED",
      nextProbeAt: iso(-300_000),
    });
    await sweepOnce({ fetchImpl: async () => okResponse(200) });
    expect(await observations(testDb.db, disabled.checkId)).toHaveLength(0);
    expect(await observations(testDb.db, retired.checkId)).toHaveLength(0);
  });

  it("purges observations older than the 30-day retention window", async () => {
    const { checkId } = await seedCheck(testDb.db, { slug: "s-purge" });
    const old = uuidv7();
    const fresh = uuidv7();
    await testDb.db
      .insertInto("url_check_observations")
      .values([
        {
          id: old,
          urlCheckId: checkId,
          scheduledAt: iso(-31 * 24 * 60 * 60 * 1000),
          outcome: "SUCCESS",
          httpStatus: 200,
          durationMs: 10,
          errorType: null,
          vantage: "HUB",
          agentId: null,
        },
        {
          id: fresh,
          urlCheckId: checkId,
          scheduledAt: iso(-60_000),
          outcome: "SUCCESS",
          httpStatus: 200,
          durationMs: 10,
          errorType: null,
          vantage: "HUB",
          agentId: null,
        },
      ] as any)
      .execute();
    const deleted = await purgeExpiredObservations();
    expect(deleted).toBeGreaterThanOrEqual(1);
    const remaining = await observations(testDb.db, checkId);
    expect(remaining.map((o) => o.id)).toEqual([fresh]);
  });

  // --- Composite create (US5, retired by spec 058) -------------------------

  it("POST /components with a monitoring block returns 410", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/components",
      ...authed(adminSession),
      payload: {
        name: "Monitored API",
        slug: "monitored-api",
        category: "API",
        provider: "GITHUB",
        resourceType: "custom:api",
        instance: { environment: "PRODUCTION", url: "https://example.com/" },
        monitoring: {
          setup: { cadenceSeconds: 120 },
          checks: [{ name: "health", url: "https://example.com/health" }],
        },
      },
    });
    expect(res.statusCode).toBe(410);
    expect(JSON.parse(res.payload).code).toBe("URL_CHECK_WRITE_DEPRECATED");
    const row = await testDb.db
      .selectFrom("components")
      .select("id")
      .where("slug", "=", "monitored-api")
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it("component + instance create without monitoring still succeeds", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/components",
      ...authed(adminSession),
      payload: {
        name: "Plain API",
        slug: "plain-api",
        category: "API",
        provider: "GITHUB",
        resourceType: "custom:api",
        instance: { environment: "PRODUCTION" },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.component.slug).toBe("plain-api");
    expect(body.instance.slug).toBe("plain-api-production");
    expect(body.instance.status).toBe("RUNNING");
  });

  // --- Credential dependents (US4) -------------------------------------------

  it("blocks credential deletion while a check references it (CREDENTIAL_IN_USE)", async () => {
    const cred = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed(adminSession),
      payload: { label: "Probe PAT", secrets: { token: "probe-secret" } },
    });
    expect(cred.statusCode).toBe(201);
    const credentialId = JSON.parse(cred.payload).credential.id;

    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "cred-api",
      { category: "API" },
    );
    // Direct writes are deprecated (spec 058) — seed the check directly.
    const setupId = uuidv7();
    await testDb.db
      .insertInto("component_monitoring_setups")
      .values({
        id: setupId,
        componentId,
        cadenceSeconds: 300,
        vantage: "HUB",
        agentId: null,
        createdAt: iso(0),
        updatedAt: iso(0),
      } as any)
      .execute();
    await testDb.db
      .insertInto("url_checks")
      .values({
        id: uuidv7(),
        setupId,
        componentInstanceId: instanceId,
        credentialId,
        name: "authed",
        url: "https://example.com/private",
        method: "GET",
        enabled: true,
        cadenceSeconds: null,
        successPolicy: { codes: [], ranges: [{ min: 200, max: 299 }] },
        authMode: "BEARER",
        authConfig: { tokenKey: "token" },
        availabilityTarget: null,
        targetWindow: null,
        autoDisableAfter: null,
        managedKey: null,
        nextProbeAt: null,
        createdBy: null,
        updatedBy: null,
        createdAt: iso(0),
        updatedAt: iso(0),
      } as any)
      .execute();

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/credentials/${credentialId}`,
      ...authed(adminSession),
    });
    expect(del.statusCode).toBe(409);
    const body = JSON.parse(del.payload);
    expect(body.code).toBe("CREDENTIAL_IN_USE");
    expect(body.details.urlChecks).toHaveLength(1);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/credentials/${credentialId}`,
      ...authed(adminSession),
    });
    expect(JSON.parse(detail.payload).dependents.urlChecks).toHaveLength(1);
  });
});
