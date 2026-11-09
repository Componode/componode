import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { uuidv7 } from "uuidv7";
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

function asset(externalId: string, instanceExternalId = `${externalId}-inst`): DiscoveredAsset {
  return {
    externalId,
    name: externalId,
    slug: externalId,
    category: "COMPUTE",
    provider: "OTHER",
    resourceType: "test",
    instances: [
      {
        externalId: instanceExternalId,
        environment: "PRODUCTION",
        status: "RUNNING",
      },
    ],
  };
}

function sourceImporter(yields: DiscoveredAsset[], identity = "src-1") {
  return {
    name: "github",
    version: "1.0.0",
    async *run(
      _c: Record<string, unknown>,
      _s: Record<string, string>,
      context: import("@componode/core").ImporterContext,
    ) {
      await context.reportSourceIdentity({ externalIdentity: identity, label: "Source One" });
      for (const a of yields) yield a;
    },
  };
}

function legacyImporter(yields: DiscoveredAsset[]) {
  return {
    name: "github",
    version: "1.0.0",
    async *run() {
      for (const a of yields) yield a;
    },
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
const legacyManifest = { ...adoptingManifest, reportsSourceIdentity: false };

describe("importer-sources", () => {
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
    expect(res.statusCode).toBe(201);
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
      if (["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(body.run.status)) {
        return body.run;
      }
      await new Promise((r2) => setTimeout(r2, 100));
    }
    throw new Error("run did not terminate");
  }

  async function getJson(url: string) {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1${url}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    return { status: res.statusCode, body: JSON.parse(res.payload) };
  }

  it("US1: a reported identity registers the Source and attributes the run", async () => {
    (getManifest as any).mockResolvedValue(adoptingManifest);
    (getImporter as any).mockResolvedValue(sourceImporter([asset("cmp-a")]));

    const config = await createConfig();
    const run = await runOnce(config.id);
    expect(run.status).toBe("COMPLETED");
    expect(run.sourceId).toBeTruthy();

    const { body } = await getJson("/importer-sources");
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 25, total: 1 });
    expect(body.data[0].externalIdentity).toBe("src-1");
    expect(body.data[0].status).toBe("ACTIVE");
    expect(body.data[0].boundConfig?.id).toBe(config.id);
    expect(body.data[0].activeComponentMemberships).toBe(1);
  });

  it("US1: an empty inventory still registers the Source", async () => {
    (getManifest as any).mockResolvedValue(adoptingManifest);
    (getImporter as any).mockResolvedValue(sourceImporter([], "src-empty"));

    const config = await createConfig();
    const run = await runOnce(config.id);
    expect(run.status).toBe("COMPLETED");

    const { body } = await getJson("/importer-sources?importerName=github");
    expect(body.data[0].externalIdentity).toBe("src-empty");
  });

  it("US1: adopting importer that yields before reporting fails CONTRACT_VIOLATION", async () => {
    (getManifest as any).mockResolvedValue(adoptingManifest);
    (getImporter as any).mockResolvedValue(legacyImporter([asset("cmp-x")]));

    const config = await createConfig();
    const run = await runOnce(config.id);
    expect(run.status).toBe("FAILED");
    expect(run.errorType).toBe("CONTRACT_VIOLATION");
  });

  it("US3: deleting a config preserves Source + run history; reattach reactivates", async () => {
    (getManifest as any).mockResolvedValue(adoptingManifest);
    (getImporter as any).mockResolvedValue(sourceImporter([asset("cmp-b")], "src-del"));

    const config = await createConfig();
    const run = await runOnce(config.id);
    const sourceId = run.sourceId;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/importer-configs/${config.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(del.statusCode).toBe(204);

    const { body } = await getJson(`/importer-sources/${sourceId}`);
    expect(body.source.status).toBe("UNMONITORED");
    expect(body.source.boundConfig).toBeNull();

    const { body: runsBody } = await getJson(`/importer-sources/${sourceId}/runs`);
    expect(runsBody.runs).toHaveLength(1);
    expect(runsBody.runs[0].configId).toBeNull();
    expect(runsBody.runs[0].sourceId).toBe(sourceId);
  });

  it("US3: retire is explicit and reversible", async () => {
    (getManifest as any).mockResolvedValue(adoptingManifest);
    (getImporter as any).mockResolvedValue(sourceImporter([asset("cmp-c")], "src-ret"));

    const config = await createConfig();
    const run = await runOnce(config.id);
    const sourceId = run.sourceId;

    const retire = await app.inject({
      method: "POST",
      url: `/api/v1/importer-sources/${sourceId}/retire`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(retire.statusCode).toBe(200);
    expect(JSON.parse(retire.payload).source.status).toBe("RETIRED");

    // Double-retire conflicts.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/importer-sources/${sourceId}/retire`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(again.statusCode).toBe(409);

    const reactivate = await app.inject({
      method: "POST",
      url: `/api/v1/importer-sources/${sourceId}/reactivate`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(reactivate.statusCode).toBe(200);
    expect(JSON.parse(reactivate.payload).source.status).toBe("ACTIVE");
  });

  it("US5: legacy runs stay unattributed with zero drift", async () => {
    (getManifest as any).mockResolvedValue(legacyManifest);
    (getImporter as any).mockResolvedValue(legacyImporter([asset("cmp-legacy")]));

    const config = await createConfig();
    const run = await runOnce(config.id);
    expect(run.status).toBe("COMPLETED");
    expect(run.sourceId).toBeNull();

    const { body } = await getJson("/importer-sources");
    expect(body.data).toHaveLength(0);
  });

  // Spec 068 / ADR-130: standardized list contract — envelope, whitelisted
  // sort, filters, search, strict query validation.
  it("list contract: paginates, sorts, filters, and searches sources", async () => {
    const now = new Date().toISOString();
    const mk = (id: string, importerName: string, externalIdentity: string, label: string | null, status: string, createdAt: string) => ({
      id, importerName, externalIdentity, label, status,
      boundConfigId: null, componentGroupId: null,
      firstSeenInRunId: null, lastSeenInRunId: null,
      createdAt, updatedAt: createdAt,
    });
    await testDb!.db.insertInto("importer_sources").values([
      mk(uuidv7(), "github", "https://github.com/acme/api", "Acme API", "ACTIVE", "2024-01-01T00:00:00.000Z"),
      mk(uuidv7(), "aws", "arn:aws:ec2:us-east-1:123:instance/i-1", "prod-box", "UNMONITORED", "2024-01-02T00:00:00.000Z"),
      mk(uuidv7(), "github", "https://github.com/acme/web", null, "RETIRED", "2024-01-03T00:00:00.000Z"),
    ]).execute();

    const { body } = await getJson("/importer-sources");
    expect(body.data).toHaveLength(3);
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 25, total: 3, pageCount: 1, hasNext: false });

    // `name` sorts by externalIdentity; default sort is createdAt asc.
    const byName = await getJson("/importer-sources?sort=name&order=asc");
    expect(byName.body.data.map((s: { externalIdentity: string }) => s.externalIdentity)).toEqual([
      "arn:aws:ec2:us-east-1:123:instance/i-1",
      "https://github.com/acme/api",
      "https://github.com/acme/web",
    ]);

    const byCreated = await getJson("/importer-sources?sort=createdAt&order=desc");
    expect(byCreated.body.data[0].externalIdentity).toBe("https://github.com/acme/web");

    const byImporter = await getJson("/importer-sources?sort=importerName&order=asc");
    expect(byImporter.body.data.map((s: { importerName: string }) => s.importerName)).toEqual([
      "aws", "github", "github",
    ]);

    const byStatus = await getJson("/importer-sources?sort=status&order=asc");
    expect(byStatus.body.data.map((s: { status: string }) => s.status)).toEqual([
      "ACTIVE", "RETIRED", "UNMONITORED",
    ]);

    // FR-005: boundConfig/components/instances order by the joined config
    // label / active-membership count subqueries the row exposes (all
    // empty on this fixture — deterministic id tie-break still applies).
    for (const sort of ["boundConfig", "components", "instances"] as const) {
      const res = await getJson(`/importer-sources?sort=${sort}&order=asc`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].activeComponentMemberships).toBe(0);
      expect(res.body.data[0].activeInstanceMemberships).toBe(0);
    }

    // Filters.
    const statusFiltered = await getJson("/importer-sources?status=ACTIVE");
    expect(statusFiltered.body.data).toHaveLength(1);
    expect(statusFiltered.body.data[0].externalIdentity).toBe("https://github.com/acme/api");

    const importerFiltered = await getJson("/importer-sources?importerName=aws");
    expect(importerFiltered.body.data).toHaveLength(1);
    expect(importerFiltered.body.data[0].importerName).toBe("aws");

    // Search matches identity or label fragments.
    const searchIdentity = await getJson("/importer-sources?search=acme%2Fweb");
    expect(searchIdentity.body.data).toHaveLength(1);
    expect(searchIdentity.body.data[0].externalIdentity).toBe("https://github.com/acme/web");
    const searchLabel = await getJson("/importer-sources?search=prod-box");
    expect(searchLabel.body.data).toHaveLength(1);
    expect(searchLabel.body.data[0].importerName).toBe("aws");

    // Pagination.
    const page2 = await getJson("/importer-sources?pageSize=2&page=2&sort=name&order=asc");
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.pagination).toMatchObject({ page: 2, total: 3, pageCount: 2, hasNext: false });

    // Strict validation.
    for (const url of [
      "/importer-sources?sort=bogus",
      "/importer-sources?status=bogus",
      "/importer-sources?bogus=1",
      "/importer-sources?pageSize=101",
    ]) {
      const res = await getJson(url);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
    }
  });
});
