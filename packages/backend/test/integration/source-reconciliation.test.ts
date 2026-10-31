import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DiscoveredAsset } from "@componode/core";

vi.mock("../../src/services/importer-registry.js", async () => {
  return {
    getImporter: vi.fn(),
    getManifest: vi.fn(),
    getManifests: vi.fn(async () => []),
    getConfigSchema: vi.fn(),
  };
});

import { getImporter, getManifest } from "../../src/services/importer-registry.js";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME, csrfCookie, csrfHeader } from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin-password-123";

function asset(externalId: string, instId?: string): DiscoveredAsset {
  return {
    externalId,
    name: externalId,
    slug: externalId,
    category: "COMPUTE",
    provider: "OTHER",
    resourceType: "test",
    instances: [
      { externalId: instId ?? `${externalId}-inst`, environment: "PRODUCTION", status: "RUNNING" },
    ],
  };
}

const adoptingManifest = {
  name: "github",
  label: "GitHub",
  description: "test",
  version: "1.0.0",
  implPath: "x",
  reportsSourceIdentity: true,
};

function sourceImporter(yields: DiscoveredAsset[], identity: string) {
  return {
    name: "github",
    version: "1.0.0",
    async *run(
      _c: Record<string, unknown>,
      _s: Record<string, string>,
      context: import("@componode/core").ImporterContext,
    ) {
      await context.reportSourceIdentity({ externalIdentity: identity });
      for (const a of yields) yield a;
    },
  };
}

describe("source-scoped reconciliation", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let originalDbUrl: string | undefined;

  beforeEach(async () => {
    originalDbUrl = process.env.DATABASE_URL;
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
    (getManifest as any).mockResolvedValue(adoptingManifest);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    vi.resetModules();
  });

  async function createConfig(): Promise<{ id: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { importerName: "github", label: "GH", scope: {} },
    });
    return JSON.parse(res.payload).config;
  }

  async function runOnce(configId: string) {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${configId}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    const { runId } = JSON.parse(res.payload);
    for (let i = 0; i < 100; i++) {
      const r = await app.inject({
        method: "GET",
        url: `/api/v1/importer-configs/${configId}/runs/${runId}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      const body = JSON.parse(r.payload);
      if (["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(body.run.status)) return body.run;
      await new Promise((r2) => setTimeout(r2, 100));
    }
    throw new Error("run did not terminate");
  }

  async function component(externalId: string) {
    const { db } = await import("../../src/db/connection.js");
    return db
      .selectFrom("components")
      .selectAll()
      .where("externalId", "=", externalId)
      .executeTakeFirst();
  }

  async function instances(componentId: string) {
    const { db } = await import("../../src/db/connection.js");
    return db
      .selectFrom("component_instances")
      .selectAll()
      .where("componentId", "=", componentId)
      .execute();
  }

  it("two sources share a component; retire-one keeps it, retire-last retires it", async () => {
    // Source A and Source B both report the same component (same dedup key).
    (getImporter as any).mockResolvedValueOnce(sourceImporter([asset("shared")], "src-A"));
    const configA = await createConfig();
    await runOnce(configA.id);

    (getImporter as any).mockResolvedValue(sourceImporter([asset("shared")], "src-B"));
    const configB = await createConfig();
    await runOnce(configB.id);

    let comp = await component("shared");
    expect(comp.lifecycle).toBe("ACTIVE");

    // Source A's next run omits the component — A's membership deactivates,
    // the component stays ACTIVE because B still reports it.
    (getImporter as any).mockResolvedValue(sourceImporter([], "src-A"));
    await runOnce(configA.id);
    comp = await component("shared");
    expect(comp.lifecycle).toBe("ACTIVE");

    // Source B's run omits it too — last reporter gone → RETIRED + GONE.
    (getImporter as any).mockResolvedValue(sourceImporter([], "src-B"));
    const runB = await runOnce(configB.id);
    comp = await component("shared");
    expect(comp.lifecycle).toBe("RETIRED");
    expect(runB.componentsRetired).toBe(1);
    const insts = await instances(comp.id);
    expect(insts.every((i: any) => i.status === "GONE")).toBe(true);
  });

  it("a failed run deactivates nothing", async () => {
    (getImporter as any).mockResolvedValue(sourceImporter([asset("keepme")], "src-F"));
    const config = await createConfig();
    await runOnce(config.id);

    // Next run throws mid-generator — no retirement may occur.
    (getImporter as any).mockResolvedValue({
      name: "github",
      version: "1.0.0",
      async *run(
        _c: Record<string, unknown>,
        _s: Record<string, string>,
        context: import("@componode/core").ImporterContext,
      ) {
        await context.reportSourceIdentity({ externalIdentity: "src-F" });
        yield asset("keepme");
        throw new Error("boom");
      },
    });
    const run = await runOnce(config.id);
    expect(run.status).toBe("FAILED");
    const comp = await component("keepme");
    expect(comp.lifecycle).toBe("ACTIVE");
  });
});
