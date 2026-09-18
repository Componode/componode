import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { csrfCookie, csrfHeader, loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";
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
        yield asset;
      }
    },
  };
}

describe("import-reconciliation", () => {
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

  it("orphans missing instances and retires missing components across runs", async () => {
    (getImporter as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeImporter([makeRepoAsset("testorg/repo-a"), makeRepoAsset("testorg/repo-b")]))
      .mockResolvedValueOnce(makeImporter([makeRepoAsset("testorg/repo-a")]));

    const config = await createConfig();

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

    const repoA = components.find((c) => c.externalId === "testorg/repo-a");
    expect(repoA?.lifecycle).toBe("ACTIVE");

    const instances = await testDb!.db
      .selectFrom("component_instances")
      .selectAll()
      .execute();

    const repoBInstances = instances.filter((i) => i.componentId === repoB?.id);
    expect(repoBInstances.every((i) => i.status === "GONE")).toBe(true);
  });

  it("flips orphan status back to RUNNING and retired status back to ACTIVE on re-appearance", async () => {
    (getImporter as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeImporter([makeRepoAsset("testorg/repo-a")]))
      .mockResolvedValueOnce(makeImporter([]))
      .mockResolvedValueOnce(makeImporter([makeRepoAsset("testorg/repo-a")]));

    const config = await createConfig();

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

    const run3 = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    await waitForRun(config.id, JSON.parse(run3.payload).runId);

    const component = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("externalId", "=", "testorg/repo-a")
      .where("provider", "=", "GITHUB")
      .executeTakeFirst();

    expect(component?.lifecycle).toBe("ACTIVE");

    const instance = await testDb!.db
      .selectFrom("component_instances")
      .selectAll()
      .where("componentId", "=", component!.id)
      .where("externalId", "=", "main")
      .executeTakeFirst();

    expect(instance?.status).toBe("RUNNING");
  });
});
