import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { csrfCookie, csrfHeader, getCookie, loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";
import type { DiscoveredAsset, Importer, ImporterContext } from "@componode/core";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

// github configs need a resolvable secret source under save-time
// coverage validation (spec 013); a legacy env ref keeps fixtures working.
process.env.COMPONODE_TEST_GITHUB_TOKEN ??= "test-github-token";

vi.mock("../../src/services/importer-registry.js", async () => {
  const actual = await vi.importActual("../../src/services/importer-registry.js");
  return {
    ...actual,
    getImporter: vi.fn(),
  };
});

import { getImporter } from "../../src/services/importer-registry.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRepoAsset(name: string): DiscoveredAsset {
  return {
    category: "REPOSITORY",
    provider: "GITHUB",
    resourceType: "github:repository",
    name,
    externalId: name,
    slug: name.toLowerCase().replace(/\//g, "-"),
    instances: [
      {
        environment: "PRODUCTION",
        externalId: "main",
        url: `https://github.com/${name}`,
        status: "RUNNING",
      },
    ],
    details: null,
  };
}

function makeCancellableImporter(): Importer {
  return {
    name: "github",
    version: "1.0.0",
    async *run(
      _config: Record<string, unknown>,
      _secrets: Record<string, string>,
      context: ImporterContext,
    ) {
      await context.reportPhase("Working");
      while (!context.signal.aborted) {
        await sleep(50);
      }
      throw Object.assign(new Error("AbortError"), { name: "AbortError" });
    },
  };
}

function makeFastImporter(yields: DiscoveredAsset[]): Importer {
  return {
    name: "github",
    version: "1.0.0",
    async *run(
      _config: Record<string, unknown>,
      _secrets: Record<string, string>,
      context: ImporterContext,
    ) {
      for (const asset of yields) {
        if (context.signal.aborted) return;
        await context.reportPhase(`Processing ${asset.externalId}`);
        yield asset;
      }
      await context.reportPhase("Completed");
    },
  };
}

describe("import-runs", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let originalDbUrl: string | undefined;
  let originalNodeEnv: string | undefined;
  let originalBootstrapUsername: string | undefined;
  let originalBootstrapPassword: string | undefined;

  beforeEach(async () => {
    originalDbUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    originalBootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
    originalBootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    vi.resetModules();
    vi.clearAllMocks();

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
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    else delete process.env.DATABASE_URL;
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalBootstrapUsername !== undefined) process.env.BOOTSTRAP_ADMIN_USERNAME = originalBootstrapUsername;
    else delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    if (originalBootstrapPassword !== undefined) process.env.BOOTSTRAP_ADMIN_PASSWORD = originalBootstrapPassword;
    else delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    vi.resetModules();
  });

  async function waitForRun(configId: string, runId: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < 100; i++) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/importer-configs/${configId}/runs/${runId}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      const body = JSON.parse(res.payload);
      if (["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(body.run.status)) {
        return body.run;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Run did not reach terminal state in time");
  }

  async function createConfig(): Promise<{ id: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        importerName: "github",
        label: "GitHub",
        scope: { org: "testorg" },
        secretRefs: [{ key: "token", env: "COMPONODE_TEST_GITHUB_TOKEN" }],
      },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.payload).config;
  }

  it("returns 202 and completes a triggered run", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeFastImporter([makeRepoAsset("testorg/repo-a")]),
    );

    const config = await createConfig();
    const triggerRes = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });

    expect(triggerRes.statusCode).toBe(202);
    const { runId } = JSON.parse(triggerRes.payload);

    const run = await waitForRun(config.id, runId);
    expect(run.status).toBe("COMPLETED");
    expect(run.assetsProcessed).toBe(1);
  });

  it("returns 409 when triggering a run for a config with an in-progress run", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeFastImporter([makeRepoAsset("testorg/repo-a")]),
    );

    const config = await createConfig();
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(first.statusCode).toBe(202);
    const { runId } = JSON.parse(first.payload);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.payload).code).toBe("RUN_IN_PROGRESS");

    await waitForRun(config.id, runId);
  });

  it("cancels a run before the worker starts", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeFastImporter([makeRepoAsset("testorg/repo-a")]),
    );

    const config = await createConfig();
    const trigger = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    const { runId } = JSON.parse(trigger.payload);

    const cancel = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/runs/${runId}/cancel`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(cancel.statusCode).toBe(204);

    const run = await waitForRun(config.id, runId);
    expect(run.status).toBe("CANCELLED");
  });

  it("cancels a run while it is running", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(makeCancellableImporter());

    const config = await createConfig();
    const trigger = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    const { runId } = JSON.parse(trigger.payload);

    // Give the worker time to enter RUNNING.
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/importer-configs/${config.id}/runs/${runId}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      const body = JSON.parse(res.payload);
      if (body.run.status === "RUNNING") break;
      await sleep(50);
    }

    const cancel = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/runs/${runId}/cancel`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(cancel.statusCode).toBe(204);

    const run = await waitForRun(config.id, runId);
    expect(run.status).toBe("CANCELLED");
  });

  it("recovers stale runs on startup", async () => {
    const { recoverRuns } = await import("../../src/services/recovery-service.js");

    // Create a config so the DB knows the importer.
    const config = await createConfig();

    const now = new Date().toISOString();
    const runningId = uuidv7();
    const pendingId = uuidv7();
    const cancelledId = uuidv7();

    await testDb!.db
      .insertInto("import_runs")
      .values([
        {
          id: runningId,
          configId: config.id,
          status: "RUNNING",
          assetsProcessed: 0,
          assetsCreated: 0,
          assetsUpdated: 0,
          instancesOrphaned: 0,
          componentsRetired: 0,
          createdAt: now,
        },
        {
          id: pendingId,
          configId: config.id,
          status: "PENDING",
          assetsProcessed: 0,
          assetsCreated: 0,
          assetsUpdated: 0,
          instancesOrphaned: 0,
          componentsRetired: 0,
          createdAt: now,
        },
        {
          id: cancelledId,
          configId: config.id,
          status: "RUNNING",
          cancelRequestedAt: now,
          assetsProcessed: 0,
          assetsCreated: 0,
          assetsUpdated: 0,
          instancesOrphaned: 0,
          componentsRetired: 0,
          createdAt: now,
        },
      ])
      .execute();

    await recoverRuns();

    const rows = await testDb!.db
      .selectFrom("import_runs")
      .select(["id", "status"])
      .where("id", "in", [runningId, pendingId, cancelledId])
      .execute();

    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(byId[runningId]).toBe("INTERRUPTED");
    expect(byId[pendingId]).toBe("INTERRUPTED");
    expect(byId[cancelledId]).toBe("CANCELLED");
  });
});
