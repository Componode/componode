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

function asset(externalId: string, sourceDetails?: Record<string, unknown>): DiscoveredAsset {
  return {
    externalId,
    name: externalId,
    slug: externalId.replace(/[^a-z0-9-]/gi, "-"),
    category: "COMPUTE",
    provider: "OTHER",
    resourceType: "test",
    instances: [
      { externalId: `${externalId}-inst`, environment: "PRODUCTION", status: "RUNNING" },
    ],
    ...(sourceDetails ? { sourceDetails } : {}),
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

const legacyManifest = {
  name: "github",
  label: "GitHub",
  description: "test",
  version: "1.0.0",
  implPath: "x",
};

function importerOf(yields: DiscoveredAsset[], identity?: string) {
  return {
    name: "github",
    version: "1.0.0",
    async *run(
      _c: Record<string, unknown>,
      _s: Record<string, string>,
      context: import("@componode/core").ImporterContext,
    ) {
      if (identity) await context.reportSourceIdentity({ externalIdentity: identity });
      for (const a of yields) yield a;
    },
  };
}

describe("adopt-on-report and source-qualified externalIds", () => {
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

  async function allComponents() {
    const { db } = await import("../../src/db/connection.js");
    return db.selectFrom("components").selectAll().execute();
  }

  async function componentByExternalId(externalId: string) {
    const { db } = await import("../../src/db/connection.js");
    return db
      .selectFrom("components")
      .selectAll()
      .where("externalId", "=", externalId)
      .executeTakeFirst();
  }

  async function membershipsFor(componentId: string) {
    const { db } = await import("../../src/db/connection.js");
    return db
      .selectFrom("source_component_memberships")
      .selectAll()
      .where("componentId", "=", componentId)
      .execute();
  }

  it("adopts a legacy component on first source-qualified report (no duplicate)", async () => {
    // Pre-migration run: non-adopting importer creates the legacy row.
    (getManifest as any).mockResolvedValue(legacyManifest);
    (getImporter as any).mockResolvedValue(importerOf([asset("region:type")], undefined));
    const config = await createConfig();
    const legacyRun = await runOnce(config.id);
    expect(legacyRun.status).toBe("COMPLETED");
    const legacy = await componentByExternalId("region:type");
    expect(legacy).toBeTruthy();

    // Post-migration run: adopting importer emits the qualified id.
    (getManifest as any).mockResolvedValue(adoptingManifest);
    (getImporter as any).mockResolvedValue(importerOf([asset("acct-1::region:type")], "acct-1"));
    const run = await runOnce(config.id);
    expect(run.status).toBe("COMPLETED");

    const comps = await allComponents();
    expect(comps.length).toBe(1);
    expect(comps[0].id).toBe(legacy.id);
    expect(comps[0].externalId).toBe("acct-1::region:type");
    const memberships = await membershipsFor(legacy.id);
    expect(memberships.length).toBe(1);
    expect(memberships[0].active).toBe(true);
  });

  it("leaves unreported legacy rows untouched (externalId + provenance preserved)", async () => {
    (getManifest as any).mockResolvedValue(legacyManifest);
    (getImporter as any).mockResolvedValue(importerOf([asset("gone-asset")], undefined));
    const config = await createConfig();
    await runOnce(config.id);

    (getManifest as any).mockResolvedValue(adoptingManifest);
    (getImporter as any).mockResolvedValue(importerOf([], "acct-1"));
    await runOnce(config.id);

    const legacy = await componentByExternalId("gone-asset");
    expect(legacy).toBeTruthy();
    expect(legacy.externalId).toBe("gone-asset");
    expect((await membershipsFor(legacy.id)).length).toBe(0);
    // The run is attributed; the component keeps legacy provenance.
    const { db } = await import("../../src/db/connection.js");
    const runs = await db
      .selectFrom("import_runs")
      .selectAll()
      .orderBy("startedAt", "asc")
      .execute();
    expect(runs[0].sourceId).toBeNull();
    expect(runs[1].sourceId).not.toBeNull();
  });

  it("same native id from two distinct Sources produces two Components", async () => {
    (getManifest as any).mockResolvedValue(adoptingManifest);
    (getImporter as any).mockResolvedValueOnce(importerOf([asset("acct-A::region:type")], "acct-A"));
    const configA = await createConfig();
    await runOnce(configA.id);

    (getImporter as any).mockResolvedValue(importerOf([asset("acct-B::region:type")], "acct-B"));
    const configB = await createConfig();
    await runOnce(configB.id);

    const comps = await allComponents();
    expect(comps.length).toBe(2);
    const extIds = comps.map((c) => c.externalId).sort();
    expect(extIds).toEqual(["acct-A::region:type", "acct-B::region:type"]);
  });

  it("a previously merged legacy row disambiguates across two Sources", async () => {
    // Two legacy configs both reported "region:type" — merged into one row.
    (getManifest as any).mockResolvedValue(legacyManifest);
    (getImporter as any).mockResolvedValueOnce(importerOf([asset("region:type")], undefined));
    const configA = await createConfig();
    await runOnce(configA.id);
    const legacy = await componentByExternalId("region:type");

    // Source A adopts it.
    (getManifest as any).mockResolvedValue(adoptingManifest);
    (getImporter as any).mockResolvedValue(importerOf([asset("acct-A::region:type")], "acct-A"));
    await runOnce(configA.id);
    expect((await componentByExternalId("acct-A::region:type"))?.id).toBe(legacy.id);

    // Source B reports its own same-native-id asset — cannot match A's row.
    (getImporter as any).mockResolvedValue(importerOf([asset("acct-B::region:type")], "acct-B"));
    const configB = await createConfig();
    await runOnce(configB.id);

    const comps = await allComponents();
    expect(comps.length).toBe(2);
    expect(comps.map((c) => c.externalId).sort()).toEqual([
      "acct-A::region:type",
      "acct-B::region:type",
    ]);
  });
});
