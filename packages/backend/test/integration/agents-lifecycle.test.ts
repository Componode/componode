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

// Agent lifecycle (spec 025 US3): rotate (overlap + revoked reset), revoke
// (drop live session), delete (blocked when bound; cascades sessions).
describe("agent lifecycle", () => {
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
    setEnv("AGENT_STALE_AFTER_MS", "30000");
    vi.resetModules();
    vi.clearAllMocks();

    const { bootstrapAdmin } =
      await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${app.server.address().port}`;

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

  function authed(overrides: Record<string, unknown> = {}) {
    return {
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      ...overrides,
    };
  }

  async function createAgent(name = "edge-agent") {
    const res = await app.inject(
      authed({
        method: "POST",
        url: "/api/v1/agents",
        payload: { name },
      }),
    );
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.payload) as {
      agent: { id: string; name: string };
      enrollment: { token: string };
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

  async function connect(credential: string): Promise<WebSocket> {
    const ws = new WebSocket(
      `${baseUrl.replace("http", "ws")}/api/v1/agent/stream`,
      {
        headers: { authorization: `Bearer ${credential}` },
      },
    );
    // Attach listeners before any other await — 'open' can fire while a
    // dynamic import resolves.
    const opened = new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) =>
        reject(
          Object.assign(new Error("rejected"), { statusCode: res.statusCode }),
        ),
      );
    });
    const { getManifests } =
      await import("../../src/services/importer-registry.js");
    const importers = (await getManifests()).map((m) => ({
      name: m.name,
      version: m.version,
    }));
    await opened;
    const okPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("hello.ok timeout")),
        3000,
      );
      ws.on("message", (data) => {
        if (JSON.parse(data.toString()).type === "hello.ok") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
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
    await okPromise;
    return ws;
  }

  it("rotates a revoked agent: clears revokedAt and issues a fresh token", async () => {
    const { agent, enrollment } = await createAgent();
    await enroll(enrollment.token);

    let res = await app.inject(
      authed({ method: "POST", url: `/api/v1/agents/${agent.id}/revoke` }),
    );
    expect(res.statusCode).toBe(200);
    let row = await testDb!.db
      .selectFrom("import_agents")
      .selectAll()
      .where("id", "=", agent.id)
      .executeTakeFirstOrThrow();
    expect(row.revokedAt).not.toBeNull();

    res = await app.inject(
      authed({ method: "POST", url: `/api/v1/agents/${agent.id}/enroll` }),
    );
    expect(res.statusCode).toBe(200);
    const rotated = JSON.parse(res.payload);
    expect(rotated.enrollment.token).not.toBe(enrollment.token);

    row = await testDb!.db
      .selectFrom("import_agents")
      .selectAll()
      .where("id", "=", agent.id)
      .executeTakeFirstOrThrow();
    expect(row.revokedAt).toBeNull(); // rotation re-enables (spec clarification)

    const audit = await testDb!.db
      .selectFrom("entity_changes")
      .select("action")
      .where("entityId", "=", agent.id)
      .execute();
    expect(audit.map((a) => a.action)).toContain("token_rotated");
  });

  it("exchanging a rotated token kills the old credential and supersedes its session", async () => {
    const { agent, enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    const oldCredential = body.agentToken as string;
    const ws = await connect(oldCredential);
    const oldClosed = new Promise<void>((r) => ws.on("close", () => r()));

    const res = await app.inject(
      authed({ method: "POST", url: `/api/v1/agents/${agent.id}/enroll` }),
    );
    const rotatedToken = JSON.parse(res.payload).enrollment.token as string;

    const exchanged = await enroll(rotatedToken);
    expect(exchanged.status).toBe(200);

    // Old session dropped `replaced` (its credential was superseded by the
    // rotation exchange); old credential can no longer connect.
    await oldClosed;
    await expect(connect(oldCredential)).rejects.toMatchObject({
      statusCode: 401,
    });

    const sessions = await testDb!.db
      .selectFrom("agent_sessions")
      .selectAll()
      .where("agentId", "=", agent.id)
      .execute();
    expect(sessions.every((s) => s.disconnectedAt !== null)).toBe(true);
    expect(sessions[0]!.disconnectReason).toBe("replaced");
  });

  it("keeps the old credential working during the rotation overlap window", async () => {
    const { agent, enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    const oldCredential = body.agentToken as string;

    const res = await app.inject(
      authed({ method: "POST", url: `/api/v1/agents/${agent.id}/enroll` }),
    );
    expect(res.statusCode).toBe(200);

    // Old credential still connects during overlap.
    const ws = await connect(oldCredential);
    ws.close();
  });

  it("revokes: live session dropped, reconnects rejected", async () => {
    const { agent, enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    const ws = await connect(body.agentToken);
    const closed = new Promise<number>((r) => ws.on("close", (c) => r(c)));

    const res = await app.inject(
      authed({ method: "POST", url: `/api/v1/agents/${agent.id}/revoke` }),
    );
    expect(res.statusCode).toBe(200);
    await closed;

    await expect(connect(body.agentToken)).rejects.toMatchObject({
      statusCode: 401,
    });

    const sessions = await testDb!.db
      .selectFrom("agent_sessions")
      .selectAll()
      .where("agentId", "=", agent.id)
      .execute();
    expect(sessions[0]!.disconnectReason).toBe("revoked");
  });

  it("deletes an unbound agent and cascades session history", async () => {
    const { agent, enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    const ws = await connect(body.agentToken);
    ws.close();
    await new Promise((r) => setTimeout(r, 300));

    const res = await app.inject(
      authed({ method: "DELETE", url: `/api/v1/agents/${agent.id}` }),
    );
    expect(res.statusCode).toBe(204);

    const agentRow = await testDb!.db
      .selectFrom("import_agents")
      .selectAll()
      .where("id", "=", agent.id)
      .executeTakeFirst();
    expect(agentRow).toBeUndefined();

    const sessions = await testDb!.db
      .selectFrom("agent_sessions")
      .selectAll()
      .where("agentId", "=", agent.id)
      .execute();
    expect(sessions).toHaveLength(0); // cascade (spec clarification)

    const audit = await testDb!.db
      .selectFrom("entity_changes")
      .select("action")
      .where("entityId", "=", agent.id)
      .execute();
    expect(audit.map((a) => a.action)).toContain("deleted");
  });

  it("blocks delete while an importer config is bound", async () => {
    const { agent } = await createAgent();
    // Bind a config directly (027 will expose the binding UI).
    const { uuidv7 } = await import("uuidv7");
    const configId = uuidv7();
    await testDb!.db
      .insertInto("importer_configs")
      .values({
        id: configId,
        importerName: "github",
        label: "test cfg",
        scope: {},
        agentId: agent.id,
      } as never)
      .execute();

    const res = await app.inject(
      authed({ method: "DELETE", url: `/api/v1/agents/${agent.id}` }),
    );
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload).code).toBe("AGENT_IN_USE");
  });

  it("patches name and allowedImporters", async () => {
    const { agent } = await createAgent();
    const res = await app.inject(
      authed({
        method: "PATCH",
        url: `/api/v1/agents/${agent.id}`,
        payload: { name: "renamed-agent", allowedImporters: ["github"] },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.agent.name).toBe("renamed-agent");
    expect(body.agent.allowedImporters).toEqual(["github"]);
  });

  it("rejects a name conflict and unknown importers on update", async () => {
    await createAgent("first-agent");
    const { agent: second } = await createAgent("second-agent");

    let res = await app.inject(
      authed({
        method: "PATCH",
        url: `/api/v1/agents/${second.id}`,
        payload: { name: "first-agent" },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload).code).toBe("AGENT_NAME_TAKEN");

    res = await app.inject(
      authed({
        method: "PATCH",
        url: `/api/v1/agents/${second.id}`,
        payload: { allowedImporters: ["nonexistent"] },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).code).toBe("VALIDATION_FAILED");
  });
});
