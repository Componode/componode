import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";

// Spec 076 T006 — migration 038: provenance columns + CHECKs on the three
// component-edge junctions, and the component_edge_suppressions table.

const now = () => new Date().toISOString();

const JUNCTIONS: Array<{ table: string; from: string; to: string }> = [
  { table: "component_depends_on_component", from: "parentId", to: "childId" },
  { table: "component_sources_from", from: "serviceId", to: "repositoryId" },
  { table: "component_exposes", from: "serviceId", to: "apiId" },
];

async function seedComponent(db: TestDb["db"]) {
  const id = uuidv7();
  await db
    .insertInto("components")
    .values({
      id,
      name: `c-${id.slice(-12)}`,
      slug: `c-${id.slice(-12)}`,
      category: "LIBRARY",
      provider: "NPM",
      resourceType: "npm:package",
      lifecycle: "ACTIVE",
      teamOwnerId: null,
      externalId: `pkg:npm/c-${id.slice(-6)}`,
      details: null,
      sunsetAt: null,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
    } as never)
    .execute();
  return id;
}

async function seedSource(db: TestDb["db"]) {
  const id = uuidv7();
  await db
    .insertInto("importer_sources")
    .values({
      id,
      importerName: "github",
      externalIdentity: `org/src-${id.slice(-6)}`,
      label: null,
      status: "ACTIVE",
      boundConfigId: null,
      firstSeenInRunId: null,
      lastSeenInRunId: null,
      createdAt: now(),
      updatedAt: now(),
    } as never)
    .execute();
  return id;
}

async function insertJunction(
  db: TestDb["db"],
  table: string,
  from: string,
  to: string,
  fromId: string,
  toId: string,
  extra: Record<string, unknown> = {},
) {
  await db
    .insertInto(table as never)
    .values({
      [from]: fromId,
      [to]: toId,
      createdAt: now(),
      ...extra,
    } as never)
    .execute();
}

describe("migration 038 — edge provenance + suppressions", () => {
  let testDb: TestDb | null = null;
  beforeEach(async () => {
    testDb = await startTestDb();
  });
  afterEach(async () => {
    await testDb?.cleanup();
    testDb = null;
  });

  for (const { table, from, to } of JUNCTIONS) {
    it(`${table}: insert defaults provenance to CURATED`, async () => {
      const db = testDb!.db;
      const a = await seedComponent(db);
      const b = await seedComponent(db);
      await insertJunction(db, table, from, to, a, b);
      const row = await db
        .selectFrom(table as never)
        .selectAll()
        .executeTakeFirstOrThrow();
      expect((row as Record<string, unknown>).provenance).toBe("CURATED");
      expect((row as Record<string, unknown>).importerSourceId).toBeNull();
      expect((row as Record<string, unknown>).importRunId).toBeNull();
    });

    it(`${table}: accepts IMPORTER provenance with a source`, async () => {
      const db = testDb!.db;
      const a = await seedComponent(db);
      const b = await seedComponent(db);
      const sourceId = await seedSource(db);
      await insertJunction(db, table, from, to, a, b, {
        provenance: "IMPORTER",
        importerSourceId: sourceId,
      });
      const row = await db
        .selectFrom(table as never)
        .selectAll()
        .executeTakeFirstOrThrow();
      expect((row as Record<string, unknown>).provenance).toBe("IMPORTER");
    });

    it(`${table}: rejects IMPORTER provenance without a source`, async () => {
      const db = testDb!.db;
      const a = await seedComponent(db);
      const b = await seedComponent(db);
      await expect(
        insertJunction(db, table, from, to, a, b, {
          provenance: "IMPORTER",
          importerSourceId: null,
        }),
      ).rejects.toThrow();
    });

    it(`${table}: rejects a bad provenance value`, async () => {
      const db = testDb!.db;
      const a = await seedComponent(db);
      const b = await seedComponent(db);
      await expect(
        insertJunction(db, table, from, to, a, b, { provenance: "ROBOT" }),
      ).rejects.toThrow();
    });

    it(`${table}: deleting a referenced source is blocked (NO ACTION)`, async () => {
      const db = testDb!.db;
      const a = await seedComponent(db);
      const b = await seedComponent(db);
      const sourceId = await seedSource(db);
      await insertJunction(db, table, from, to, a, b, {
        provenance: "IMPORTER",
        importerSourceId: sourceId,
      });
      // Importer provenance is durable — a Source with attributed edges
      // cannot be deleted out from under them.
      await expect(
        db.deleteFrom("importer_sources").where("id", "=", sourceId).execute(),
      ).rejects.toThrow();
    });
  }

  it("component_edge_suppressions enforces pair uniqueness + kind CHECK", async () => {
    const db = testDb!.db;
    const a = await seedComponent(db);
    const b = await seedComponent(db);
    const mk = () =>
      db
        .insertInto("component_edge_suppressions")
        .values({
          id: uuidv7(),
          edgeKind: "DEPENDS_ON",
          fromComponentId: a,
          toComponentId: b,
          suppressedBy: null,
          createdAt: now(),
        })
        .execute();
    await mk();
    // Duplicate pair → unique violation
    await expect(mk()).rejects.toThrow();
    // Bad kind → CHECK violation
    await expect(
      db
        .insertInto("component_edge_suppressions")
        .values({
          id: uuidv7(),
          edgeKind: "COMPOSES",
          fromComponentId: a,
          toComponentId: b,
          suppressedBy: null,
          createdAt: now(),
        })
        .execute(),
    ).rejects.toThrow();
  });

  it("component_edge_suppressions cascades with a component delete", async () => {
    const db = testDb!.db;
    const a = await seedComponent(db);
    const b = await seedComponent(db);
    await db
      .insertInto("component_edge_suppressions")
      .values({
        id: uuidv7(),
        edgeKind: "DEPENDS_ON",
        fromComponentId: a,
        toComponentId: b,
        suppressedBy: null,
        createdAt: now(),
      })
      .execute();
    await db.deleteFrom("components").where("id", "=", a).execute();
    const rows = await db
      .selectFrom("component_edge_suppressions")
      .selectAll()
      .execute();
    expect(rows).toHaveLength(0);
  });
});
