import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { randomBytes } from "node:crypto";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";

// Spec 052 US1 — Agent-vantage probe admission control. Per-agent bounded
// pools cap in-flight probes and dispatch rate; deferral is bounded and
// overflow lands MISSED/SATURATED; agent SATURATED refusals map to MISSED.
// Tests shrink bounds via env + resetAgentProbePoolsForTests.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const TEST_KEY = randomBytes(32).toString("base64");

function iso(offsetMs: number, from = Date.now()): string {
  return new Date(from + offsetMs).toISOString();
}

async function seedAgent(db: TestDb["db"], name: string) {
  const agentId = uuidv7();
  await db
    .insertInto("import_agents")
    .values({ id: agentId, name, createdBy: null } as any)
    .execute();
  return agentId;
}

async function seedCheck(
  db: TestDb["db"],
  input: {
    slug: string;
    url?: string;
    vantage?: string;
    agentId?: string | null;
    nextProbeAt?: string | null;
  },
) {
  const componentId = uuidv7();
  await db
    .insertInto("components")
    .values({
      id: componentId,
      name: `Comp ${input.slug}`,
      slug: input.slug,
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
      externalId: `${input.slug}-prod`,
      slug: `${input.slug}-prod`,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: iso(0),
      updatedAt: iso(0),
    } as any)
    .execute();
  const setupId = uuidv7();
  await db
    .insertInto("component_monitoring_setups")
    .values({
      id: setupId,
      componentId,
      cadenceSeconds: 60,
      vantage: input.vantage ?? "AGENT",
      agentId: input.agentId ?? null,
    })
    .execute();
  const checkId = uuidv7();
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
      enabled: true,
      cadenceSeconds: null,
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
  return { checkId };
}

async function observations(db: TestDb["db"], checkId: string) {
  return db
    .selectFrom("url_check_observations")
    .selectAll()
    .where("urlCheckId", "=", checkId)
    .orderBy("scheduledAt", "asc")
    .execute();
}

describe("url check agent-vantage bounds (spec 052 US1)", () => {
  let testDb: TestDb;
  let dispatchProbe: typeof import("../../src/services/probe-dispatcher.js").dispatchProbe;
  let setUrlCheckAgentDispatch: typeof import("../../src/services/probe-dispatcher.js").setUrlCheckAgentDispatch;
  let resetAgentProbePoolsForTests: typeof import("../../src/services/probe-dispatcher.js").resetAgentProbePoolsForTests;

  const okResult = (probeId: string) => ({
    probeId,
    outcome: "SUCCESS" as const,
    httpStatus: 200,
    durationMs: 10,
    errorType: null,
  });

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.COMPONODE_SECRETS_KEY = TEST_KEY;
    vi.resetModules();
    ({ dispatchProbe, setUrlCheckAgentDispatch, resetAgentProbePoolsForTests } =
      await import("../../src/services/probe-dispatcher.js"));
  }, 120000);

  afterAll(async () => {
    setUrlCheckAgentDispatch(null);
    await testDb?.cleanup();
    delete process.env.COMPONODE_SECRETS_KEY;
    delete process.env.URL_CHECK_AGENT_CONCURRENCY;
    delete process.env.URL_CHECK_AGENT_QUEUE_MAX;
    delete process.env.URL_CHECK_AGENT_RATE_LIMIT;
    delete process.env.URL_CHECK_SWEEP_INTERVAL_MS;
  });

  beforeEach(() => {
    setUrlCheckAgentDispatch(null);
    resetAgentProbePoolsForTests();
    delete process.env.URL_CHECK_AGENT_CONCURRENCY;
    delete process.env.URL_CHECK_AGENT_QUEUE_MAX;
    delete process.env.URL_CHECK_AGENT_RATE_LIMIT;
    delete process.env.URL_CHECK_SWEEP_INTERVAL_MS;
  });

  it("never exceeds the per-agent in-flight bound and completes every deferred slot once", async () => {
    process.env.URL_CHECK_AGENT_CONCURRENCY = "2";
    const agentId = await seedAgent(testDb.db, "bound-agent");
    const checks = await Promise.all(
      ["b-1", "b-2", "b-3", "b-4", "b-5"].map((slug) =>
        seedCheck(testDb.db, { slug, agentId }),
      ),
    );

    let inFlight = 0;
    let maxInFlight = 0;
    setUrlCheckAgentDispatch(async (_id, payload) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 60));
      inFlight -= 1;
      return okResult(payload.probeId);
    });

    await Promise.all(
      checks.map(({ checkId }) => dispatchProbe(checkId, iso(0))),
    );

    expect(maxInFlight).toBeLessThanOrEqual(2);
    for (const { checkId } of checks) {
      const obs = await observations(testDb.db, checkId);
      expect(obs).toHaveLength(1);
      expect(obs[0]).toMatchObject({ outcome: "SUCCESS", vantage: "AGENT" });
    }
  });

  it("records MISSED/SATURATED when the deferral bound is reached — never silently dropped", async () => {
    process.env.URL_CHECK_AGENT_CONCURRENCY = "1";
    process.env.URL_CHECK_AGENT_QUEUE_MAX = "1";
    const agentId = await seedAgent(testDb.db, "queue-agent");
    const checks = await Promise.all(
      ["q-1", "q-2", "q-3"].map((slug) =>
        seedCheck(testDb.db, { slug, agentId }),
      ),
    );

    const dispatched: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setUrlCheckAgentDispatch(async (_id, payload) => {
      dispatched.push(payload.probeId);
      await gate; // hold the single in-flight slot
      return okResult(payload.probeId);
    });

    const first = dispatchProbe(checks[0].checkId, iso(0));
    // Give the first dispatch a tick to occupy the in-flight slot.
    await new Promise((r) => setTimeout(r, 20));
    const second = dispatchProbe(checks[1].checkId, iso(0));
    await new Promise((r) => setTimeout(r, 20));
    // Queue now holds check 2 (size 1 = max) — check 3 must be refused.
    await dispatchProbe(checks[2].checkId, iso(0));

    const obs3 = await observations(testDb.db, checks[2].checkId);
    expect(obs3).toHaveLength(1);
    expect(obs3[0]).toMatchObject({
      outcome: "MISSED",
      errorType: "SATURATED",
      vantage: "AGENT",
      agentId,
    });
    expect(dispatched).toHaveLength(1);

    release();
    await Promise.all([first, second]);
    for (const { checkId } of checks.slice(0, 2)) {
      const obs = await observations(testDb.db, checkId);
      expect(obs).toHaveLength(1);
      expect(obs[0].outcome).toBe("SUCCESS");
    }
  });

  it("bounds the dispatch rate per sweep interval per agent", async () => {
    process.env.URL_CHECK_AGENT_CONCURRENCY = "10";
    process.env.URL_CHECK_AGENT_RATE_LIMIT = "1";
    process.env.URL_CHECK_SWEEP_INTERVAL_MS = "80";
    const agentId = await seedAgent(testDb.db, "rate-agent");
    const checks = await Promise.all(
      ["r-1", "r-2"].map((slug) => seedCheck(testDb.db, { slug, agentId })),
    );

    const starts: number[] = [];
    setUrlCheckAgentDispatch(async (_id, payload) => {
      starts.push(Date.now());
      return okResult(payload.probeId);
    });

    await Promise.all(
      checks.map(({ checkId }) => dispatchProbe(checkId, iso(0))),
    );

    expect(starts).toHaveLength(2);
    // Second dispatch must wait for the next 80 ms interval window.
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(50);
    for (const { checkId } of checks) {
      const obs = await observations(testDb.db, checkId);
      expect(obs).toHaveLength(1);
    }
  });

  it("isolates agents — saturation on one agent does not delay another agent or hub-vantage probes", async () => {
    process.env.URL_CHECK_AGENT_CONCURRENCY = "1";
    process.env.URL_CHECK_AGENT_QUEUE_MAX = "1";
    const agentA = await seedAgent(testDb.db, "agent-a");
    const agentB = await seedAgent(testDb.db, "agent-b");
    const a1 = await seedCheck(testDb.db, { slug: "iso-a1", agentId: agentA });
    const a2 = await seedCheck(testDb.db, { slug: "iso-a2", agentId: agentA });
    const b1 = await seedCheck(testDb.db, { slug: "iso-b1", agentId: agentB });
    const hub = await seedCheck(testDb.db, { slug: "iso-hub", vantage: "HUB" });

    const calls: Record<string, number> = { A: 0, B: 0 };
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    setUrlCheckAgentDispatch(async (id, payload) => {
      if (id === agentA) {
        calls.A += 1;
        await gateA;
      } else {
        calls.B += 1;
      }
      return okResult(payload.probeId);
    });

    const pa1 = dispatchProbe(a1.checkId, iso(0));
    await new Promise((r) => setTimeout(r, 20));
    const pa2 = dispatchProbe(a2.checkId, iso(0));
    const pb1 = dispatchProbe(b1.checkId, iso(0));
    const phub = dispatchProbe(hub.checkId, iso(0), {
      fetchImpl: async () =>
        ({ status: 200, body: { cancel: async () => {} } }) as unknown as Response,
    });

    // B and HUB complete while A's single in-flight slot is still held.
    await Promise.all([pb1, phub]);
    expect(calls.B).toBe(1);
    expect(calls.A).toBe(1); // a2 is deferred, not yet dispatched
    const bObs = await observations(testDb.db, b1.checkId);
    expect(bObs[0].outcome).toBe("SUCCESS");
    const hubObs = await observations(testDb.db, hub.checkId);
    expect(hubObs[0]).toMatchObject({ outcome: "SUCCESS", vantage: "HUB" });

    releaseA();
    await Promise.all([pa1, pa2]);
    expect(calls.A).toBe(2); // a1 then deferred a2 both ran, one at a time
    for (const { checkId } of [a1, a2]) {
      const obs = await observations(testDb.db, checkId);
      expect(obs).toHaveLength(1);
      expect(obs[0].outcome).toBe("SUCCESS");
    }
  });

  it("records exactly one MISSED/AGENT_OFFLINE when the session drops mid-probe", async () => {
    const agentId = await seedAgent(testDb.db, "lost-agent");
    const { checkId } = await seedCheck(testDb.db, {
      slug: "lost-mid",
      agentId,
    });
    setUrlCheckAgentDispatch(async (_id, payload) => {
      await new Promise((r) => setTimeout(r, 20));
      throw Object.assign(new Error("Agent has no connected session"), {
        statusCode: 503,
        code: "AGENT_OFFLINE",
      });
    });

    await dispatchProbe(checkId, iso(0));

    const obs = await observations(testDb.db, checkId);
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      outcome: "MISSED",
      errorType: "AGENT_OFFLINE",
      vantage: "AGENT",
      agentId,
    });
  });

  it("a check disabled mid-flight yields at most one observation and no further schedule", async () => {
    const agentId = await seedAgent(testDb.db, "disable-agent");
    const { checkId } = await seedCheck(testDb.db, {
      slug: "disable-mid",
      agentId,
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setUrlCheckAgentDispatch(async (_id, payload) => {
      await gate;
      return okResult(payload.probeId);
    });

    const scheduledAt = iso(0);
    const inflight = dispatchProbe(checkId, scheduledAt);
    await new Promise((r) => setTimeout(r, 20));

    // Disable while the probe is in flight — the 051 edge-case rule lets
    // it finish and record its real outcome, but nothing new is scheduled.
    await testDb.db
      .updateTable("url_checks")
      .set({ enabled: false, nextProbeAt: null, updatedAt: iso(0) })
      .where("id", "=", checkId)
      .execute();

    release();
    await inflight;

    const obs = await observations(testDb.db, checkId);
    expect(obs.length).toBeLessThanOrEqual(1);
    const check = await testDb.db
      .selectFrom("url_checks")
      .select(["enabled", "nextProbeAt"])
      .where("id", "=", checkId)
      .executeTakeFirstOrThrow();
    expect(check.enabled).toBe(false);
    expect(check.nextProbeAt).toBeNull();
  });

  it("maps an agent SATURATED refusal to a MISSED observation — never an endpoint failure", async () => {
    const agentId = await seedAgent(testDb.db, "refuse-agent");
    const { checkId } = await seedCheck(testDb.db, {
      slug: "sat-map",
      agentId,
    });
    setUrlCheckAgentDispatch(async (_id, payload) => ({
      probeId: payload.probeId,
      outcome: "FAILURE" as const,
      errorType: "SATURATED",
    }));

    await dispatchProbe(checkId, iso(0));

    const obs = await observations(testDb.db, checkId);
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      outcome: "MISSED",
      errorType: "SATURATED",
      vantage: "AGENT",
      agentId,
    });
  });
});
