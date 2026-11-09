import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  SESSION_COOKIE_NAME,
  createPersonInDb,
  createSessionInDb,
} from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("audit per-entity and per-run history", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let viewerSession: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"]) {
      saved[k] = process.env[k];
    }
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

    const adminRow = await testDb.db
      .selectFrom("persons")
      .select(["id"])
      .where("username", "=", ADMIN_USERNAME)
      .executeTakeFirstOrThrow();
    adminSession = (await createSessionInDb(testDb.db, adminRow.id)).token;

    const viewerId = await createPersonInDb(testDb.db, {
      username: "viewer-history",
      passwordHash: "$argon2id$dummy",
      role: "VIEWER",
    });
    viewerSession = (await createSessionInDb(testDb.db, viewerId)).token;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("GET /api/v1/audit/entities/:type/:id returns only that entity's changes", async () => {
    const productA = uuidv7();
    const productB = uuidv7();

    await testDb.db
      .insertInto("entity_changes")
      .values([
        {
          id: uuidv7(),
          entityType: "digital_product",
          entityId: productA,
          action: "updated",
          changes: { name: "A" },
          createdBy: null,
          createdByName: "admin",
          createdAt: new Date().toISOString(),
        },
        {
          id: uuidv7(),
          entityType: "digital_product",
          entityId: productA,
          action: "lifecycle",
          changes: { lifecycle: "RETIRED" },
          createdBy: null,
          createdByName: "admin",
          createdAt: new Date(Date.now() + 1000).toISOString(),
        },
        {
          id: uuidv7(),
          entityType: "digital_product",
          entityId: productB,
          action: "updated",
          changes: { name: "B" },
          createdBy: null,
          createdByName: "admin",
          createdAt: new Date().toISOString(),
        },
      ])
      .execute();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/audit/entities/digital_product/${productA}`,
      cookies: { [SESSION_COOKIE_NAME]: viewerSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pagination.total).toBe(2);
    expect(body.data.every((i: { entityId: string }) => i.entityId === productA)).toBe(true);
    expect(body.data[0].action).toBe("lifecycle");
    expect(body.data[1].action).toBe("updated");
  });

  it("survives deleted actor and still shows recorded name", async () => {
    const actorId = await createPersonInDb(testDb.db, {
      username: "deleted-actor",
      passwordHash: "$argon2id$dummy",
      role: "EDITOR",
      displayName: "Deleted Actor",
    });
    const productId = uuidv7();

    await testDb.db
      .insertInto("entity_changes")
      .values({
        id: uuidv7(),
        entityType: "digital_product",
        entityId: productId,
        action: "updated",
        changes: { name: "With Actor" },
        createdBy: actorId,
        createdByName: "Deleted Actor",
        createdAt: new Date().toISOString(),
      })
      .execute();

    await testDb.db.deleteFrom("persons").where("id", "=", actorId).execute();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/audit/entities/digital_product/${productId}`,
      cookies: { [SESSION_COOKIE_NAME]: viewerSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pagination.total).toBe(1);
    expect(body.data[0].createdByName).toBe("Deleted Actor");
  });

  it("GET /api/v1/importer-configs/:configId/runs/:runId/changes returns run changes and errors", async () => {
    const configId = uuidv7();
    const runId = uuidv7();

    await testDb.db
      .insertInto("importer_configs")
      .values({
        id: configId,
        importerName: "aws",
        label: "aws",
        scope: { accounts: [] },
        secretRefs: [],
        enabled: true,
        createdBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .execute();

    await testDb.db
      .insertInto("import_runs")
      .values({
        id: runId,
        configId,
        status: "COMPLETED",
        assetsProcessed: 1,
        assetsCreated: 1,
        assetsUpdated: 0,
        instancesOrphaned: 0,
        componentsRetired: 0,
        createdAt: new Date().toISOString(),
      })
      .execute();

    const componentId = uuidv7();
    await testDb.db
      .insertInto("entity_changes")
      .values({
        id: uuidv7(),
        entityType: "component",
        entityId: componentId,
        action: "created",
        changes: { name: "Imported Component" },
        importRunId: runId,
        createdBy: null,
        createdByName: "importer:aws",
        createdAt: new Date().toISOString(),
      })
      .execute();

    await testDb.db
      .insertInto("import_run_errors")
      .values({
        id: uuidv7(),
        runId,
        assetExternalId: "missing",
        errorType: "PARSE_ERROR",
        errorMessage: "Could not parse",
        createdAt: new Date().toISOString(),
      })
      .execute();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${configId}/runs/${runId}/changes`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].action).toBe("created");
    expect(body.data[0].createdByName).toBe("importer:aws");
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 25, total: 1 });
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].errorType).toBe("PARSE_ERROR");
  });

  it("returns an empty state for entities with no history", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/audit/entities/digital_product/${uuidv7()}`,
      cookies: { [SESSION_COOKIE_NAME]: viewerSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/audit/entities/digital_product/${uuidv7()}`,
    });
    expect(res.statusCode).toBe(401);
  });

  // Spec 068 / ADR-130: entity history is the same SQL UNION scoped to one
  // entity — entity_changes on (entityType, entityId) plus edge_changes
  // touching it at either endpoint — paginated database-side.
  it("paginates per-entity history across entity_changes and edge_changes", async () => {
    const entityId = uuidv7();
    const otherId = uuidv7();
    const t = new Date("2026-10-05T10:00:00.000Z").getTime();
    const at = (offsetMs: number) => new Date(t + offsetMs).toISOString();

    const entityRows = [
      { action: "hist-a", offset: 0 },
      { action: "hist-b", offset: 200_000 },
      { action: "hist-c", offset: 400_000 },
    ].map((r) => ({
      id: uuidv7(),
      entityType: "digital_product",
      entityId,
      action: r.action,
      changes: null,
      importRunId: null,
      createdBy: null,
      createdByName: "historian",
      createdAt: at(r.offset),
    }));
    const edgeSpecs = [
      // entity as the FROM endpoint
      {
        action: "edge-from",
        offset: 100_000,
        fromType: "digital_product",
        fromId: entityId,
        toType: "component",
        toId: otherId,
      },
      // entity as the TO endpoint
      {
        action: "edge-to",
        offset: 300_000,
        fromType: "component",
        fromId: otherId,
        toType: "digital_product",
        toId: entityId,
      },
      // entity as FROM again
      {
        action: "edge-from-2",
        offset: 500_000,
        fromType: "digital_product",
        fromId: entityId,
        toType: "component",
        toId: otherId,
      },
      // control: touches neither endpoint — must not appear
      {
        action: "edge-unrelated",
        offset: 600_000,
        fromType: "digital_product",
        fromId: uuidv7(),
        toType: "component",
        toId: uuidv7(),
      },
    ];
    const edgeRows = edgeSpecs.map((r) => ({
      id: uuidv7(),
      edgeType: "DEPENDS_ON_COMPONENT",
      fromEntityType: r.fromType,
      fromEntityId: r.fromId,
      toEntityType: r.toType,
      toEntityId: r.toId,
      action: r.action,
      reason: null,
      createdBy: null,
      createdByName: "historian",
      createdAt: at(r.offset),
    }));

    await testDb.db
      .insertInto("entity_changes")
      .values(entityRows as never)
      .execute();
    await testDb.db
      .insertInto("edge_changes")
      .values(edgeRows as never)
      .execute();

    // createdAt desc across the UNION: edge-from-2(500) hist-c(400)
    // edge-to(300) hist-b(200) edge-from(100) hist-a(0) — the unrelated
    // edge at +600 is excluded by the entity scope.
    const expected = [
      "edge-from-2",
      "hist-c",
      "edge-to",
      "hist-b",
      "edge-from",
      "hist-a",
    ];
    const kinds = ["edge", "entity", "edge", "entity", "edge", "entity"];

    const seen: { action: string; kind: string }[] = [];
    for (const page of [1, 2, 3]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/audit/entities/digital_product/${entityId}?page=${page}&pageSize=2`,
        cookies: { [SESSION_COOKIE_NAME]: viewerSession },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pagination.total).toBe(6);
      expect(body.pagination.pageCount).toBe(3);
      for (const item of body.data) {
        seen.push({ action: item.action, kind: item.kind });
      }
    }
    expect(seen.map((s) => s.action)).toEqual(expected);
    expect(seen.map((s) => s.kind)).toEqual(kinds);

    // kind=entity narrows the union to the entity_changes branch.
    const entityOnly = await app.inject({
      method: "GET",
      url: `/api/v1/audit/entities/digital_product/${entityId}?kind=entity&pageSize=25`,
      cookies: { [SESSION_COOKIE_NAME]: viewerSession },
    });
    expect(entityOnly.statusCode).toBe(200);
    const eo = entityOnly.json();
    expect(eo.pagination.total).toBe(3);
    expect(eo.data.map((i: any) => i.action)).toEqual([
      "hist-c",
      "hist-b",
      "hist-a",
    ]);
  });

  // Spec 068 T059 / FR-005: entity history shares the activity feed's
  // sort whitelist — `kind`/`entityType` order the scoped UNION the same
  // way (edge rows sort by their FROM endpoint's type).
  it("sorts per-entity history by kind and entityType", async () => {
    const entityId = uuidv7();
    const otherId = uuidv7();
    const t = new Date("2026-10-06T10:00:00.000Z").getTime();
    const at = (offsetMs: number) => new Date(t + offsetMs).toISOString();
    const actor = { createdBy: null, createdByName: "history-sort" };

    const entH1 = {
      id: uuidv7(), entityType: "digital_product", entityId,
      action: "hh-a", changes: null, importRunId: null,
      ...actor, createdAt: at(100_000),
    };
    // Entity is the TO endpoint — badge type comes from fromEntityType.
    const edgeH1 = {
      id: uuidv7(), edgeType: "DEPENDS_ON_COMPONENT",
      fromEntityType: "component", fromEntityId: otherId,
      toEntityType: "digital_product", toEntityId: entityId,
      action: "hh-b", reason: null, ...actor, createdAt: at(200_000),
    };
    const entH2 = {
      id: uuidv7(), entityType: "digital_product", entityId,
      action: "hh-c", changes: null, importRunId: null,
      ...actor, createdAt: at(300_000),
    };
    // Entity is the FROM endpoint — coalesce picks 'digital_product'.
    const edgeH2 = {
      id: uuidv7(), edgeType: "COMPOSES",
      fromEntityType: "digital_product", fromEntityId: entityId,
      toEntityType: "component", toEntityId: otherId,
      action: "hh-d", reason: null, ...actor, createdAt: at(400_000),
    };
    await testDb.db
      .insertInto("entity_changes")
      .values([entH1, entH2] as never)
      .execute();
    await testDb.db
      .insertInto("edge_changes")
      .values([edgeH1, edgeH2] as never)
      .execute();

    const feed = async (qs: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/audit/entities/digital_product/${entityId}?${qs}`,
        cookies: { [SESSION_COOKIE_NAME]: viewerSession },
      });
      expect(res.statusCode).toBe(200);
      return res.json().data.map((i: any) => i.id);
    };
    const ids = { entH1, entH2, edgeH1, edgeH2 };

    // kind asc: edges (createdAt desc) then entities (createdAt desc).
    expect(await feed("sort=kind&order=asc&pageSize=25")).toEqual([
      ids.edgeH2.id, ids.edgeH1.id, ids.entH2.id, ids.entH1.id,
    ]);
    expect(await feed("sort=kind&order=desc&pageSize=25")).toEqual([
      ids.entH2.id, ids.entH1.id, ids.edgeH2.id, ids.edgeH1.id,
    ]);

    // entityType asc on coalesce(entityType, fromEntityType):
    // 'component' → edgeH1; 'digital_product' → edgeH2(400s), entH2(300s),
    // entH1(100s) by createdAt desc.
    expect(await feed("sort=entityType&order=asc&pageSize=25")).toEqual([
      ids.edgeH1.id, ids.edgeH2.id, ids.entH2.id, ids.entH1.id,
    ]);
    expect(await feed("sort=entityType&order=desc&pageSize=25")).toEqual([
      ids.edgeH2.id, ids.entH2.id, ids.entH1.id, ids.edgeH1.id,
    ]);
  });

  it("rejects the inert search param on entity history (T061 / FR-006)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/audit/entities/digital_product/${uuidv7()}?search=x`,
      cookies: { [SESSION_COOKIE_NAME]: viewerSession },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});
