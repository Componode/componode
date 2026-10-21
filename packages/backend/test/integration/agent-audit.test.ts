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

// Agent audit + connection history (spec 025 US4): lifecycle events land in
// entity_changes with the right actors; rejected traffic writes nothing.
describe("agent audit + sessions", () => {
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
    return JSON.parse(res.payload);
  }

  async function enroll(token: string) {
    const res = await fetch(`${baseUrl}/api/v1/agent/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return { status: res.status, body: await res.json() };
  }

  async function connectAndClose(credential: string) {
    const { getManifests } =
      await import("../../src/services/importer-registry.js");
    const importers = (await getManifests()).map((m) => ({
      name: m.name,
      version: m.version,
    }));
    const ws = new WebSocket(
      `${baseUrl.replace("http", "ws")}/api/v1/agent/stream`,
      {
        headers: { authorization: `Bearer ${credential}` },
      },
    );
    await new Promise<void>((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) =>
        reject(
          Object.assign(new Error("rejected"), { statusCode: res.statusCode }),
        ),
      );
    });
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
          capabilities: { maxConcurrentJobs: 2 },
        },
      }),
    );
    await okPromise;
    ws.close();
    await new Promise((r) => ws.on("close", r));
    // Give the hub a beat to persist the close.
    await new Promise((r) => setTimeout(r, 300));
  }

  it("records every lifecycle action in entity_changes with correct actors", async () => {
    const { agent, enrollment } = await createAgent();
    await enroll(enrollment.token);
    await app.inject(
      authed({ method: "POST", url: `/api/v1/agents/${agent.id}/enroll` }),
    );
    await app.inject(
      authed({ method: "POST", url: `/api/v1/agents/${agent.id}/revoke` }),
    );
    await app.inject(
      authed({ method: "DELETE", url: `/api/v1/agents/${agent.id}` }),
    );

    const rows = await testDb!.db
      .selectFrom("entity_changes")
      .select(["action", "entityType", "createdBy", "createdByName"])
      .where("entityId", "=", agent.id)
      .execute();

    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual([
      "created",
      "deleted",
      "enrolled",
      "revoked",
      "token_rotated",
    ]);
    expect(rows.every((r) => r.entityType === "import_agent")).toBe(true);

    const enrolled = rows.find((r) => r.action === "enrolled")!;
    expect(enrolled.createdBy).toBeNull();
    expect(enrolled.createdByName).toBe("agent:edge-agent");

    const adminActions = rows.filter((r) => r.action !== "enrolled");
    expect(adminActions.every((r) => r.createdBy !== null)).toBe(true);
  });

  it("records an 'updated' audit entry on PATCH (policy fields are audited)", async () => {
    const { agent } = await createAgent();
    const res = await app.inject(
      authed({
        method: "PATCH",
        url: `/api/v1/agents/${agent.id}`,
        payload: { allowedImporters: ["github"] },
      }),
    );
    expect(res.statusCode).toBe(200);

    const rows = await testDb!.db
      .selectFrom("entity_changes")
      .select(["action", "changes"])
      .where("entityId", "=", agent.id)
      .where("action", "=", "updated")
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changes).toMatchObject({ allowedImporters: ["github"] });
  });

  it("lists sessions newest-first with address and versions", async () => {
    const { agent, enrollment } = await createAgent();
    const { body } = await enroll(enrollment.token);
    await connectAndClose(body.agentToken);
    await connectAndClose(body.agentToken);

    const res = await app.inject(
      authed({
        method: "GET",
        url: `/api/v1/agents/${agent.id}/sessions`,
      }),
    );
    expect(res.statusCode).toBe(200);
    const { sessions } = JSON.parse(res.payload);
    expect(sessions).toHaveLength(2);
    expect(new Date(sessions[0].connectedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(sessions[1].connectedAt).getTime(),
    );
    expect(sessions[0].disconnectReason).toBe("client_close");
    expect(sessions[0].remoteAddress).toBeTruthy();
    expect(sessions[0].agentVersion).toBe("1.0.0");
    expect(sessions[0].protocolVersion).toBe(AGENT_PROTOCOL_VERSION);
  });

  it("rejects a malformed ?limit with 400, not a 500", async () => {
    const { agent } = await createAgent();
    const res = await app.inject(
      authed({
        method: "GET",
        url: `/api/v1/agents/${agent.id}/sessions?limit=abc`,
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).code).toBe("VALIDATION_FAILED");
  });

  it("returns 404 for sessions of a missing agent", async () => {
    const res = await app.inject(
      authed({
        method: "GET",
        url: "/api/v1/agents/00000000-0000-7000-8000-000000000000/sessions",
      }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("leaves zero audit rows for rejected enroll/upgrade attempts", async () => {
    const { agent, enrollment } = await createAgent();
    await enroll(enrollment.token);
    const before = await testDb!.db
      .selectFrom("entity_changes")
      .select("id")
      .where("entityId", "=", agent.id)
      .execute();

    await enroll("not-a-token");
    await enroll(enrollment.token); // already used
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(
        `${baseUrl.replace("http", "ws")}/api/v1/agent/stream`,
        {
          headers: { authorization: "Bearer bogus" },
        },
      );
      ws.on("unexpected-response", () => resolve());
      ws.on("error", () => resolve());
    });

    const after = await testDb!.db
      .selectFrom("entity_changes")
      .select("id")
      .where("entityId", "=", agent.id)
      .execute();
    expect(after).toHaveLength(before.length);
  });
});
