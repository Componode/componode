import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import type * as StoreT from "../../src/services/component-edge-store.js";

// Spec 076 T009 — shared junction write primitives.

let store: typeof StoreT;
const now = () => new Date().toISOString();
const insertImporterEdge: typeof StoreT.insertImporterEdge = (...a) =>
  store.insertImporterEdge(...a);
const getEdgeProvenance: typeof StoreT.getEdgeProvenance = (...a) =>
  store.getEdgeProvenance(...a);
const deleteEdge: typeof StoreT.deleteEdge = (...a) => store.deleteEdge(...a);
const listImporterEdgesForSource: typeof StoreT.listImporterEdgesForSource = (
  ...a
) => store.listImporterEdgesForSource(...a);
const listSuppressedPairs: typeof StoreT.listSuppressedPairs = (...a) =>
  store.listSuppressedPairs(...a);
const suppressPair: typeof StoreT.suppressPair = (...a) =>
  store.suppressPair(...a);
const edgePairKey: typeof StoreT.edgePairKey = (...a) =>
  store.edgePairKey(...a);

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

async function seedSource(db: TestDb["db"], importer = "github") {
  const id = uuidv7();
  await db
    .insertInto("importer_sources")
    .values({
      id,
      importerName: importer,
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

describe("component-edge-store", () => {
  let testDb: TestDb | null = null;
  beforeEach(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    store = await import("../../src/services/component-edge-store.js");
  });
  afterEach(async () => {
    await testDb?.cleanup();
    testDb = null;
  });

  it("insertImporterEdge writes IMPORTER provenance and is idempotent", async () => {
    const db = testDb!.db;
    const [a, b, src] = [
      await seedComponent(db),
      await seedComponent(db),
      await seedSource(db),
    ];
    expect(await insertImporterEdge("DEPENDS_ON", a, b, { sourceId: src, runId: null as never }, db)).toBe(true);
    expect(await insertImporterEdge("DEPENDS_ON", a, b, { sourceId: src, runId: null as never }, db)).toBe(false);
    expect(await getEdgeProvenance("DEPENDS_ON", a, b, db)).toBe("IMPORTER");
  });

  it("insertImporterEdge preserves a pre-existing CURATED row", async () => {
    const db = testDb!.db;
    const [a, b, src] = [
      await seedComponent(db),
      await seedComponent(db),
      await seedSource(db),
    ];
    // Human write — plain junction insert with the CURATED default.
    await db
      .insertInto("component_depends_on_component")
      .values({ parentId: a, childId: b, createdAt: now() })
      .execute();
    expect(await insertImporterEdge("DEPENDS_ON", a, b, { sourceId: src, runId: null as never }, db)).toBe(false);
    expect(await getEdgeProvenance("DEPENDS_ON", a, b, db)).toBe("CURATED");
  });

  it("handles all three edge kinds", async () => {
    const db = testDb!.db;
    const [a, b, src] = [
      await seedComponent(db),
      await seedComponent(db),
      await seedSource(db),
    ];
    const prov = { sourceId: src, runId: null as never };
    expect(await insertImporterEdge("SOURCES_FROM", a, b, prov, db)).toBe(true);
    expect(await insertImporterEdge("EXPOSES", a, b, prov, db)).toBe(true);
    expect(await getEdgeProvenance("SOURCES_FROM", a, b, db)).toBe("IMPORTER");
    expect(await getEdgeProvenance("EXPOSES", a, b, db)).toBe("IMPORTER");
    expect(await getEdgeProvenance("DEPENDS_ON", a, b, db)).toBeNull();
  });

  it("deleteEdge removes the row and reports it", async () => {
    const db = testDb!.db;
    const [a, b, src] = [
      await seedComponent(db),
      await seedComponent(db),
      await seedSource(db),
    ];
    await insertImporterEdge("DEPENDS_ON", a, b, { sourceId: src, runId: null as never }, db);
    expect(await deleteEdge("DEPENDS_ON", a, b, db)).toBe(true);
    expect(await deleteEdge("DEPENDS_ON", a, b, db)).toBe(false);
    expect(await getEdgeProvenance("DEPENDS_ON", a, b, db)).toBeNull();
  });

  it("listImporterEdgesForSource scopes to provenance + source across junctions", async () => {
    const db = testDb!.db;
    const [a, b, c] = [
      await seedComponent(db),
      await seedComponent(db),
      await seedComponent(db),
    ];
    const [srcA, srcB] = [await seedSource(db, "github"), await seedSource(db, "sbom-file")];
    const provA = { sourceId: srcA, runId: null as never };
    const provB = { sourceId: srcB, runId: null as never };
    await insertImporterEdge("DEPENDS_ON", a, b, provA, db);
    await insertImporterEdge("SOURCES_FROM", b, c, provA, db);
    await insertImporterEdge("DEPENDS_ON", b, c, provB, db);
    // A curated row must not be attributed to any source.
    await db
      .insertInto("component_exposes")
      .values({ serviceId: a, apiId: b, createdAt: now() })
      .execute();

    const edges = await listImporterEdgesForSource(srcA, db);
    expect(edges).toHaveLength(2);
    expect(edges).toContainEqual({ kind: "DEPENDS_ON", fromId: a, toId: b });
    expect(edges).toContainEqual({ kind: "SOURCES_FROM", fromId: b, toId: c });
  });

  it("listSuppressedPairs + suppressPair round-trip, idempotent", async () => {
    const db = testDb!.db;
    const [a, b, c] = [
      await seedComponent(db),
      await seedComponent(db),
      await seedComponent(db),
    ];
    const pairs = [
      { kind: "DEPENDS_ON" as const, fromId: a, toId: b },
      { kind: "DEPENDS_ON" as const, fromId: b, toId: c },
    ];
    expect(await listSuppressedPairs(pairs, db)).toEqual(new Set());
    await suppressPair("DEPENDS_ON", a, b, null, db);
    await suppressPair("DEPENDS_ON", a, b, null, db); // re-hide idempotent
    const suppressed = await listSuppressedPairs(pairs, db);
    expect(suppressed).toEqual(new Set([edgePairKey(pairs[0])]));

    const count = await db
      .selectFrom("component_edge_suppressions")
      .selectAll()
      .execute();
    expect(count).toHaveLength(1);
  });
});
