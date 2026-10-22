import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
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

// Remote credential test (spec 026 US3): POST /credentials/:id/test on an
// AGENT_MANAGED credential dispatches credential.test over the agent stream
// and returns the agent's result. Fake agent = real ws client, same pattern
// as agent-channel.test.ts.
describe("remote credential test", () => {
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
    setEnv("AGENT_STALE_AFTER_MS", "3000");
    setEnv("AGENT_SESSION_SWEEP_MS", "500");
    setEnv("AGENT_HELLO_TIMEOUT_MS", "2000");
    // Short window so the timeout path is exercisable in-test.
    setEnv("AGENT_CREDENTIAL_TEST_TIMEOUT_MS", "800");
    vi.resetModules();

    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
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

  function authed(payload: Record<string, unknown>) {
    return {
      cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
      headers: csrfHeader,
      payload,
    };
  }

  async function createAgent(name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as {
      agent: { id: string; name: string };
      enrollment: { token: string };
    };
  }

  async function connectAgent(enrollmentToken: string): Promise<WebSocket> {
    const res = await fetch(`${baseUrl}/api/v1/agent/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: enrollmentToken }),
    });
    const { agentToken } = await res.json();

    const { getManifests } = await import("../../src/services/importer-registry.js");
    const importers = (await getManifests()).map((m) => ({
      name: m.name,
      version: m.version,
    }));

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(
        `${baseUrl.replace("http://", "ws://")}/api/v1/agent/stream`,
        { headers: { authorization: `Bearer ${agentToken}` } },
      );
      socket.on("open", () => resolve(socket));
      socket.on("error", reject);
    });

    const ok = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("hello.ok timeout")), 3000);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "hello.ok") {
          clearTimeout(timer);
          resolve(msg);
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
    await ok;
    return ws;
  }

  function onFrame(
    ws: WebSocket,
    type: string,
    timeoutMs = 4000,
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

  async function createAgentManagedCredential(
    label = "Agent GH",
    secretRefMap: Record<string, unknown> = { token: { env: "GH_TOKEN" } },
  ) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed({ kind: "AGENT_MANAGED", label, secretRefMap }),
    });
    expect(res.statusCode).toBe(201);
    return res.json().credential;
  }

  async function bindConfig(
    credentialIds: string | string[],
    agentId: string,
    importerName = "github",
  ) {
    const now = new Date().toISOString();
    const configId = randomUUID();
    await testDb!.db
      .insertInto("importer_configs")
      .values({
        id: configId,
        label: "bound",
        importerName,
        scope: { org: "acme" },
        secretRefs: null,
        schedule: null,
        enabled: true,
        agentId,
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    for (const credentialId of [credentialIds].flat()) {
      await testDb!.db
        .insertInto("importer_config_credentials")
        .values({ configId, credentialId })
        .execute();
    }
    return configId;
  }

  function postTest(credentialId: string, importerName = "github") {
    return app.inject({
      method: "POST",
      url: `/api/v1/credentials/${credentialId}/test`,
      ...authed({ importerName }),
    });
  }

  it("dispatches credential.test and returns the agent's result", async () => {
    const { agent, enrollment } = await createAgent("edge-1");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    await bindConfig(cred.id, agent.id);

    const request = postTest(cred.id);
    const frame = await onFrame(ws, "credential.test");
    const payload = frame.payload as Record<string, unknown>;
    expect(payload.credentialId).toBe(cred.id);
    expect(payload.importerName).toBe("github");
    // The frame carries references — never values.
    expect(payload.secretRefMap).toEqual({ token: { env: "GH_TOKEN" } });
    expect(JSON.stringify(frame)).not.toMatch(/ghp_|secret-value/i);

    ws.send(
      JSON.stringify({
        type: "credential.test.result",
        payload: { testId: payload.testId, ok: true },
      }),
    );

    const res = await request;
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.agent).toBe("edge-1");

    // Audit: dispatch recorded on the agent, test recorded on the credential.
    const agentAudit = await testDb!.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityType", "=", "import_agent")
      .where("entityId", "=", agent.id)
      .where("action", "=", "credential_test_dispatched")
      .execute();
    expect(agentAudit).toHaveLength(1);

    const credAudit = await testDb!.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityType", "=", "credential")
      .where("entityId", "=", cred.id)
      .where("action", "=", "tested")
      .execute();
    expect(credAudit).toHaveLength(1);
    expect(JSON.stringify(credAudit[0]!.changes)).toContain("edge-1");

    const credRow = await testDb!.db
      .selectFrom("credentials")
      .select("lastUsedAt")
      .where("id", "=", cred.id)
      .executeTakeFirstOrThrow();
    expect(credRow.lastUsedAt).not.toBeNull();
    ws.close();
  });

  it("returns the agent's error in the result", async () => {
    const { agent, enrollment } = await createAgent("edge-err");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    await bindConfig(cred.id, agent.id);

    const request = postTest(cred.id);
    const frame = await onFrame(ws, "credential.test");
    const testId = (frame.payload as Record<string, unknown>).testId;
    ws.send(
      JSON.stringify({
        type: "credential.test.result",
        payload: { testId, ok: false, error: "env GH_TOKEN not set" },
      }),
    );
    const res = await request;
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(res.json().error).toBe("env GH_TOKEN not set");
    expect(res.json().agent).toBe("edge-err");
    ws.close();
  });

  it("400s CREDENTIAL_NO_BOUND_AGENT when no agent-bound config references the credential", async () => {
    const cred = await createAgentManagedCredential();
    const res = await postTest(cred.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_NO_BOUND_AGENT");
  });

  it("does not count a bound config for a different importer", async () => {
    const { agent } = await createAgent("edge-other");
    const cred = await createAgentManagedCredential();
    await bindConfig(cred.id, agent.id, "kubernetes");

    const res = await postTest(cred.id, "github");
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_NO_BOUND_AGENT");
  });

  it("503s AGENT_OFFLINE when the bound agent has no session", async () => {
    const { agent } = await createAgent("edge-offline");
    const cred = await createAgentManagedCredential();
    await bindConfig(cred.id, agent.id);

    const res = await postTest(cred.id);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("AGENT_OFFLINE");
  });

  it("504s AGENT_TEST_TIMEOUT when the agent never answers — audit still recorded (FR-018)", async () => {
    const { agent, enrollment } = await createAgent("edge-silent");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    await bindConfig(cred.id, agent.id);

    const res = await postTest(cred.id);
    expect(res.statusCode).toBe(504);
    expect(res.json().code).toBe("AGENT_TEST_TIMEOUT");

    // The frame WAS sent: dispatch audit + lastUsedAt + a failed tested
    // outcome must exist even though no result ever arrived.
    const dispatchAudit = await testDb!.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityType", "=", "import_agent")
      .where("entityId", "=", agent.id)
      .where("action", "=", "credential_test_dispatched")
      .execute();
    expect(dispatchAudit).toHaveLength(1);

    const tested = await testDb!.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityType", "=", "credential")
      .where("entityId", "=", cred.id)
      .where("action", "=", "tested")
      .execute();
    expect(tested).toHaveLength(1);
    expect(JSON.stringify(tested[0]!.changes)).toContain("AGENT_TEST_TIMEOUT");

    const credRow = await testDb!.db
      .selectFrom("credentials")
      .select("lastUsedAt")
      .where("id", "=", cred.id)
      .executeTakeFirstOrThrow();
    expect(credRow.lastUsedAt).not.toBeNull();
    ws.close();
  });

  it("fails the request (not hangs) when the agent disconnects mid-test — audits the dispatch", async () => {
    const { agent, enrollment } = await createAgent("edge-flaky");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    await bindConfig(cred.id, agent.id);

    const request = postTest(cred.id);
    await onFrame(ws, "credential.test");
    ws.terminate();

    const res = await request;
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("AGENT_OFFLINE");

    const dispatchAudit = await testDb!.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityType", "=", "import_agent")
      .where("entityId", "=", agent.id)
      .where("action", "=", "credential_test_dispatched")
      .execute();
    expect(dispatchAudit).toHaveLength(1);

    const tested = await testDb!.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityType", "=", "credential")
      .where("entityId", "=", cred.id)
      .where("action", "=", "tested")
      .execute();
    expect(tested).toHaveLength(1);
    expect(JSON.stringify(tested[0]!.changes)).toContain("AGENT_OFFLINE");
  });

  it("ignores credential.test.result frames with an unknown testId", async () => {
    const { agent, enrollment } = await createAgent("edge-unknown");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    await bindConfig(cred.id, agent.id);

    // Bogus testId must not break the session or settle a pending test.
    ws.send(
      JSON.stringify({
        type: "credential.test.result",
        payload: { testId: randomUUID(), ok: true },
      }),
    );

    const request = postTest(cred.id);
    const frame = await onFrame(ws, "credential.test");
    const testId = (frame.payload as Record<string, unknown>).testId;
    ws.send(
      JSON.stringify({
        type: "credential.test.result",
        payload: { testId, ok: true },
      }),
    );
    const res = await request;
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    ws.close();
  });

  it("400s CREDENTIAL_MISSING_KEY naming the dropped required key (spec edge case)", async () => {
    const { agent, enrollment } = await createAgent("edge-coverage");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    await bindConfig(cred.id, agent.id);

    // Edit the ref map in place to drop the importer's required `token`
    // key — the edit succeeds (no dependent re-validation), but the next
    // test must fail naming the missing key.
    const edit = await app.inject({
      method: "PATCH",
      url: `/api/v1/credentials/${cred.id}`,
      ...authed({ secretRefMap: { other: { env: "GH_TOKEN" } } }),
    });
    expect(edit.statusCode).toBe(200);

    const res = await postTest(cred.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_MISSING_KEY");
    expect(res.json().message).toContain('"token"');
    ws.close();
  });

  it("tries the next bound config when an earlier one lacks coverage (US3.5)", async () => {
    const { agent, enrollment } = await createAgent("edge-cover-order");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    const cred2 = await createAgentManagedCredential("Agent GH 2");
    // Config A references only `cred`; config B references cred + cred2.
    await bindConfig(cred.id, agent.id);
    await bindConfig([cred.id, cred2.id], agent.id);

    // Drop `token` from cred's map — config A's coverage breaks; B's holds.
    const edit = await app.inject({
      method: "PATCH",
      url: `/api/v1/credentials/${cred.id}`,
      ...authed({ secretRefMap: { other: { env: "GH_TOKEN" } } }),
    });
    expect(edit.statusCode).toBe(200);

    // The covered config still probes: whichever candidate is tried first,
    // the outcome is the same.
    const request = postTest(cred.id);
    const frame = await onFrame(ws, "credential.test");
    const testId = (frame.payload as Record<string, unknown>).testId;
    ws.send(
      JSON.stringify({
        type: "credential.test.result",
        payload: { testId, ok: true },
      }),
    );
    const res = await request;
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    ws.close();
  });

  it("picks a connected agent when multiple agents are bound", async () => {
    const offline = await createAgent("edge-multi-offline");
    const online = await createAgent("edge-multi-online");
    const ws = await connectAgent(online.enrollment.token);
    const cred = await createAgentManagedCredential();
    await bindConfig(cred.id, offline.agent.id);
    await bindConfig(cred.id, online.agent.id);

    const request = postTest(cred.id);
    const frame = await onFrame(ws, "credential.test");
    const testId = (frame.payload as Record<string, unknown>).testId;
    ws.send(
      JSON.stringify({
        type: "credential.test.result",
        payload: { testId, ok: true },
      }),
    );
    const res = await request;
    expect(res.statusCode).toBe(200);
    expect(res.json().agent).toBe("edge-multi-online");
    ws.close();
  });
});
