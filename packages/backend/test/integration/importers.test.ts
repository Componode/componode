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
      await context.reportSourceIdentity({ externalIdentity: "test-source" });
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
    // F008: configSchema arrives as JSON Schema so the scope editor can
    // surface required keys — `org` must be listed.
    expect(github.configSchema.required).toContain("org");
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

  it("returns field-level detail when importer scope validation fails (F007)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        importerName: "github",
        label: "Bad scope",
        scope: {},
        credentialIds: [],
        schedule: "0 * * * *",
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
    expect(Array.isArray(body["invalid-params"])).toBe(true);
    expect(body["invalid-params"].length).toBeGreaterThan(0);
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
    const listed = JSON.parse(listRes.payload).data.find((c: { id: string }) => c.id === created.id);
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

  // Spec 068 / ADR-130: standardized list contract — envelope, whitelisted
  // sort, filters, search, strict query validation.
  it("GET /importer-configs paginates, filters, and sorts", async () => {
    const createConfig = (label: string, enabled = true) =>
      app.inject({
        method: "POST",
        url: "/api/v1/importer-configs",
        cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
        headers: csrfHeader,
        payload: {
          importerName: "github",
          label,
          scope: { org: "testorg" },
          // github's manifest requires the token secret key.
          secretRefs: [{ key: "token", env: "COMPONODE_TEST_GITHUB_TOKEN" }],
          enabled,
        },
      });
    const a = JSON.parse((await createConfig("alpha-cfg")).payload).config;
    const b = JSON.parse((await createConfig("beta-cfg", false)).payload).config;

    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(listRes.statusCode).toBe(200);
    const body = JSON.parse(listRes.payload);
    expect(body.data).toHaveLength(2);
    expect(body.pagination).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 2,
      pageCount: 1,
      hasNext: false,
    });

    // `name` sorts by the label column.
    const nameRes = await app.inject({
      method: "GET",
      url: "/api/v1/importer-configs?sort=name&order=asc",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(
      JSON.parse(nameRes.payload).data.map((c: { label: string }) => c.label),
    ).toEqual(["alpha-cfg", "beta-cfg"]);

    // Deterministic updatedAt ordering via direct timestamps.
    await testDb!.db
      .updateTable("importer_configs")
      .set({ updatedAt: "2020-01-01T00:00:00.000Z" })
      .where("id", "=", a.id)
      .execute();
    const updRes = await app.inject({
      method: "GET",
      url: "/api/v1/importer-configs?sort=updatedAt&order=asc",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(JSON.parse(updRes.payload).data[0].id).toBe(a.id);

    const impRes = await app.inject({
      method: "GET",
      url: "/api/v1/importer-configs?importerName=github",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(JSON.parse(impRes.payload).data).toHaveLength(2);
    const impNone = await app.inject({
      method: "GET",
      url: "/api/v1/importer-configs?importerName=aws",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(JSON.parse(impNone.payload).data).toHaveLength(0);

    const enabledRes = await app.inject({
      method: "GET",
      url: "/api/v1/importer-configs?enabled=false",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(JSON.parse(enabledRes.payload).data.map((c: { id: string }) => c.id)).toEqual([b.id]);

    const searchRes = await app.inject({
      method: "GET",
      url: "/api/v1/importer-configs?search=beta",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(JSON.parse(searchRes.payload).data.map((c: { id: string }) => c.id)).toEqual([b.id]);

    for (const url of [
      "/api/v1/importer-configs?sort=bogus",
      "/api/v1/importer-configs?order=up",
      "/api/v1/importer-configs?bogus=1",
      "/api/v1/importer-configs?page=abc",
    ]) {
      const res = await app.inject({
        method: "GET",
        url,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe("VALIDATION_FAILED");
    }
  });

  it("GET /importer-configs/:id/runs paginates, filters, and sorts", async () => {
    const configId = uuidv7();
    await testDb!.db
      .insertInto("importer_configs")
      .values({
        id: configId,
        importerName: "github",
        label: "runs-cfg",
        scope: {},
        secretRefs: [],
        enabled: true,
        createdBy: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      })
      .execute();

    const runIds = [uuidv7(), uuidv7(), uuidv7()];
    const statuses = ["COMPLETED", "FAILED", "COMPLETED"] as const;
    for (let i = 0; i < runIds.length; i++) {
      await testDb!.db
        .insertInto("import_runs")
        .values({
          id: runIds[i]!,
          configId,
          status: statuses[i]!,
          startedAt: `2024-02-0${i + 1}T00:00:00.000Z`,
          completedAt: `2024-02-0${i + 1}T01:00:00.000Z`,
          assetsProcessed: 1,
          assetsCreated: 1,
          assetsUpdated: 0,
          instancesOrphaned: 0,
          componentsRetired: 0,
          createdAt: `2024-02-0${i + 1}T00:00:00.000Z`,
        })
        .execute();
    }

    const listRes = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(listRes.statusCode).toBe(200);
    const body = JSON.parse(listRes.payload);
    expect(body.data).toHaveLength(3);
    expect(body.pagination).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 3,
      pageCount: 1,
      hasNext: false,
    });
    // Default sort createdAt desc — newest run first.
    expect(body.data[0].id).toBe(runIds[2]);

    const statusRes = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs?status=FAILED`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const filtered = JSON.parse(statusRes.payload);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].id).toBe(runIds[1]);
    expect(filtered.pagination.total).toBe(1);

    const sortRes = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs?sort=startedAt&order=asc`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(
      JSON.parse(sortRes.payload).data.map((r: { id: string }) => r.id),
    ).toEqual(runIds);

    // FR-005: `assetsProcessed` is a whitelisted sort key (the stored
    // counter behind the run history's "Processed" column).
    const processedRes = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs?sort=assetsProcessed&order=asc`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(processedRes.statusCode).toBe(200);
    expect(JSON.parse(processedRes.payload).data).toHaveLength(3);

    const pageRes = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs?pageSize=2&page=2`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const pageBody = JSON.parse(pageRes.payload);
    expect(pageBody.data).toHaveLength(1);
    expect(pageBody.pagination).toMatchObject({ page: 2, total: 3, hasNext: false });

    for (const url of [
      `/api/v1/importer-configs/${configId}/runs?sort=bogus`,
      `/api/v1/importer-configs/${configId}/runs?status=bogus`,
      `/api/v1/importer-configs/${configId}/runs?bogus=1`,
      // T061: the runs service applies no search filter, so `search` is
      // not part of the contract — strict schema rejects it.
      `/api/v1/importer-configs/${configId}/runs?search=run`,
    ]) {
      const res = await app.inject({
        method: "GET",
        url,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe("VALIDATION_FAILED");
    }
  });

  it("GET run errors and changes paginate with their filters", async () => {
    const configId = uuidv7();
    const runId = uuidv7();
    await testDb!.db
      .insertInto("importer_configs")
      .values({
        id: configId,
        importerName: "github",
        label: "sub-cfg",
        scope: {},
        secretRefs: [],
        enabled: true,
        createdBy: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      })
      .execute();
    await testDb!.db
      .insertInto("import_runs")
      .values({
        id: runId,
        configId,
        status: "FAILED",
        assetsProcessed: 1,
        assetsCreated: 0,
        assetsUpdated: 0,
        instancesOrphaned: 0,
        componentsRetired: 0,
        createdAt: "2024-02-01T00:00:00.000Z",
      })
      .execute();

    const componentId = uuidv7();
    await testDb!.db
      .insertInto("entity_changes")
      .values([
        {
          id: uuidv7(),
          entityType: "component",
          entityId: componentId,
          action: "created",
          changes: { name: "c1" },
          importRunId: runId,
          createdBy: null,
          createdByName: "importer:github",
          createdAt: "2024-02-01T00:00:01.000Z",
        },
        {
          id: uuidv7(),
          entityType: "component",
          entityId: componentId,
          action: "updated",
          changes: { name: "c1" },
          importRunId: runId,
          createdBy: null,
          createdByName: "importer:github",
          createdAt: "2024-02-01T00:00:02.000Z",
        },
      ])
      .execute();

    await testDb!.db
      .insertInto("import_run_errors")
      .values([
        {
          id: uuidv7(),
          runId,
          errorType: "PARSE_ERROR",
          errorMessage: "bad asset",
          createdAt: "2024-02-01T00:00:01.000Z",
        },
        {
          id: uuidv7(),
          runId,
          errorType: "NETWORK_ERROR",
          errorMessage: "timeout",
          createdAt: "2024-02-01T00:00:02.000Z",
        },
      ])
      .execute();

    // Errors endpoint: envelope + errorType filter + createdAt order.
    const errRes = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs/${runId}/errors`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(errRes.statusCode).toBe(200);
    const errBody = JSON.parse(errRes.payload);
    expect(errBody.data).toHaveLength(2);
    expect(errBody.pagination).toMatchObject({ total: 2, page: 1, pageSize: 25 });
    // Default order is createdAt desc.
    expect(errBody.data[0].errorType).toBe("NETWORK_ERROR");

    const errFiltered = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs/${runId}/errors?errorType=PARSE_ERROR`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const errFilteredBody = JSON.parse(errFiltered.payload);
    expect(errFilteredBody.data).toHaveLength(1);
    expect(errFilteredBody.data[0].errorType).toBe("PARSE_ERROR");

    // FR-005: the errors table's stored columns are sortable — errorType
    // and errorMessage produce a deterministic order on this fixture.
    const errTypeRes = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs/${runId}/errors?sort=errorType&order=asc`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(errTypeRes.statusCode).toBe(200);
    expect(
      JSON.parse(errTypeRes.payload).data.map((e: { errorType: string }) => e.errorType),
    ).toEqual(["NETWORK_ERROR", "PARSE_ERROR"]);

    const errMsgRes = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs/${runId}/errors?sort=errorMessage&order=asc`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(errMsgRes.statusCode).toBe(200);
    expect(JSON.parse(errMsgRes.payload).data[0].errorMessage).toBe("bad asset");

    for (const sort of ["assetExternalId", "createdAt"] as const) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/importer-configs/${configId}/runs/${runId}/errors?sort=${sort}&order=asc`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).data).toHaveLength(2);
    }

    // Changes endpoint: envelope + action filter; errors stay top-level.
    const chRes = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs/${runId}/changes`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(chRes.statusCode).toBe(200);
    const chBody = JSON.parse(chRes.payload);
    expect(chBody.data).toHaveLength(2);
    expect(chBody.pagination).toMatchObject({ total: 2 });
    expect(chBody.data[0].action).toBe("updated");
    expect(chBody.errors).toHaveLength(2);

    const chFiltered = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs/${runId}/changes?action=created`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const chFilteredBody = JSON.parse(chFiltered.payload);
    expect(chFilteredBody.data).toHaveLength(1);
    expect(chFilteredBody.data[0].action).toBe("created");
    expect(chFilteredBody.pagination.total).toBe(1);

    // FR-005: the changes table's stored columns are sortable — `action`
    // orders created before updated ascending (distinct from the
    // createdAt default on this fixture's tie-broken ids).
    const chActionRes = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs/${runId}/changes?sort=action&order=asc`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(chActionRes.statusCode).toBe(200);
    expect(JSON.parse(chActionRes.payload).data[0].action).toBe("created");

    for (const sort of ["entityType", "actor", "createdAt"] as const) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/importer-configs/${configId}/runs/${runId}/changes?sort=${sort}&order=desc`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).data).toHaveLength(2);
    }

    for (const url of [
      `/api/v1/importer-configs/${configId}/runs/${runId}/errors?sort=bogus`,
      `/api/v1/importer-configs/${configId}/runs/${runId}/changes?sort=bogus`,
      `/api/v1/importer-configs/${configId}/runs/${runId}/changes?bogus=1`,
      // T061: neither sub-list service applies a search filter, so
      // `search` is rejected as an unknown param on both endpoints.
      `/api/v1/importer-configs/${configId}/runs/${runId}/errors?search=x`,
      `/api/v1/importer-configs/${configId}/runs/${runId}/changes?search=x`,
    ]) {
      const res = await app.inject({
        method: "GET",
        url,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe("VALIDATION_FAILED");
    }
  });
});
