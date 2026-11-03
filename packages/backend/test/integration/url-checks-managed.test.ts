import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  createPersonInDb,
  createSessionInDb,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
} from "../helpers/api.js";

// Spec 058 — managed URL Check sync: ImporterConfig scope is canonical,
// url_checks materialize scheduler state, check outcomes drive monitored
// instance status, config lifecycle pauses/resumes owners.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

const now = () => new Date().toISOString();

const def = (overrides: Record<string, unknown> = {}) => ({
  checkKey: uuidv7(),
  name: "Availability",
  method: "GET",
  enabled: true,
  successPolicy: { codes: [], ranges: [{ min: 200, max: 299 }] },
  authMode: "NONE",
  ...overrides,
});

const collectionScope = (
  componentKey: string,
  instanceKey: string,
  check: Record<string, unknown>,
) => ({
  sourceKey: uuidv7(),
  components: [
    {
      componentKey,
      name: "Storefront",
      instances: [
        {
          instanceKey,
          environment: "PRODUCTION",
          url: "https://example.com/",
          check,
        },
      ],
    },
  ],
});

async function seedConfigAndSource(
  db: TestDb["db"],
  scope: Record<string, unknown>,
  { enabled = true, sourceStatus = "ACTIVE" } = {},
) {
  const configId = uuidv7();
  await db
    .insertInto("importer_configs")
    .values({
      id: configId,
      importerName: "web-url",
      label: "Web collection",
      scope: JSON.stringify(scope),
      secretRefs: null,
      agentId: null,
      schedule: null,
      enabled,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
    } as any)
    .execute();
  const sourceId = uuidv7();
  await db
    .insertInto("importer_sources")
    .values({
      id: sourceId,
      importerName: "web-url",
      externalIdentity: `collection:${(scope as { sourceKey: string }).sourceKey}`,
      label: "Web collection",
      status: sourceStatus,
      boundConfigId: configId,
      firstSeenInRunId: null,
      lastSeenInRunId: null,
      createdAt: now(),
      updatedAt: now(),
    } as any)
    .execute();
  const runId = uuidv7();
  await db
    .insertInto("import_runs")
    .values({
      id: runId,
      configId,
      sourceId,
      agentId: null,
      status: "RUNNING",
      triggeredBy: null,
      startedAt: now(),
      completedAt: null,
      assetsProcessed: 0,
      assetsCreated: 0,
      assetsUpdated: 0,
      instancesOrphaned: 0,
      componentsRetired: 0,
      currentPhase: null,
      cancelRequestedAt: null,
      cancelReason: null,
      credentialIds: null,
      errorMessage: null,
      errorStack: null,
      errorType: null,
      createdAt: now(),
    } as any)
    .execute();
  return { configId, sourceId, runId };
}

describe("managed url checks (spec 058)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let processAsset: any;
  let db: any;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;

    const { bootstrapAdmin } =
      await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    const { loginAs } = await import("../helpers/api.js");
    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD))!;
    db = (await import("../../src/db/connection.js")).db;
    processAsset = (
      await import("../../src/services/import-run-service.js")
    ).processAsset;
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
  });

  const authed = (session: string) => ({
    cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
    headers: csrfHeader,
  });

  it("materializes a managed check inside the asset transaction", async () => {
    const { managedCheckDefsFromScope } =
      await import("../../src/services/import-run-service.js");
    const componentKey = uuidv7();
    const instanceKey = uuidv7();
    const check = def();
    const scope = collectionScope(componentKey, instanceKey, check);
    const { sourceId, runId } = await seedConfigAndSource(testDb.db, scope);

    const asset = {
      category: "WEB_ENDPOINT",
      provider: "WEB_URL",
      resourceType: "web:url",
      name: "Storefront",
      externalId: componentKey,
      instances: [
        {
          environment: "PRODUCTION",
          externalId: instanceKey,
          url: "https://example.com/",
          status: "RUNNING",
        },
      ],
    };
    const result = await db.transaction().execute(async (trx: any) =>
      processAsset(trx, runId, "web-url", asset, null, {
        sourceId,
        sourceIdentity: `collection:${scope.sourceKey}`,
        configId: null,
      }, managedCheckDefsFromScope(scope)),
    );
    expect(result.created).toBe(true);

    const row = await testDb.db
      .selectFrom("url_checks")
      .selectAll()
      .where("managedKey", "=", check.checkKey)
      .executeTakeFirst();
    expect(row).toBeTruthy();
    expect(row!.url).toBe("https://example.com/");
    expect(row!.enabled).toBe(true);
    expect(row!.nextProbeAt).toBeTruthy();

    const membership = await testDb.db
      .selectFrom("source_url_check_memberships")
      .selectAll()
      .where("urlCheckId", "=", row!.id)
      .where("sourceId", "=", sourceId)
      .executeTakeFirst();
    expect(membership).toBeTruthy();
    expect(membership!.configuredEnabled).toBe(true);
  });

  it("shared checkKey across Sources keeps one check schedulable; last owner drop pauses it", async () => {
    const { managedCheckDefsFromScope } =
      await import("../../src/services/import-run-service.js");
    const componentKey = uuidv7();
    const instanceKey = uuidv7();
    const check = def();
    const scope = collectionScope(componentKey, instanceKey, check);
    const a = await seedConfigAndSource(testDb.db, scope);
    const b = await seedConfigAndSource(testDb.db, {
      ...scope,
      sourceKey: uuidv7(),
    });
    // Second source on a *different* component instance pair shares the checkKey.
    const scopeB = collectionScope(uuidv7(), uuidv7(), check);
    const assetFor = (ck: string, ik: string) => ({
      category: "WEB_ENDPOINT",
      provider: "WEB_URL",
      resourceType: "web:url",
      name: "S",
      externalId: ck,
      instances: [
        {
          environment: "PRODUCTION",
          externalId: ik,
          url: "https://example.com/",
          status: "RUNNING",
        },
      ],
    });
    await db.transaction().execute(async (trx: any) =>
      processAsset(trx, a.runId, "web-url", assetFor(componentKey, instanceKey), null, {
        sourceId: a.sourceId,
        sourceIdentity: "collection:a",
        configId: null,
      }, managedCheckDefsFromScope(scope)),
    );
    // Source B declares the same checkKey on its own instance — shared check.
    const existing = await testDb.db
      .selectFrom("url_checks")
      .selectAll()
      .where("managedKey", "=", check.checkKey)
      .executeTakeFirstOrThrow();
    const { syncManagedCheck } =
      await import("../../src/services/url-check-service.js");
    await db.transaction().execute(async (trx: any) =>
      syncManagedCheck(trx, {
        sourceId: b.sourceId,
        componentId: existing.componentInstanceId
          ? (
              await trx
                .selectFrom("component_instances")
                .select("componentId")
                .where("id", "=", existing.componentInstanceId)
                .executeTakeFirstOrThrow()
            ).componentId
          : null,
        componentInstanceId: existing.componentInstanceId,
        instanceUrl: "https://example.com/",
        def: { ...check, checkKey: check.checkKey, name: check.name, url: check.url ?? "https://example.com/" },
        runId: b.runId,
        actor: { id: null, name: "test" },
      }),
    );
    const owners = await testDb.db
      .selectFrom("source_url_check_memberships")
      .selectAll()
      .where("urlCheckId", "=", existing.id)
      .where("active", "=", true)
      .execute();
    expect(owners.length).toBe(2);

    // Disable config A — the shared check stays enabled via owner B.
    const { updateImporterConfig } =
      await import("../../src/services/importer-config-service.js");
    await updateImporterConfig(a.configId, { enabled: false }, {
      id: null,
      name: "test",
    });
    const after = await testDb.db
      .selectFrom("url_checks")
      .selectAll()
      .where("id", "=", existing.id)
      .executeTakeFirstOrThrow();
    expect(after.enabled).toBe(true);

    // Disable config B — no effective owner remains, check pauses.
    await updateImporterConfig(b.configId, { enabled: false }, {
      id: null,
      name: "test",
    });
    const paused = await testDb.db
      .selectFrom("url_checks")
      .selectAll()
      .where("id", "=", existing.id)
      .executeTakeFirstOrThrow();
    expect(paused.enabled).toBe(false);
    expect(paused.nextProbeAt).toBeNull();
  });

  it("check-observed instance ignores importer status (spec 058 FR-015)", async () => {
    const { managedCheckDefsFromScope } =
      await import("../../src/services/import-run-service.js");
    const componentKey = uuidv7();
    const instanceKey = uuidv7();
    const check = def();
    const scope = collectionScope(componentKey, instanceKey, check);
    const { sourceId, runId } = await seedConfigAndSource(testDb.db, scope);
    const asset = (status: string) => ({
      category: "WEB_ENDPOINT",
      provider: "WEB_URL",
      resourceType: "web:url",
      name: "S",
      externalId: componentKey,
      instances: [
        {
          environment: "PRODUCTION",
          externalId: instanceKey,
          url: "https://example.com/",
          status,
        },
      ],
    });
    const source = {
      sourceId,
      sourceIdentity: "collection:s",
      configId: null,
    };
    const defs = managedCheckDefsFromScope(scope)!;

    // First run seeds the importer-reported status.
    await db.transaction().execute(async (trx: any) =>
      processAsset(
        trx, runId, "web-url", asset("ERROR"), null, source, defs,
      ),
    );
    const inst = () =>
      testDb.db
        .selectFrom("component_instances")
        .selectAll()
        .where("externalId", "=", instanceKey)
        .executeTakeFirstOrThrow();
    expect((await inst()).status).toBe("ERROR");

    // The managed check observed FAILURE � its outcomes own the status.
    const checkRow = await testDb.db
      .selectFrom("url_checks")
      .selectAll()
      .where("managedKey", "=", check.checkKey)
      .executeTakeFirstOrThrow();
    await testDb.db
      .insertInto("url_check_observations")
      .values({
        id: uuidv7(),
        urlCheckId: checkRow.id,
        scheduledAt: now(),
        outcome: "FAILURE",
        httpStatus: 500,
        durationMs: null,
        errorType: "HTTP_STATUS",
        vantage: "HUB",
        agentId: null,
      } as any)
      .execute();

    // A later importer report must not overwrite the check-owned status.
    await db.transaction().execute(async (trx: any) =>
      processAsset(
        trx, runId, "web-url", asset("RUNNING"), null, source, defs,
      ),
    );
    expect((await inst()).status).toBe("ERROR");
    const changes = await testDb.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityType", "=", "component_instance")
      .where("action", "=", "status_change")
      .where("importRunId", "=", runId)
      .execute();
    expect(changes).toHaveLength(0);
  });
});
