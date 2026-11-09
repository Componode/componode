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

describe("audit activity feed", () => {
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
      username: "viewer-feed",
      passwordHash: "$argon2id$dummy",
      role: "VIEWER",
    });
    viewerSession = (await createSessionInDb(testDb.db, viewerId)).token;

    const adminId = adminRow;

    const productId = uuidv7();
    const componentId = uuidv7();

    // Seed entity changes across different types, actions, actors, and timestamps.
    const baseTime = new Date("2026-09-08T10:00:00.000Z").getTime();
    await testDb.db
      .insertInto("entity_changes")
      .values([
        {
          id: uuidv7(),
          entityType: "digital_product",
          entityId: productId,
          action: "updated",
          changes: { name: "Alpha Product" },
          createdBy: adminId.id,
          createdByName: "admin",
          createdAt: new Date(baseTime + 0).toISOString(),
        },
        {
          id: uuidv7(),
          entityType: "component",
          entityId: componentId,
          action: "created",
          changes: { name: "Lambda" },
          createdBy: adminId.id,
          createdByName: "admin",
          createdAt: new Date(baseTime + 60_000).toISOString(),
        },
        {
          id: uuidv7(),
          entityType: "component_group",
          entityId: uuidv7(),
          action: "updated",
          changes: { name: "Group A" },
          createdBy: null,
          createdByName: "system",
          createdAt: new Date(baseTime + 120_000).toISOString(),
        },
        {
          id: uuidv7(),
          entityType: "settings",
          entityId: null,
          action: "updated",
          changes: { allowSelfRegistration: true },
          createdBy: adminId.id,
          createdByName: "admin",
          createdAt: new Date(baseTime + 180_000).toISOString(),
        },
        {
          id: uuidv7(),
          entityType: "auth",
          entityId: null,
          action: "login",
          changes: null,
          createdBy: adminId.id,
          createdByName: "admin",
          createdAt: new Date(baseTime + 240_000).toISOString(),
        },
      ])
      .execute();

    await testDb.db
      .insertInto("edge_changes")
      .values({
        id: uuidv7(),
        edgeType: "COMPOSES",
        fromEntityType: "digital_product",
        fromEntityId: uuidv7(),
        toEntityType: "digital_product",
        toEntityId: productId,
        action: "added",
        reason: null,
        createdBy: adminId.id,
        createdByName: "admin",
        createdAt: new Date(baseTime + 300_000).toISOString(),
      })
      .execute();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("GET /api/v1/audit/activity returns merged reverse-chronological feed", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(6);
    expect(body.pagination.total).toBe(6);
    // Newest first
    expect(body.data[0].action).toBe("added");
    expect(body.data[1].action).toBe("login");
    expect(body.data[5].action).toBe("updated");
    expect(body.data[0].kind).toBe("edge");
    expect(body.data[1].kind).toBe("entity");
  });

  it("supports pagination via page and pageSize", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity?page=2&pageSize=2",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.pagination.total).toBe(6);
    expect(body.data[0].createdAt >= body.data[1].createdAt).toBe(true);
  });

  it("filters by kind", async () => {
    const entityRes = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity?kind=entity",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(entityRes.statusCode).toBe(200);
    const entityBody = entityRes.json();
    expect(entityBody.data.every((i: { kind: string }) => i.kind === "entity")).toBe(true);
    expect(entityBody.pagination.total).toBe(5);

    const edgeRes = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity?kind=edge",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(edgeRes.statusCode).toBe(200);
    const edgeBody = edgeRes.json();
    expect(edgeBody.data.every((i: { kind: string }) => i.kind === "edge")).toBe(true);
    expect(edgeBody.pagination.total).toBe(1);
  });

  it("filters by entityType", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity?entityType=digital_product",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pagination.total).toBe(2); // entity + edge where from/to matches
  });

  it("filters by action", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity?action=updated",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.every((i: { action: string }) => i.action === "updated")).toBe(true);
    expect(body.pagination.total).toBe(3);
  });

  it("filters by actor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity?actor=system",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pagination.total).toBe(1);
    expect(body.data[0].createdByName).toBe("system");
  });

  it("filters by date range", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity?from=2026-09-08T10:02:00.000Z&to=2026-09-08T10:04:00.000Z",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pagination.total).toBe(3);
    // Should be component_group, settings, login (between 10:02 and 10:04 inclusive)
    expect(body.data[0].action).toBe("login");
    expect(body.data[2].action).toBe("updated");
  });

  it("denies non-admin access to the activity feed", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity",
      cookies: { [SESSION_COOKIE_NAME]: viewerSession },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("AUTH_FORBIDDEN");
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity",
    });
    expect(res.statusCode).toBe(401);
  });

  // Spec 068 / ADR-130 (research D10): the feed is a SQL UNION ALL of
  // entity_changes + edge_changes — sort, LIMIT/OFFSET and COUNT all run
  // database-side, so pages interleave both sources correctly.
  it("paginates the UNION feed across entity_changes and edge_changes", async () => {
    const t = new Date("2026-09-08T11:00:00.000Z").getTime();
    const entityRow = (
      action: string,
      actor: string | null,
      offsetMs: number,
    ) => ({
      id: uuidv7(),
      entityType: "component",
      entityId: uuidv7(),
      action,
      changes: null,
      importRunId: null,
      createdBy: null,
      createdByName: actor,
      createdAt: new Date(t + offsetMs).toISOString(),
    });
    const edgeRow = (
      action: string,
      actor: string | null,
      offsetMs: number,
    ) => ({
      id: uuidv7(),
      edgeType: "DEPENDS_ON_COMPONENT",
      fromEntityType: "digital_product",
      fromEntityId: uuidv7(),
      toEntityType: "component",
      toEntityId: uuidv7(),
      action,
      reason: null,
      createdBy: null,
      createdByName: actor,
      createdAt: new Date(t + offsetMs).toISOString(),
    });

    // Interleaved entity/edge rows, all newer than the beforeAll seed —
    // they occupy the top of the feed deterministically.
    const seeded = {
      eA: entityRow("sort-a", "zoe", 300_000),
      dB: edgeRow("sort-b", null, 350_000),
      eC: entityRow("sort-c", "mike", 400_000),
      dD: edgeRow("sort-d", "amy", 450_000),
      eE: entityRow("sort-e", "Zed", 500_000),
      dF: edgeRow("sort-f", "uma", 550_000),
      eG: entityRow("sort-g", "vic", 600_000),
    };
    await testDb.db
      .insertInto("entity_changes")
      .values([seeded.eA, seeded.eC, seeded.eE, seeded.eG] as never)
      .execute();
    await testDb.db
      .insertInto("edge_changes")
      .values([seeded.dB, seeded.dD, seeded.dF] as never)
      .execute();

    // createdAt desc across the UNION: g f e d | c b a + old-edge | …
    const p1 = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity?page=1&pageSize=4",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(p1.statusCode).toBe(200);
    const b1 = p1.json();
    expect(b1.data.map((i: any) => i.id)).toEqual([
      seeded.eG.id,
      seeded.dF.id,
      seeded.eE.id,
      seeded.dD.id,
    ]);
    expect(b1.data.map((i: any) => i.kind)).toEqual([
      "entity",
      "edge",
      "entity",
      "edge",
    ]);
    expect(b1.pagination).toMatchObject({
      page: 1,
      pageSize: 4,
      total: 13,
      pageCount: 4,
      hasNext: true,
    });

    const p2 = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity?page=2&pageSize=4",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const b2 = p2.json();
    expect(b2.data.map((i: any) => i.id).slice(0, 3)).toEqual([
      seeded.eC.id,
      seeded.dB.id,
      seeded.eA.id,
    ]);
    // 4th slot continues into the beforeAll seed (its edge row is newest there).
    expect(b2.data[3].kind).toBe("edge");
    expect(b2.data[3].action).toBe("added");
    expect(b2.pagination.total).toBe(13);

    const p4 = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity?page=4&pageSize=4",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const b4 = p4.json();
    expect(b4.data).toHaveLength(1);
    expect(b4.pagination.hasNext).toBe(false);
  });

  it("sorts the UNION feed by whitelisted action/actor keys", async () => {
    // Same seeded window — from/to isolates it from the beforeAll rows.
    const window = "from=2026-09-08T11:00:00.000Z&to=2026-09-08T11:59:59.999Z";
    const feed = async (qs: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/audit/activity?${window}&${qs}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      expect(res.statusCode).toBe(200);
      return res.json();
    };
    const seeded = await testDb.db
      .selectFrom("entity_changes")
      .select(["id", "action", "createdByName"])
      .where("action", "like", "sort-%")
      .execute();
    const seededEdges = await testDb.db
      .selectFrom("edge_changes")
      .select(["id", "action", "createdByName"])
      .where("action", "like", "sort-%")
      .execute();
    const byAction = new Map(
      [...seeded, ...seededEdges].map((r) => [r.action, r.id]),
    );

    const actionAsc = await feed("sort=action&order=asc&pageSize=25");
    expect(actionAsc.pagination.total).toBe(7);
    expect(actionAsc.data.map((i: any) => i.id)).toEqual([
      byAction.get("sort-a"),
      byAction.get("sort-b"),
      byAction.get("sort-c"),
      byAction.get("sort-d"),
      byAction.get("sort-e"),
      byAction.get("sort-f"),
      byAction.get("sort-g"),
    ]);

    const actionDesc = await feed("sort=action&order=desc&pageSize=25");
    expect(actionDesc.data.map((i: any) => i.id)).toEqual([
      byAction.get("sort-g"),
      byAction.get("sort-f"),
      byAction.get("sort-e"),
      byAction.get("sort-d"),
      byAction.get("sort-c"),
      byAction.get("sort-b"),
      byAction.get("sort-a"),
    ]);

    // actor asc: NULL actor → '' first, then case-insensitive names
    // (Zed→zed sorts between uma and zoe).
    const actorAsc = await feed("sort=actor&order=asc&pageSize=25");
    expect(actorAsc.data.map((i: any) => i.id)).toEqual([
      byAction.get("sort-b"), // null actor → ''
      byAction.get("sort-d"), // amy
      byAction.get("sort-c"), // mike
      byAction.get("sort-f"), // uma
      byAction.get("sort-g"), // vic
      byAction.get("sort-e"), // Zed → zed
      byAction.get("sort-a"), // zoe
    ]);

    const actorDesc = await feed("sort=actor&order=desc&pageSize=25");
    expect(actorDesc.data.map((i: any) => i.id)).toEqual([
      byAction.get("sort-a"),
      byAction.get("sort-e"),
      byAction.get("sort-g"),
      byAction.get("sort-f"),
      byAction.get("sort-c"),
      byAction.get("sort-d"),
      byAction.get("sort-b"),
    ]);

    const createdAsc = await feed("sort=createdAt&order=asc&pageSize=25");
    expect(createdAsc.data.map((i: any) => i.id)).toEqual([
      byAction.get("sort-a"),
      byAction.get("sort-b"),
      byAction.get("sort-c"),
      byAction.get("sort-d"),
      byAction.get("sort-e"),
      byAction.get("sort-f"),
      byAction.get("sort-g"),
    ]);
  });

  // Spec 068 T059 / FR-005: `kind` and `entityType` are displayed facets —
  // whitelisted sort keys on the UNION derived table. `entityType` sorts
  // edge rows by their FROM endpoint's type (the badge source), matching
  // the entity-kind label the feed renders.
  it("sorts the UNION feed by kind and entityType", async () => {
    const t = new Date("2026-09-08T12:00:00.000Z").getTime();
    const at = (offsetMs: number) => new Date(t + offsetMs).toISOString();
    const actor = { createdBy: null, createdByName: "type-sort" };

    const entA = {
      id: uuidv7(), entityType: "component", entityId: uuidv7(),
      action: "kt-a", changes: null, importRunId: null,
      ...actor, createdAt: at(100_000),
    };
    const entB = {
      id: uuidv7(), entityType: "auth", entityId: null,
      action: "kt-b", changes: null, importRunId: null,
      ...actor, createdAt: at(200_000),
    };
    const edgeA = {
      id: uuidv7(), edgeType: "DEPENDS_ON_COMPONENT",
      fromEntityType: "component", fromEntityId: uuidv7(),
      toEntityType: "digital_product", toEntityId: uuidv7(),
      action: "kt-c", reason: null, ...actor, createdAt: at(300_000),
    };
    const entC = {
      id: uuidv7(), entityType: "digital_product", entityId: uuidv7(),
      action: "kt-d", changes: null, importRunId: null,
      ...actor, createdAt: at(400_000),
    };
    const edgeB = {
      id: uuidv7(), edgeType: "COMPOSES",
      fromEntityType: "auth", fromEntityId: uuidv7(),
      toEntityType: "component", toEntityId: uuidv7(),
      action: "kt-e", reason: null, ...actor, createdAt: at(500_000),
    };
    await testDb.db
      .insertInto("entity_changes")
      .values([entA, entB, entC] as never)
      .execute();
    await testDb.db
      .insertInto("edge_changes")
      .values([edgeA, edgeB] as never)
      .execute();

    const window = "from=2026-09-08T12:00:00.000Z&to=2026-09-08T12:59:59.999Z";
    const feed = async (qs: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/audit/activity?${window}&${qs}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      expect(res.statusCode).toBe(200);
      return res.json().data.map((i: any) => i.id);
    };
    const ids = { entA, entB, entC, edgeA, edgeB };

    // kind asc: 'edge' < 'entity'; createdAt desc inside each group.
    expect(await feed("sort=kind&order=asc&pageSize=25")).toEqual([
      ids.edgeB.id, ids.edgeA.id, ids.entC.id, ids.entB.id, ids.entA.id,
    ]);
    expect(await feed("sort=kind&order=desc&pageSize=25")).toEqual([
      ids.entC.id, ids.entB.id, ids.entA.id, ids.edgeB.id, ids.edgeA.id,
    ]);

    // entityType asc on coalesce(entityType, fromEntityType):
    // 'auth' → edgeB(500s) then entB(200s); 'component' → edgeA(300s)
    // then entA(100s); 'digital_product' → entC.
    expect(await feed("sort=entityType&order=asc&pageSize=25")).toEqual([
      ids.edgeB.id, ids.entB.id, ids.edgeA.id, ids.entA.id, ids.entC.id,
    ]);
    expect(await feed("sort=entityType&order=desc&pageSize=25")).toEqual([
      ids.entC.id, ids.edgeA.id, ids.entA.id, ids.edgeB.id, ids.entB.id,
    ]);
  });

  it("rejects the inert search param (T061 / FR-006)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit/activity?search=component",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});
