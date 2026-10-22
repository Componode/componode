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

// Remote run execution (spec 027 US2): a bound config's trigger dispatches
// job.assign over the agent stream; ack/batch/phase/complete frames drive
// the run through the same upsert/reconcile pipeline as in-process runs.
describe("remote run execution", () => {
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
    // Keep the session alive across the 3s stale sweep.
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

  // Frames may arrive before the caller attaches — poll a buffered inbox
  // instead of racing a one-shot listener.
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

  async function bindConfig(agentId: string, credentialIds: string | string[]) {
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

  async function getRun(configId: string, runId: string) {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs/${runId}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    return res.json().run;
  }

  async function waitForRunStatus(
    configId: string,
    runId: string,
    status: string,
    timeoutMs = 5000,
  ) {
    const start = Date.now();
    for (;;) {
      const run = await getRun(configId, runId);
      if (run.status === status) return run;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`run ${runId} still ${run.status}, expected ${status}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  function repoAsset(externalId: string) {
    return {
      category: "REPOSITORY",
      provider: "GITHUB",
      resourceType: "repository",
      name: `acme/${externalId}`,
      externalId,
      instances: [
        { environment: "PRODUCTION", externalId, status: "RUNNING" },
      ],
    };
  }

  it("runs end-to-end: assign → ack → batch/phase → complete with identical catalog outcome", async () => {
    const { agent, enrollment } = await createAgent("edge-run");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    const configId = await bindConfig(agent.id, cred.id);

    const runId = await trigger(configId);

    // job.assign carries runId + importerName + scope + secret REFS (names
    // only — never values).
    const assign = await onFrame(ws, "job.assign");
    expect(assign.runId).toBe(runId);
    const payload = assign.payload as Record<string, unknown>;
    expect(payload.importerName).toBe("github");
    expect(payload.scope).toEqual({ org: "acme" });
    expect(payload.secretRefMap).toEqual({ token: { env: "GH_TOKEN" } });
    expect(JSON.stringify(assign)).not.toMatch(/ghp_|secret-value/i);

    sendFrame(ws, "job.ack", runId, { accepted: true });
    const running = await waitForRunStatus(configId, runId, "RUNNING");
    expect(running.agentId).toBe(agent.id);
    expect(running.agentName).toBe("edge-run");
    expect(running.startedAt).not.toBeNull();

    sendFrame(ws, "phase", runId, { name: "Fetching repos" });
    await new Promise((r) => setTimeout(r, 150));
    expect((await getRun(configId, runId)).currentPhase).toBe("Fetching repos");

    // One valid asset + one invalid (name missing) → valid upserts, invalid
    // lands as a VALIDATION_FAILED run-error row.
    sendFrame(ws, "asset.batch", runId, {
      assets: [repoAsset("repo-one"), repoAsset("repo-two"), { provider: "GITHUB", externalId: "bad-asset" }],
    });
    await new Promise((r) => setTimeout(r, 300));

    sendFrame(ws, "run.complete", runId, { result: "COMPLETED" });
    const done = await waitForRunStatus(configId, runId, "COMPLETED");
    expect(done.assetsProcessed).toBe(3);
    expect(done.assetsCreated).toBe(2);
    expect(done.agentId).toBe(agent.id);
    expect(done.agentName).toBe("edge-run");

    const components = await testDb!.db
      .selectFrom("components")
      .select(["externalId"])
      .where("provider", "=", "GITHUB")
      .execute();
    expect(components.map((c) => c.externalId).sort()).toEqual([
      "repo-one",
      "repo-two",
    ]);

    const errors = await testDb!.db
      .selectFrom("import_run_errors")
      .selectAll()
      .where("runId", "=", runId)
      .execute();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.errorType).toBe("VALIDATION_FAILED");
    expect(errors[0]!.assetExternalId).toBe("bad-asset");

    // credentialIds + lastUsedAt stamped on dispatch.
    const runRow = await testDb!.db
      .selectFrom("import_runs")
      .select("credentialIds")
      .where("id", "=", runId)
      .executeTakeFirstOrThrow();
    expect(runRow.credentialIds).toEqual([cred.id]);
    const credRow = await testDb!.db
      .selectFrom("credentials")
      .select("lastUsedAt")
      .where("id", "=", cred.id)
      .executeTakeFirstOrThrow();
    expect(credRow.lastUsedAt).not.toBeNull();
    ws.close();
  });

  it("enforces agent capacity: a second queued run dispatches only after the first completes", async () => {
    const { agent, enrollment } = await createAgent("edge-cap");
    const ws = await connectAgent(enrollment.token, 1);
    const cred = await createAgentManagedCredential();
    const config1 = await bindConfig(agent.id, cred.id);
    const config2 = await bindConfig(agent.id, cred.id);

    const runId1 = await trigger(config1);
    const assign1 = await onFrame(ws, "job.assign");
    expect(assign1.runId).toBe(runId1);
    sendFrame(ws, "job.ack", runId1, { accepted: true });

    // Invoke startRun directly — the same branch the scheduler takes for a
    // bound config (T016).
    const { startRun } = await import("../../src/services/import-run-service.js");
    const { runId: runId2 } = await startRun(config2, null);
    // Give the dispatcher a moment — no second assign may arrive while the
    // agent holds one job of max 1.
    await new Promise((r) => setTimeout(r, 500));
    sendFrame(ws, "run.complete", runId1, { result: "COMPLETED" });
    await waitForRunStatus(config1, runId1, "COMPLETED");

    const assign2 = await onFrame(ws, "job.assign");
    expect(assign2.runId).toBe(runId2);
    ws.close();
  });

  it("emits agent_jobs_total and agent_assets_received_total with agent labels", async () => {
    const { agent, enrollment } = await createAgent("edge-metrics");
    const ws = await connectAgent(enrollment.token);
    const cred = await createAgentManagedCredential();
    const configId = await bindConfig(agent.id, cred.id);

    const runId = await trigger(configId);
    await onFrame(ws, "job.assign");
    sendFrame(ws, "job.ack", runId, { accepted: true });
    sendFrame(ws, "asset.batch", runId, { assets: [repoAsset("repo-m")] });
    sendFrame(ws, "run.complete", runId, { result: "COMPLETED" });
    await waitForRunStatus(configId, runId, "COMPLETED");

    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(body).toContain('agent_jobs_total{agent="edge-metrics",result="completed"}');
    expect(body).toContain('agent_assets_received_total{agent="edge-metrics",importer="github"}');
    ws.close();
  });

  it("frames for an unassigned run close the session with BAD_FRAME", async () => {
    const { agent, enrollment } = await createAgent("edge-stray");
    const ws = await connectAgent(enrollment.token);
    await bindConfig(agent.id, []);

    const closed = new Promise<number>((resolve) =>
      ws.on("close", (code) => resolve(code)),
    );
    sendFrame(ws, "asset.batch", randomUUID(), { assets: [] });
    expect(await closed).toBe(1008);
  });
});
