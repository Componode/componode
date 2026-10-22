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

// Remote failure matrix (spec 027 US3): every failure mode lands on a
// named terminal state in bounded time — nothing hangs.
describe("remote run failures", () => {
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
    // Shrunk so both timeout paths are exercisable in-test.
    setEnv("AGENT_DISPATCH_TIMEOUT_MS", "1200");
    setEnv("AGENT_JOB_ACK_TIMEOUT_MS", "800");
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

  async function createAgent(name: string, allowedImporters?: string[]) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name, ...(allowedImporters ? { allowedImporters } : {}) },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as {
      agent: { id: string; name: string };
      enrollment: { token: string };
    };
  }

  const inboxes = new WeakMap<WebSocket, Record<string, unknown>[]>();

  async function connectAgent(
    enrollmentToken: string,
    maxConcurrentJobs = 1,
  ): Promise<WebSocket> {
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
          capabilities: { maxConcurrentJobs },
        },
      }),
    );
    await ok;
    const beat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "heartbeat",
            payload: { currentJobs: 0, maxConcurrentJobs, activeRunIds: [] },
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

  async function createAgentManagedCredential() {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed({
        kind: "AGENT_MANAGED",
        label: "Agent GH",
        secretRefMap: { token: { env: "GH_TOKEN" } },
      }),
    });
    expect(res.statusCode).toBe(201);
    return res.json().credential;
  }

  async function bindConfig(agentId: string, credentialIds: string | string[] = []) {
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
    for (const credentialId of [credentialIds].flat()) {
      await testDb!.db
        .insertInto("importer_config_credentials")
        .values({ configId, credentialId })
        .execute();
    }
    return configId;
  }

  async function trigger(configId: string) {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${configId}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(res.statusCode).toBe(202);
    return res.json().runId as string;
  }

  async function getRunRow(runId: string) {
    return testDb!.db
      .selectFrom("import_runs")
      .selectAll()
      .where("id", "=", runId)
      .executeTakeFirstOrThrow();
  }

  async function waitForTerminal(runId: string, timeoutMs = 6000) {
    const start = Date.now();
    for (;;) {
      const run = await getRunRow(runId);
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) return run;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`run ${runId} still ${run.status}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it("offline agent → FAILED/AGENT_UNAVAILABLE after the dispatch deadline", async () => {
    const { agent } = await createAgent("edge-never");
    const cred = await createAgentManagedCredential();
    const configId = await bindConfig(agent.id, cred.id);

    const runId = await trigger(configId);
    const run = await waitForTerminal(runId);
    expect(run.status).toBe("FAILED");
    expect(run.errorType).toBe("AGENT_UNAVAILABLE");
  });

  it("agent NACK → FAILED/AGENT_INCOMPATIBLE with the echoed reason", async () => {
    const { agent, enrollment } = await createAgent("edge-nack");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    const configId = await bindConfig(agent.id, cred.id);

    const runId = await trigger(configId);
    await onFrame(ws, "job.assign");
    sendFrame(ws, "job.ack", runId, {
      accepted: false,
      reason: 'AGENT_INCOMPATIBLE: importer "github" is not compiled into this agent',
    });
    const run = await waitForTerminal(runId);
    expect(run.status).toBe("FAILED");
    expect(run.errorType).toBe("AGENT_INCOMPATIBLE");
    expect(run.errorMessage).toContain("github");
    ws.close();
  });

  it("SECRET_RESOLUTION_FAILED NACK → FAILED with that type, not AGENT_INCOMPATIBLE", async () => {
    const { agent, enrollment } = await createAgent("edge-nosecret");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    const configId = await bindConfig(agent.id, cred.id);

    const runId = await trigger(configId);
    await onFrame(ws, "job.assign");
    sendFrame(ws, "job.ack", runId, {
      accepted: false,
      reason: "SECRET_RESOLUTION_FAILED: env GH_TOKEN not set",
    });
    const run = await waitForTerminal(runId);
    expect(run.status).toBe("FAILED");
    expect(run.errorType).toBe("SECRET_RESOLUTION_FAILED");
    ws.close();
  });

  it("no ack → FAILED/AGENT_UNAVAILABLE after the ack deadline", async () => {
    const { agent, enrollment } = await createAgent("edge-silent-ack");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    const configId = await bindConfig(agent.id, cred.id);

    const runId = await trigger(configId);
    await onFrame(ws, "job.assign");
    const run = await waitForTerminal(runId);
    expect(run.status).toBe("FAILED");
    expect(run.errorType).toBe("AGENT_UNAVAILABLE");
    ws.close();
  });

  it("ws close mid-run → FAILED/AGENT_LOST and the in-flight slot drains", async () => {
    const { agent, enrollment } = await createAgent("edge-drop");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    const configId = await bindConfig(agent.id, cred.id);

    const runId = await trigger(configId);
    await onFrame(ws, "job.assign");
    sendFrame(ws, "job.ack", runId, { accepted: true });
    await new Promise((r) => setTimeout(r, 200));
    ws.terminate();

    const run = await waitForTerminal(runId);
    expect(run.status).toBe("FAILED");
    expect(run.errorType).toBe("AGENT_LOST");

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/agents/${agent.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(detail.json().agent.activeRuns).toEqual([]);
  });

  it("run.error{ASSET_TOO_LARGE} → run-error row, run continues to COMPLETED", async () => {
    const { agent, enrollment } = await createAgent("edge-bigasset");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    const configId = await bindConfig(agent.id, cred.id);

    const runId = await trigger(configId);
    await onFrame(ws, "job.assign");
    sendFrame(ws, "job.ack", runId, { accepted: true });
    await new Promise((r) => setTimeout(r, 200));

    sendFrame(ws, "run.error", runId, {
      assetExternalId: "huge-1",
      errorType: "ASSET_TOO_LARGE",
      errorMessage: "asset exceeds the 1000000-byte frame limit",
    });
    sendFrame(ws, "asset.batch", runId, {
      assets: [
        {
          category: "REPOSITORY",
          provider: "GITHUB",
          resourceType: "repository",
          name: "acme/ok",
          externalId: "ok-1",
          instances: [],
        },
      ],
    });
    sendFrame(ws, "run.complete", runId, { result: "COMPLETED" });

    const run = await waitForTerminal(runId);
    expect(run.status).toBe("COMPLETED");
    const errors = await testDb!.db
      .selectFrom("import_run_errors")
      .selectAll()
      .where("runId", "=", runId)
      .execute();
    expect(errors.map((e) => e.errorType)).toContain("ASSET_TOO_LARGE");
    ws.close();
  });

  it("late frames after a terminal run are ignored (no error, no crash)", async () => {
    const { agent, enrollment } = await createAgent("edge-late");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    const configId = await bindConfig(agent.id, cred.id);

    const runId = await trigger(configId);
    await onFrame(ws, "job.assign");
    sendFrame(ws, "job.ack", runId, { accepted: true });
    sendFrame(ws, "run.complete", runId, { result: "COMPLETED" });
    await waitForTerminal(runId);

    // A late batch for the finished run: session drops it as a protocol
    // violation (unowned runId) rather than corrupting the run.
    const closed = new Promise<number>((resolve) =>
      ws.on("close", (code) => resolve(code)),
    );
    sendFrame(ws, "asset.batch", runId, { assets: [] });
    expect(await closed).toBe(1008);
    const run = await getRunRow(runId);
    expect(run.status).toBe("COMPLETED");
  });

  it("hub restart recovery: RUNNING remote run → FAILED/AGENT_LOST on boot", async () => {
    const { agent } = await createAgent("edge-restart");
    const cred = await createAgentManagedCredential();
    const configId = await bindConfig(agent.id, cred.id);
    const now = new Date().toISOString();
    const runId = randomUUID();
    await testDb!.db
      .insertInto("import_runs")
      .values({
        id: runId,
        configId,
        agentId: agent.id,
        status: "RUNNING",
        triggeredBy: null,
        assetsProcessed: 0,
        assetsCreated: 0,
        assetsUpdated: 0,
        instancesOrphaned: 0,
        componentsRetired: 0,
        createdAt: now,
      })
      .execute();

    const { recoverRuns } = await import("../../src/services/recovery-service.js");
    await recoverRuns();

    const run = await getRunRow(runId);
    expect(run.status).toBe("FAILED");
    expect(run.errorType).toBe("AGENT_LOST");
  });
});
