import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { WebSocket } from "ws";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";
import { AGENT_PROTOCOL_VERSION } from "@componode/core";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

// Spec 028 US2 / T016: the heartbeat `ops` snapshot persists to
// "reportedStatus" and surfaces on the agent read APIs, labeled
// agent-reported — plus lastHeartbeatAt freshness and lastDisconnectReason.
describe("agent ops reporting", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let baseUrl: string;
  let adminSession: string | undefined;
  const savedEnv: Record<string, string | undefined> = {};

  function setEnv(key: string, value: string | undefined) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  beforeEach(async () => {
    testDb = await startTestDb();
    setEnv("DATABASE_URL", testDb.container.getConnectionUri());
    setEnv("NODE_ENV", "test");
    setEnv("BOOTSTRAP_ADMIN_USERNAME", ADMIN_USERNAME);
    setEnv("BOOTSTRAP_ADMIN_PASSWORD", ADMIN_PASSWORD);
    setEnv("AGENT_STALE_AFTER_MS", "300");
    setEnv("AGENT_SESSION_SWEEP_MS", "100");
    setEnv("AGENT_HELLO_TIMEOUT_MS", "2000");
    vi.resetModules();
    vi.clearAllMocks();

    const { bootstrapAdmin } =
      await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
      delete savedEnv[key];
    }
    vi.resetModules();
  });

  async function createAgent(name = "edge-agent") {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.payload) as {
      agent: { id: string; name: string };
      enrollment: { token: string; expiresAt: string };
    };
  }

  async function enroll(token: string) {
    const res = await fetch(`${baseUrl}/api/v1/agent/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return { status: res.status, body: await res.json() };
  }

  function connect(credential: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `${baseUrl.replace("http://", "ws://")}/api/v1/agent/stream`,
        { headers: { authorization: `Bearer ${credential}` } },
      );
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) => {
        reject(
          Object.assign(new Error("rejected"), { statusCode: res.statusCode }),
        );
      });
    });
  }

  async function sendHello(ws: WebSocket) {
    const { getManifests } =
      await import("../../src/services/importer-registry.js");
    const importers = (await getManifests()).map((m) => ({
      name: m.name,
      version: m.version,
    }));
    ws.send(
      JSON.stringify({
        type: "hello",
        payload: {
          protocolVersion: AGENT_PROTOCOL_VERSION,
          agentVersion: "1.0.0",
          importers,
          capabilities: { maxConcurrentJobs: 1 },
        },
      }),
    );
  }

  function nextMessage(ws: WebSocket, type: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout: ${type}`)), 3000);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  async function getAgent(id: string) {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/agents/${id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.payload) as { agent: Record<string, unknown> })
      .agent;
  }

  async function listAgents() {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/agents",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.payload) as {
      agents: Record<string, unknown>[];
    }).agents;
  }

  const OPS = {
    reportedAt: new Date().toISOString(),
    uptimeSeconds: 61,
    activeJobs: 1,
    jobs: { assigned: 4, completed: 2, failed: 1, cancelled: 1 },
    assetsStreamed: 87,
    credentialTests: { dispatched: 2, succeeded: 1, failed: 1 },
    secretResolutionFailures: 1,
    reconnects: 2,
  };

  it("persists the heartbeat ops snapshot and exposes reported state", async () => {
    const { agent, enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    const ws = await connect(body.agentToken);
    const okPromise = nextMessage(ws, "hello.ok");
    await sendHello(ws);
    await okPromise;

    ws.send(
      JSON.stringify({
        type: "heartbeat",
        payload: {
          currentJobs: 1,
          maxConcurrentJobs: 1,
          activeRunIds: [],
          ops: OPS,
        },
      }),
    );

    // Replace-on-write lands on the agent row with a hub-stamped receivedAt.
    await vi.waitFor(async () => {
      const row = await testDb!.db
        .selectFrom("import_agents")
        .select("reportedStatus")
        .where("id", "=", agent.id)
        .executeTakeFirstOrThrow();
      expect(row.reportedStatus).not.toBeNull();
    });
    const stored = (
      await testDb!.db
        .selectFrom("import_agents")
        .select("reportedStatus")
        .where("id", "=", agent.id)
        .executeTakeFirstOrThrow()
    ).reportedStatus as Record<string, unknown>;
    expect((stored.jobs as { assigned: number }).assigned).toBe(4);
    expect(typeof stored.receivedAt).toBe("string");

    // Detail surface: snapshot + live heartbeat freshness.
    const detail = await getAgent(agent.id);
    expect((detail.reportedStatus as { jobs: { assigned: number } }).jobs.assigned).toBe(4);
    expect(typeof detail.lastHeartbeatAt).toBe("string");
    expect(detail.lastDisconnectReason).toBeNull();

    // List surface: no disconnect reason while the session is live.
    const list = await listAgents();
    expect(list.find((a) => a.id === agent.id)?.lastDisconnectReason).toBeNull();

    // Agent-initiated close → reason + freshness floor flip to history.
    ws.close();
    await vi.waitFor(async () => {
      const after = await getAgent(agent.id);
      expect(after.lastDisconnectReason).toBe("client_close");
      expect(after.lastHeartbeatAt).toBeNull();
    });
    const after = await getAgent(agent.id);
    // The latest snapshot survives the disconnect (stale-but-labeled).
    expect((after.reportedStatus as { jobs: { assigned: number } }).jobs.assigned).toBe(4);
    expect(
      (await listAgents()).find((a) => a.id === agent.id)
        ?.lastDisconnectReason,
    ).toBe("client_close");
  });

  it("returns null reported state for an agent that never reported", async () => {
    const { agent } = await createAgent();
    const detail = await getAgent(agent.id);
    expect(detail.reportedStatus).toBeNull();
    expect(detail.lastHeartbeatAt).toBeNull();
    expect(detail.lastDisconnectReason).toBeNull();
  });
});
