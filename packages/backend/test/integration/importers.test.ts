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

// Mock the importer registry so we can inject a fake importer without network calls.
vi.mock("../../src/services/importer-registry.js", async () => {
  const actual = await vi.importActual("../../src/services/importer-registry.js");
  return {
    ...actual,
    getImporter: vi.fn(),
  };
});

import { getImporter } from "../../src/services/importer-registry.js";

function makeRepoAsset(name: string, instanceExternalId = "main"): DiscoveredAsset {
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
        externalId: instanceExternalId,
        url: `https://github.com/${name}`,
        status: "RUNNING",
      },
    ],
    details: null,
  };
}

function makeImporter(yields: DiscoveredAsset[]): Importer {
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

describe("importers", () => {
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
    for (let i = 0; i < 50; i++) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/importer-configs/${configId}/runs/${runId}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      const body = JSON.parse(res.payload);
      if (["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(body.run.status)) {
        if (body.run.status === "FAILED") {
          const errors = await testDb!.db
            .selectFrom("import_run_errors")
            .select(["errorType", "errorMessage"])
            .where("runId", "=", runId)
            .execute();
          console.log("Run failed:", body.run, errors);
        }
        return body.run;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Run did not reach terminal state in time");
  }

  it("lists registered importers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/importers",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    const github = body.importers.find((m: { name: string }) => m.name === "github");
    expect(github).toBeDefined();
    expect(github.configSchema).toBeDefined();
  });

  it("admin creates and updates a github importer config", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        importerName: "github",
        label: "My GitHub",
        scope: { org: "testorg" },
        secretRefs: [{ key: "token", env: "COMPONODE_TEST_GITHUB_TOKEN" }],
        schedule: "0 0 * * *",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.payload).config;
    expect(created.importerName).toBe("github");
    expect(created.scope.org).toBe("testorg");

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/importer-configs/${created.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { label: "Updated GitHub" },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.payload).config.label).toBe("Updated GitHub");
  });

  it("masks secretRefs env/file locations in config API responses", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        importerName: "github",
        label: "Secret masking",
        scope: { org: "testorg" },
        secretRefs: [
          { key: "token", env: "GITHUB_TOKEN" },
          { key: "cert", file: "certs/github.pem" },
        ],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.payload).config;
    expect(created.secretRefs).toEqual([{ key: "token" }, { key: "cert" }]);

    const getRes = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${created.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.payload).config.secretRefs).toEqual([{ key: "token" }, { key: "cert" }]);

    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const listed = JSON.parse(listRes.payload).configs.find((c: { id: string }) => c.id === created.id);
    expect(listed.secretRefs).toEqual([{ key: "token" }, { key: "cert" }]);
    expect(JSON.stringify(listed)).not.toContain("GITHUB_TOKEN");

    // Stored row is unchanged — secrets still resolve at run time.
    const stored = await testDb!.db
      .selectFrom("importer_configs")
      .select("secretRefs")
      .where("id", "=", created.id)
      .executeTakeFirstOrThrow();
    expect(stored.secretRefs).toEqual([
      { key: "token", env: "GITHUB_TOKEN" },
      { key: "cert", file: "certs/github.pem" },
    ]);
  });

  it("triggers a run and upserts components and instances", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeImporter([makeRepoAsset("testorg/repo-a"), makeRepoAsset("testorg/repo-b")]),
    );

    const createRes = await app.inject({
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
    const config = JSON.parse(createRes.payload).config;

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
    expect(run.assetsProcessed).toBe(2);

    const components = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("provider", "=", "GITHUB")
      .execute();
    expect(components).toHaveLength(2);

    const instances = await testDb!.db.selectFrom("component_instances").selectAll().execute();
    expect(instances).toHaveLength(2);
  });

  it("orphans missing instances and retires missing components across runs", async () => {
    (getImporter as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeImporter([makeRepoAsset("testorg/repo-a"), makeRepoAsset("testorg/repo-b")]))
      .mockResolvedValueOnce(makeImporter([makeRepoAsset("testorg/repo-a", "main")])); // second run does not yield repo-b

    const createRes = await app.inject({
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
    const config = JSON.parse(createRes.payload).config;

    const run1 = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    await waitForRun(config.id, JSON.parse(run1.payload).runId);

    const run2 = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    await waitForRun(config.id, JSON.parse(run2.payload).runId);

    const components = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("provider", "=", "GITHUB")
      .execute();
    expect(components).toHaveLength(2);
    const repoB = components.find((c) => c.externalId === "testorg/repo-b");
    expect(repoB?.lifecycle).toBe("RETIRED");
  });
});
