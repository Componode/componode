import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { WebSocket } from "ws";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";
import { hashToken } from "../../src/utils/crypto.js";
import { AGENT_PROTOCOL_VERSION } from "@componode/core";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

// Agent channel (spec 025 US2): enrollment exchange + authenticated WS stream,
// lockstep handshake, heartbeat liveness, supersede, offline detection.
// Uses a real listening server + real ws client.
describe("agent channel", () => {
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
    // Shrink liveness windows so the sweep can be exercised in-test.
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

  function wsUrl() {
    return `${baseUrl.replace("http://", "ws://")}/api/v1/agent/stream`;
  }

  function connect(credential: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl(), {
        headers: { authorization: `Bearer ${credential}` },
      });
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) => {
        reject(
          Object.assign(new Error("rejected"), { statusCode: res.statusCode }),
        );
      });
    });
  }

  function helloPayload(overrides: Record<string, unknown> = {}) {
    return {
      type: "hello",
      payload: {
        protocolVersion: AGENT_PROTOCOL_VERSION,
        agentVersion: "1.0.0",
        importers: [],
        capabilities: { maxConcurrentJobs: 1 },
        ...overrides,
      },
    };
  }

  async function hubImporters() {
    const { getManifests } =
      await import("../../src/services/importer-registry.js");
    return (await getManifests()).map((m) => ({
      name: m.name,
      version: m.version,
    }));
  }

  async function sendHello(
    ws: WebSocket,
    importers?: { name: string; version: string }[],
  ) {
    ws.send(
      JSON.stringify(
        helloPayload({ importers: importers ?? (await hubImporters()) }),
      ),
    );
  }

  function nextMessage(
    ws: WebSocket,
    type: string,
    timeoutMs = 3000,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for ${type}`)),
        timeoutMs,
      );
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          resolve(msg);
        }
      });
    });
  }

  async function agentRow(id: string) {
    return testDb!.db
      .selectFrom("import_agents")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  }

  it("enrolls a valid token once, then rejects reuse", async () => {
    const { agent, enrollment } = await createAgent();
    const res = await enroll(enrollment.token);
    expect(res.status).toBe(200);
    expect(res.body.agentToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.body.agent.id).toBe(agent.id);

    // Single-use: second exchange of the same token fails.
    const again = await enroll(enrollment.token);
    expect(again.status).toBe(401);
    expect(again.body.code).toBe("AGENT_ENROLLMENT_INVALID");

    const row = await agentRow(agent.id);
    expect(row.enrollmentTokenUsedAt).not.toBeNull();
    expect(row.enrollmentTokenHash).toBeNull();
    expect(row.credentialHash).toBe(hashToken(res.body.agentToken));
  });

  it("writes an 'enrolled' audit entry with agent actor", async () => {
    const { agent, enrollment } = await createAgent();
    await enroll(enrollment.token);
    const rows = await testDb!.db
      .selectFrom("entity_changes")
      .select(["action", "createdByName"])
      .where("entityId", "=", agent.id)
      .where("action", "=", "enrolled")
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdByName).toBe("agent:edge-agent");
  });

  it("rejects unknown enrollment token", async () => {
    const res = await enroll("does-not-exist");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AGENT_ENROLLMENT_INVALID");
  });

  it("rejects an expired enrollment token", async () => {
    const { agent, enrollment } = await createAgent();
    await testDb!.db
      .updateTable("import_agents")
      .set({
        enrollmentTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      })
      .where("id", "=", agent.id)
      .execute();
    const res = await enroll(enrollment.token);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AGENT_ENROLLMENT_INVALID");
  });

  it("rejects stream upgrade without a credential", async () => {
    await expect(connect("")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects stream upgrade with an unknown credential", async () => {
    await expect(connect("bogus-token")).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("rejects stream upgrade for a revoked agent", async () => {
    const { agent, enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    await testDb!.db
      .updateTable("import_agents")
      .set({ revokedAt: new Date().toISOString() })
      .where("id", "=", agent.id)
      .execute();
    await expect(connect(body.agentToken)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("accepts a valid hello and marks the agent CONNECTED", async () => {
    const { agent, enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    const ws = await connect(body.agentToken);
    const okPromise = nextMessage(ws, "hello.ok");
    await sendHello(ws);
    const ok = await okPromise;
    const payload = ok.payload as Record<string, unknown>;
    expect(payload.agentId).toBe(agent.id);
    expect(payload.protocolVersion).toBe(AGENT_PROTOCOL_VERSION);

    const row = await agentRow(agent.id);
    expect(row.status).toBe("CONNECTED");
    expect(row.agentVersion).toBe("1.0.0");
    expect(row.lastSeenAt).not.toBeNull();

    const sessions = await testDb!.db
      .selectFrom("agent_sessions")
      .selectAll()
      .where("agentId", "=", agent.id)
      .execute();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.disconnectedAt).toBeNull();
    ws.close();
  });

  it("rejects a mismatched protocolVersion", async () => {
    const { enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    const ws = await connect(body.agentToken);
    const errPromise = nextMessage(ws, "error");
    ws.send(
      JSON.stringify(
        helloPayload({
          protocolVersion: AGENT_PROTOCOL_VERSION + 1,
          importers: await hubImporters(),
        }),
      ),
    );
    const err = await errPromise;
    expect((err.payload as Record<string, unknown>).code).toBe(
      "AGENT_VERSION_MISMATCH",
    );
    ws.close();
  });

  it("rejects a mismatched importer set", async () => {
    const { enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    const ws = await connect(body.agentToken);
    const errPromise = nextMessage(ws, "error");
    ws.send(
      JSON.stringify(
        helloPayload({
          importers: [{ name: "github", version: "0.0.0-bogus" }],
        }),
      ),
    );
    const err = await errPromise;
    expect((err.payload as Record<string, unknown>).code).toBe(
      "AGENT_VERSION_MISMATCH",
    );
    ws.close();
  });

  it("supersedes the prior session on a second connect", async () => {
    const { agent, enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);

    const ws1 = await connect(body.agentToken);
    const firstOk = nextMessage(ws1, "hello.ok");
    await sendHello(ws1);
    await firstOk;

    const ws1Closed = new Promise<number>((resolve) =>
      ws1.on("close", (code) => resolve(code)),
    );
    const closePromise = nextMessage(ws1, "close");

    const ws2 = await connect(body.agentToken);
    const secondOk = nextMessage(ws2, "hello.ok");
    await sendHello(ws2);
    await secondOk;

    const closeFrame = await closePromise;
    expect((closeFrame.payload as Record<string, unknown>).reason).toBe(
      "superseded",
    );
    await ws1Closed;

    const sessions = await testDb!.db
      .selectFrom("agent_sessions")
      .selectAll()
      .where("agentId", "=", agent.id)
      .orderBy("connectedAt")
      .execute();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.disconnectReason).toBe("superseded");
    expect(sessions[1]!.disconnectedAt).toBeNull();
    ws2.close();
  });

  it("marks a silent session heartbeat_timeout and the agent OFFLINE", async () => {
    const { agent, enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    const ws = await connect(body.agentToken);
    const ok = nextMessage(ws, "hello.ok");
    await sendHello(ws);
    await ok;

    // Wait past the shrunken stale window + sweep interval.
    const deadline = Date.now() + 5000;
    let row;
    while (Date.now() < deadline) {
      row = await agentRow(agent.id);
      if (row.status === "OFFLINE") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(row!.status).toBe("OFFLINE");

    const sessions = await testDb!.db
      .selectFrom("agent_sessions")
      .selectAll()
      .where("agentId", "=", agent.id)
      .execute();
    expect(sessions[0]!.disconnectReason).toBe("heartbeat_timeout");
    ws.close();
  });

  it("produces zero audit rows for rejected attempts", async () => {
    const { agent, enrollment } = await createAgent();
    await enroll(enrollment.token);

    await enroll("bogus");
    await expect(connect("bogus")).rejects.toMatchObject({ statusCode: 401 });

    const rows = await testDb!.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityId", "=", agent.id)
      .execute();
    // created + enrolled only — rejections never audit.
    expect(rows.map((r) => r.action).sort()).toEqual(["created", "enrolled"]);
  });

  it("sends a terminal close{invalid_hello} frame on a malformed first frame", async () => {
    const { enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    const ws = await connect(body.agentToken);
    const errPromise = nextMessage(ws, "error");
    const closePromise = nextMessage(ws, "close");
    const closed = new Promise<number>((r) =>
      ws.on("close", (code) => r(code)),
    );
    ws.send(JSON.stringify({ type: "hello", payload: { bogus: true } }));
    await errPromise;
    const closeFrame = await closePromise;
    expect((closeFrame.payload as Record<string, unknown>).reason).toBe(
      "invalid_hello",
    );
    await closed;
  });

  it("closes the socket on an unhandled reserved frame after handshake", async () => {
    const { enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    const ws = await connect(body.agentToken);
    const ok = nextMessage(ws, "hello.ok");
    await sendHello(ws);
    await ok;

    const errPromise = nextMessage(ws, "error");
    const closed = new Promise<number>((r) =>
      ws.on("close", (code) => r(code)),
    );
    ws.send(JSON.stringify({ type: "job.assign", payload: { jobId: "x" } }));
    const err = await errPromise;
    expect((err.payload as Record<string, unknown>).code).toBe(
      "UNSUPPORTED_FRAME",
    );
    const code = await closed;
    expect(code).toBe(1008);
  });

  it("reconciles orphaned sessions and CONNECTED status on startup", async () => {
    const { agent, enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    const ws = await connect(body.agentToken);
    const ok = nextMessage(ws, "hello.ok");
    await sendHello(ws);
    await ok;

    // Simulate a hard crash: leave the session row open and the agent
    // CONNECTED with no live socket tracked (fresh service = empty map).
    const { AgentSessionService } =
      await import("../../src/services/agent-session-service.js");
    const fresh = new AgentSessionService({ warn: () => {}, info: () => {} });
    await fresh.reconcileOrphans();

    const row = await agentRow(agent.id);
    expect(row.status).toBe("OFFLINE");
    const sessions = await testDb!.db
      .selectFrom("agent_sessions")
      .selectAll()
      .where("agentId", "=", agent.id)
      .execute();
    expect(sessions[0]!.disconnectReason).toBe("shutdown");
    expect(sessions[0]!.disconnectedAt).not.toBeNull();
    ws.close();
  });
});
