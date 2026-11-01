import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { csrfCookie, csrfHeader, loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";
import type { DiscoveredAsset, Importer, ImporterContext } from "@componode/core";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

// alibaba-cloud requires accessKeyId + accessKeySecret at save-time
// coverage validation (spec 013); legacy env refs keep fixtures working.
process.env.COMPONODE_TEST_ALIBABA_AKID ??= "test-akid";
process.env.COMPONODE_TEST_ALIBABA_SECRET ??= "test-secret";

vi.mock("../../src/services/importer-registry.js", async () => {
  const actual = await vi.importActual("../../src/services/importer-registry.js");
  return {
    ...actual,
    getImporter: vi.fn(),
  };
});

import { getImporter } from "../../src/services/importer-registry.js";

function makeAccountAsset(): DiscoveredAsset {
  return {
    category: "ACCOUNT",
    provider: "ALIBABA_CLOUD",
    resourceType: "alibaba-cloud:account",
    name: "Alibaba Cloud account 1234567890123456",
    externalId: "1234567890123456",
    slug: "alibaba-cloud-account-1234567890123456",
    details: {
      capabilities: {},
      coverage: { discoveredCount: 1, mappedCount: 1, skippedCount: 0, skippedTypes: [] },
    },
    instances: [{ environment: "PRODUCTION", externalId: "1234567890123456", status: "RUNNING" }],
  };
}

function makeEcsAsset(): DiscoveredAsset {
  return {
    category: "COMPUTE",
    provider: "ALIBABA_CLOUD",
    resourceType: "ACS::ECS::Instance",
    name: "web-server-01",
    externalId: "ACS::ECS::Instance:i-bp1234567890abcdef",
    slug: "web-server-01-90abcdef",
    details: { resourceGroupId: null, zoneId: "cn-hangzhou-i", tags: [] },
    instances: [
      {
        environment: "PRODUCTION",
        region: "cn-hangzhou",
        status: "RUNNING",
        externalId: "i-bp1234567890abcdef",
      },
    ],
  };
}

function makeAlibabaImporter(yields: DiscoveredAsset[]): Importer {
  return {
    name: "alibaba-cloud",
    version: "1.0.0",
    async *run(
      _config: Record<string, unknown>,
      _secrets: Record<string, string>,
      context: ImporterContext,
    ) {
      await context.reportSourceIdentity({ externalIdentity: "1234567890123456" });
      for (const asset of yields) {
        if (context.signal.aborted) return;
        await context.reportPhase(`Processing ${asset.externalId}`);
        yield asset;
      }
      await context.reportPhase("Completed");
    },
  };
}

describe("alibaba-cloud importer — run through backend", () => {
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

  it("completes a run and persists ALIBABA_CLOUD components", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeAlibabaImporter([makeEcsAsset(), makeAccountAsset()]),
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        importerName: "alibaba-cloud",
        label: "Alibaba Cloud",
        scope: {},
        secretRefs: [
          { key: "accessKeyId", env: "COMPONODE_TEST_ALIBABA_AKID" },
          { key: "accessKeySecret", env: "COMPONODE_TEST_ALIBABA_SECRET" },
        ],
      },
    });
    expect(createRes.statusCode).toBe(201);
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

    const componentsRes = await app.inject({
      method: "GET",
      url: "/api/v1/components?provider=ALIBABA_CLOUD",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(componentsRes.statusCode).toBe(200);
    const components = componentsRes.json().data;
    expect(components).toHaveLength(2);
    const categories = components.map((c: { category: string }) => c.category).sort();
    expect(categories).toEqual(["ACCOUNT", "COMPUTE"]);
  });
});
