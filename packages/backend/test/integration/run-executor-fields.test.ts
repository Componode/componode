import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

// Executor fields on run payloads (spec 027 US5): agentId + agentName ride
// the run row; the name join tolerates a deleted agent (history survives).
describe("run executor fields", () => {
  let testDb: TestDb | null = null;
  let app: any;
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
    vi.resetModules();

    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();

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
      ...authed({ name }),
    });
    expect(res.statusCode).toBe(201);
    return res.json().agent as { id: string; name: string };
  }

  async function bindConfig(agentId: string | null) {
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
    return configId;
  }

  async function insertRun(configId: string, agentId: string | null) {
    const runId = randomUUID();
    await testDb!.db
      .insertInto("import_runs")
      .values({
        id: runId,
        configId,
        agentId,
        status: "COMPLETED",
        triggeredBy: null,
        assetsProcessed: 0,
        assetsCreated: 0,
        assetsUpdated: 0,
        instancesOrphaned: 0,
        componentsRetired: 0,
        createdAt: new Date().toISOString(),
      })
      .execute();
    return runId;
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

  it("run payload carries agentId + agentName; in-process runs read null", async () => {
    const agent = await createAgent("edge-fields");
    const boundId = await bindConfig(agent.id);
    const remoteRunId = await insertRun(boundId, agent.id);

    const run = await getRun(boundId, remoteRunId);
    expect(run.agentId).toBe(agent.id);
    expect(run.agentName).toBe("edge-fields");

    const localId = await bindConfig(null);
    const localRunId = await insertRun(localId, null);
    const local = await getRun(localId, localRunId);
    expect(local.agentId).toBeNull();
    expect(local.agentName).toBeNull();
  });

  it("agentName joins tolerate a deleted agent row (name → null)", async () => {
    const agent = await createAgent("edge-gone");
    const configId = await bindConfig(agent.id);
    const runId = await insertRun(configId, agent.id);

    // Unbind the config then drop the agent row — run history must survive.
    await testDb!.db
      .updateTable("importer_configs")
      .set({ agentId: null })
      .where("id", "=", configId)
      .execute();
    await testDb!.db
      .deleteFrom("import_agents")
      .where("id", "=", agent.id)
      .execute();

    const run = await getRun(configId, runId);
    expect(run.agentId).toBe(agent.id);
    expect(run.agentName).toBeNull();
  });
});
