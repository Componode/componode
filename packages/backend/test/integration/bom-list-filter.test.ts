import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME, truncateImportTables } from "../helpers/api.js";
import type { processBomEntries as processBomEntriesT } from "../../src/services/bom-service.js";

let processBomEntries: typeof processBomEntriesT;

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const now = () => new Date().toISOString();

/** Spec 073 US6: the Components list BOM filter (Has BOM / No BOM) and the
 * dashboard's componentsWithBom coverage line (FR-026). */
describe("components BOM filter + dashboard line (spec 073 US6)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  const saved: Record<string, string | undefined> = {};

  let withBomId = "";
  let withoutBomId = "";

  beforeAll(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"])
      saved[k] = process.env[k];
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
    ({ processBomEntries } = await import("../../src/services/bom-service.js"));

    await truncateImportTables(testDb.db);
    withBomId = uuidv7();
    withoutBomId = uuidv7();
    const sourceId = uuidv7();
    const runId = uuidv7();
    for (const [id, slug] of [[withBomId, "with-bom"], [withoutBomId, "without-bom"]] as const) {
      await testDb.db.insertInto("components").values({
        id, name: slug, slug, category: "REPOSITORY", provider: "GITHUB",
        resourceType: "github:repository", lifecycle: "ACTIVE",
        teamOwnerId: null, externalId: slug, details: null, sunsetAt: null,
        lastSeenAt: null, lastSeenInRunId: null,
        createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
      } as never).execute();
    }
    await testDb.db.insertInto("importer_sources").values({
      id: sourceId, importerName: "github", externalIdentity: "org/repo",
      label: null, status: "ACTIVE", boundConfigId: null,
      firstSeenInRunId: null, lastSeenInRunId: null,
      createdAt: now(), updatedAt: now(),
    }).execute();
    await testDb.db.insertInto("import_runs").values({
      id: runId, configId: null, sourceId: null, status: "COMPLETED",
      assetsProcessed: 0, assetsCreated: 0, assetsUpdated: 0,
      instancesOrphaned: 0, componentsRetired: 0, createdAt: now(),
    } as never).execute();
    await testDb.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId: withBomId,
        componentInstanceId: null,
        sourceId,
        runId,
        entries: [{
          purl: "pkg:npm/lodash@4.17.21", name: "lodash", version: "4.17.21",
          scope: "RUNTIME", evidenceSource: "LOCK_FILE",
        }],
      }),
    );
  });

  afterAll(async () => {
    if (app) await app.close();
    await testDb.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  const get = (url: string) =>
    app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE_NAME]: adminSession } });

  it("bom=has lists only BOM-bearing components; bom=none lists the rest", async () => {
    const has = await get("/api/v1/components?bom=has&pageSize=100");
    expect(has.statusCode).toBe(200);
    const hasIds = has.json().data.map((c: any) => c.id);
    expect(hasIds).toContain(withBomId);
    expect(hasIds).not.toContain(withoutBomId);

    const none = await get("/api/v1/components?bom=none&pageSize=100");
    const noneIds = none.json().data.map((c: any) => c.id);
    expect(noneIds).toContain(withoutBomId);
    expect(noneIds).not.toContain(withBomId);
  });

  it("rejects an unknown bom value (strict query)", async () => {
    const res = await get("/api/v1/components?bom=maybe");
    expect(res.statusCode).toBe(400);
  });

  it("dashboard coverage reports componentsWithBom", async () => {
    const res = await get("/api/v1/dashboard/summary");
    expect(res.statusCode).toBe(200);
    const withBom = res.json().coverage?.components?.withBom;
    expect(withBom).toBeGreaterThanOrEqual(1);
  });
});
