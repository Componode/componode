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

// Capability drift (spec 027 US6): allowedImporters edits and revocation
// flag bound configs read-time and the next run fails fast — dispatch-time
// re-validation is the gate, not save-time persistence.
describe("config drift", () => {
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
    setEnv("AGENT_DISPATCH_TIMEOUT_MS", "30000");
    setEnv("AGENT_JOB_ACK_TIMEOUT_MS", "2000");
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

  function authed(payload?: Record<string, unknown>) {
    return {
      cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
      headers: csrfHeader,
      ...(payload ? { payload } : {}),
    };
  }

  async function createAgent(name: string, allowedImporters?: string[]) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      ...authed({ name, ...(allowedImporters ? { allowedImporters } : {}) }),
    });
    expect(res.statusCode).toBe(201);
    return res.json() as {
      agent: { id: string; name: string };
      enrollment: { token: string };
    };
  }

  const inboxes = new WeakMap<WebSocket, Record<string, unknown>[]>();

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

    const inbox: Record<string, unknown>[] = [];
    inboxes.set(ws, inbox);
    ws.on("message", (data) => inbox.push(JSON.parse(data.toString())));

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
          capabilities: { maxConcurrentJobs: 2 },
        },
      }),
    );
    await ok;
    const beat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "heartbeat",
            payload: { currentJobs: 0, maxConcurrentJobs: 2, activeRunIds: [] },
          }),
        );
      } else {
        clearInterval(beat);
      }
    }, 1000);
    ws.on("close", () => clearInterval(beat));
    return ws;
  }

  async function onFrame(
    ws: WebSocket,
    type: string,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>> {
    const inbox = inboxes.get(ws)!;
    const start = Date.now();
    for (;;) {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return inbox.splice(i, 1)[0]!;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timeout waiting for ${type}`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  function sendFrame(ws: WebSocket, type: string, runId: string, payload: unknown) {
    ws.send(JSON.stringify({ type, runId, payload }));
  }

  async function bindConfig(agentId: string) {
    const now = new Date().toISOString();
    const configId = randomUUID();
    await testDb!.db
      .insertInto("importer_configs")
      .values({
        id: configId,
        label: "bound",
        importerName: "github",
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
    // github's manifest requires a `token` secret — link an agent-managed
    // credential covering it so the dispatch gate passes.
    const credId = randomUUID();
    await testDb!.db
      .insertInto("credentials")
      .values({
        id: credId,
        slug: `cred-${credId.slice(0, 8)}`,
        label: "bound token",
        status: "ACTIVE",
        kind: "AGENT_MANAGED",
        secretRefMap: { token: { env: "GITHUB_TOKEN" } },
        keyVersion: 1,
        keyHints: {},
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await testDb!.db
      .insertInto("importer_config_credentials")
      .values({ configId, credentialId: credId, createdAt: now })
      .execute();
    return configId;
  }

  async function trigger(configId: string) {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${configId}/trigger`,
      ...authed(),
    });
    expect(res.statusCode).toBe(202);
    return res.json().runId as string;
  }

  async function getConfig(configId: string) {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}`,
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    return res.json().config;
  }

  async function waitForStatus(runId: string, status: string, timeoutMs = 6000) {
    const start = Date.now();
    for (;;) {
      const run = await testDb!.db
        .selectFrom("import_runs")
        .selectAll()
        .where("id", "=", runId)
        .executeTakeFirstOrThrow();
      if (run.status === status) return run;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`run ${runId} still ${run.status}, expected ${status}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it("narrowing allowedImporters post-binding flags the config and the next run fails fast AGENT_INCOMPATIBLE", async () => {
    const { agent, enrollment } = await createAgent("edge-drift", ["github"]);
    const ws = await connectAgent(enrollment.token);
    const configId = await bindConfig(agent.id);

    expect((await getConfig(configId)).agentIncompatible).toBe(false);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/agents/${agent.id}`,
      ...authed({ allowedImporters: ["kubernetes"] }),
    });
    expect(patch.statusCode).toBe(200);

    const config = await getConfig(configId);
    expect(config.agentIncompatible).toBe(true);

    // The agent is connected, yet the run fails at the dispatch gate —
    // no job.assign reaches the wire.
    const runId = await trigger(configId);
    const run = await waitForStatus(runId, "FAILED");
    expect(run.errorType).toBe("AGENT_INCOMPATIBLE");
    expect(run.errorMessage).toContain("github");
    expect(inboxes.get(ws)!.filter((m) => m.type === "job.assign")).toHaveLength(0);
    ws.close();
  });

  it("an in-flight run is unaffected by a mid-flight policy edit", async () => {
    const { agent, enrollment } = await createAgent("edge-midflight", ["github"]);
    const ws = await connectAgent(enrollment.token);
    const configId = await bindConfig(agent.id);

    const runId = await trigger(configId);
    await onFrame(ws, "job.assign");
    sendFrame(ws, "job.ack", runId, { accepted: true });
    await waitForStatus(runId, "RUNNING");

    // Narrow the policy mid-flight — the running job finishes normally.
    await app.inject({
      method: "PATCH",
      url: `/api/v1/agents/${agent.id}`,
      ...authed({ allowedImporters: ["kubernetes"] }),
    });

    sendFrame(ws, "run.complete", runId, { result: "COMPLETED" });
    const run = await waitForStatus(runId, "COMPLETED");
    expect(run.errorType).toBeNull();
    ws.close();
  });

  it("revoked agent's bound config run fails fast AGENT_UNAVAILABLE — no dispatch wait", async () => {
    const { agent } = await createAgent("edge-revoked");
    const configId = await bindConfig(agent.id);

    const revoke = await app.inject({
      method: "POST",
      url: `/api/v1/agents/${agent.id}/revoke`,
      ...authed(),
    });
    expect(revoke.statusCode).toBe(200);

    const runId = await trigger(configId);
    const run = await waitForStatus(runId, "FAILED", 4000);
    expect(run.errorType).toBe("AGENT_UNAVAILABLE");
  });
});
