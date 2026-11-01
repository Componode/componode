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

// Executor visibility (spec 027 US5): bound configs, run history, in-flight
// jobs and the dashboard OFFLINE_AGENT attention item are all answerable
// from API surfaces.
describe("agent run/config surfaces", () => {
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
            payload: { currentJobs: 1, maxConcurrentJobs: 2, activeRunIds: [] },
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

  async function bindConfig(agentId: string, label = "bound") {
    const now = new Date().toISOString();
    const configId = randomUUID();
    await testDb!.db
      .insertInto("importer_configs")
      .values({
        id: configId,
        label,
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

  it("GET /agents/:id/configs lists bound configs with agentIncompatible", async () => {
    const { agent } = await createAgent("edge-cfgs", ["kubernetes"]);
    const configId = await bindConfig(agent.id, "my-config");

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/agents/${agent.id}/configs`,
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const configs = res.json().configs;
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe(configId);
    expect(configs[0].label).toBe("my-config");
    // github is outside the narrowed policy → flagged.
    expect(configs[0].agentIncompatible).toBe(true);
  });

  it("GET /agents/:id/runs lists the agent's run history", async () => {
    const { agent, enrollment } = await createAgent("edge-history");
    const ws = await connectAgent(enrollment.token);
    const configId = await bindConfig(agent.id);
    const runId = await trigger(configId);
    await onFrame(ws, "job.assign");
    sendFrame(ws, "job.ack", runId, { accepted: true });
    sendFrame(ws, "source.identity", runId, { externalIdentity: "test-src" });
    sendFrame(ws, "run.complete", runId, { result: "COMPLETED" });

    const deadline = Date.now() + 5000;
    for (;;) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/agents/${agent.id}/runs`,
        ...authed(),
      });
      expect(res.statusCode).toBe(200);
      const runs = res.json().runs;
      if (runs.length === 1 && runs[0].status === "COMPLETED") {
        expect(runs[0].id).toBe(runId);
        expect(runs[0].configId).toBe(configId);
        expect(runs[0].configLabel).toBe("bound");
        return;
      }
      if (Date.now() > deadline) throw new Error("run history not populated");
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  it("GET /agents/:id exposes activeRuns; GET /agents exposes runningJobs", async () => {
    const { agent, enrollment } = await createAgent("edge-inflight");
    const ws = await connectAgent(enrollment.token);
    const configId = await bindConfig(agent.id);
    const runId = await trigger(configId);
    await onFrame(ws, "job.assign");
    sendFrame(ws, "job.ack", runId, { accepted: true });
    sendFrame(ws, "source.identity", runId, { externalIdentity: "test-src" });
    sendFrame(ws, "phase", runId, { name: "Fetching" });
    await new Promise((r) => setTimeout(r, 300));

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/agents/${agent.id}`,
      ...authed(),
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json().agent;
    expect(body.runningJobs).toBe(1);
    expect(body.activeRuns).toHaveLength(1);
    expect(body.activeRuns[0]).toMatchObject({
      runId,
      configId,
      state: "RUNNING",
      phase: "Fetching",
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/agents",
      ...authed(),
    });
    const row = list.json().agents.find((a: { id: string }) => a.id === agent.id);
    expect(row.runningJobs).toBe(1);

    sendFrame(ws, "run.complete", runId, { result: "COMPLETED" });
    ws.close();
  });

  it("dashboard attention gains OFFLINE_AGENT for an offline agent with bound configs", async () => {
    const { agent } = await createAgent("edge-offline-bound");
    await bindConfig(agent.id);
    await testDb!.db
      .updateTable("import_agents")
      .set({ status: "OFFLINE" })
      .where("id", "=", agent.id)
      .execute();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/summary",
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().attention as Array<Record<string, unknown>>;
    const item = items.find((i) => i.kind === "OFFLINE_AGENT");
    expect(item).toBeDefined();
    expect(item!.label).toBe("edge-offline-bound");
    expect(item!.href).toBe(`/agents/${agent.id}`);
  });

  it("no OFFLINE_AGENT item for an offline agent with zero bound configs", async () => {
    const { agent } = await createAgent("edge-offline-free");
    await testDb!.db
      .updateTable("import_agents")
      .set({ status: "OFFLINE" })
      .where("id", "=", agent.id)
      .execute();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/summary",
      ...authed(),
    });
    const items = res.json().attention as Array<Record<string, unknown>>;
    expect(items.filter((i) => i.kind === "OFFLINE_AGENT")).toHaveLength(0);
  });
});
