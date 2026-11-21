import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";

// Spec 075 T006 — migration 035 creates `bom_component_suggestions` with
// the ADR-113-parity columns/CHECKs/pair-unique/component-FK cascades;
// migration 036 widens components_provider_check to the 24-provider
// taxonomy; migration 037 makes bomEntryId nullable + ON DELETE SET NULL
// so BOM pruning can't cascade-delete decided pairs.

const now = () => new Date().toISOString();

async function seedComponent(
  db: TestDb["db"],
  overrides: Partial<{ provider: string; category: string }> = {},
) {
  const id = uuidv7();
  await db
    .insertInto("components")
    .values({
      id,
      name: `c-${id.slice(-12)}`,
      slug: `c-${id.slice(-12)}`,
      category: overrides.category ?? "LIBRARY",
      provider: overrides.provider ?? "NPM",
      resourceType: "npm:package",
      lifecycle: "ACTIVE",
      teamOwnerId: null,
      externalId: "pkg:npm/lodash",
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

async function seedBomEntry(db: TestDb["db"], componentId: string) {
  const id = uuidv7();
  await db
    .insertInto("bom_entries")
    .values({
      id,
      componentId,
      purl: "pkg:npm/lodash@4.17.21",
      purlIdentity: "pkg:npm/lodash",
      name: "lodash",
      ecosystem: "npm",
      scope: "RUNTIME",
      evidenceSource: "REGISTRY_API",
    } as never)
    .execute();
  return id;
}

describe("migration 035 — bom_component_suggestions", () => {
  let testDb: TestDb | null = null;
  beforeEach(async () => {
    testDb = await startTestDb();
  });
  afterEach(async () => {
    await testDb?.cleanup();
    testDb = null;
  });

  it("inserts a PENDING row with defaults", async () => {
    const db = testDb!.db;
    const parent = await seedComponent(db);
    const child = await seedComponent(db);
    const entry = await seedBomEntry(db, parent);
    const id = uuidv7();
    await db
      .insertInto("bom_component_suggestions")
      .values({
        id,
        bomEntryId: entry,
        parentComponentId: parent,
        childComponentId: child,
        reason: "PURL_EXACT",
        score: 100,
      } as never)
      .execute();
    const row = await db
      .selectFrom("bom_component_suggestions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("PENDING");
    expect(row.decidedAt).toBeNull();
    expect(row.decidedBy).toBeNull();
    expect(row.createdAt).toBeTruthy();
  });

  it("enforces the pair unique constraint", async () => {
    const db = testDb!.db;
    const parent = await seedComponent(db);
    const child = await seedComponent(db);
    const entry = await seedBomEntry(db, parent);
    const insert = () =>
      db
        .insertInto("bom_component_suggestions")
        .values({
          id: uuidv7(),
          bomEntryId: entry,
          parentComponentId: parent,
          childComponentId: child,
          reason: "PURL_EXACT",
        } as never)
        .execute();
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it("CHECKs reason and status enums, NULL reason passes", async () => {
    const db = testDb!.db;
    const parent = await seedComponent(db);
    const child = await seedComponent(db);
    const entry = await seedBomEntry(db, parent);
    await expect(
      db
        .insertInto("bom_component_suggestions")
        .values({
          id: uuidv7(),
          bomEntryId: entry,
          parentComponentId: parent,
          childComponentId: child,
          reason: "BOGUS",
        } as never)
        .execute(),
    ).rejects.toThrow();
    await expect(
      db
        .insertInto("bom_component_suggestions")
        .values({
          id: uuidv7(),
          bomEntryId: entry,
          parentComponentId: parent,
          childComponentId: child,
          reason: null,
          status: "BOGUS",
        } as never)
        .execute(),
    ).rejects.toThrow();
    // SUPERSEDED tombstone — NULL reason/score is legal.
    await db
      .insertInto("bom_component_suggestions")
      .values({
        id: uuidv7(),
        bomEntryId: entry,
        parentComponentId: parent,
        childComponentId: child,
        reason: null,
        score: null,
        status: "SUPERSEDED",
      } as never)
      .execute();
  });

  it("cascades on component delete, SET NULLs decidedBy", async () => {
    const db = testDb!.db;
    const parent = await seedComponent(db);
    const child = await seedComponent(db);
    const entry = await seedBomEntry(db, parent);
    const personId = uuidv7();
    await db
      .insertInto("persons")
      .values({
        id: personId,
        username: `u-${personId.slice(-12)}`,
        slug: `p-${personId.slice(-12)}`,
        displayName: "Tester",
        email: null,
        role: "EDITOR",
        passwordHash: null,
        oidcSubject: null,
        teamId: null,
        isActive: true,
      } as never)
      .execute();
    const suggestionId = uuidv7();
    await db
      .insertInto("bom_component_suggestions")
      .values({
        id: suggestionId,
        bomEntryId: entry,
        parentComponentId: parent,
        childComponentId: child,
        reason: "PURL_EXACT",
        status: "DISMISSED",
        decidedAt: now(),
        decidedBy: personId,
      } as never)
      .execute();

    await db.deleteFrom("persons").where("id", "=", personId).execute();
    const afterPerson = await db
      .selectFrom("bom_component_suggestions")
      .selectAll()
      .where("id", "=", suggestionId)
      .executeTakeFirstOrThrow();
    expect(afterPerson.decidedBy).toBeNull();

    await db.deleteFrom("components").where("id", "=", parent).execute();
    const remaining = await db
      .selectFrom("bom_component_suggestions")
      .selectAll()
      .where("id", "=", suggestionId)
      .execute();
    expect(remaining).toHaveLength(0);
  });
});

describe("migration 036 — provider CHECK", () => {
  let testDb: TestDb | null = null;
  beforeEach(async () => {
    testDb = await startTestDb();
  });
  afterEach(async () => {
    await testDb?.cleanup();
    testDb = null;
  });

  it("accepts registry providers, rejects garbage", async () => {
    const db = testDb!.db;
    for (const provider of ["NPM", "DEBIAN", "GHCR", "RUBYGEMS", "ALPINE"]) {
      await expect(seedComponent(db, { provider })).resolves.toBeTruthy();
    }
    await expect(seedComponent(db, { provider: "NOT_A_PROVIDER" })).rejects
      .toThrow();
  });
});

describe("migration 037 — bomEntryId SET NULL", () => {
  let testDb: TestDb | null = null;
  beforeEach(async () => {
    testDb = await startTestDb();
  });
  afterEach(async () => {
    await testDb?.cleanup();
    testDb = null;
  });

  it("entry delete SET NULLs the rep — decided pair survives terminal", async () => {
    const db = testDb!.db;
    const parent = await seedComponent(db);
    const child = await seedComponent(db);
    const entry = await seedBomEntry(db, parent);
    const suggestionId = uuidv7();
    await db
      .insertInto("bom_component_suggestions")
      .values({
        id: suggestionId,
        bomEntryId: entry,
        parentComponentId: parent,
        childComponentId: child,
        reason: "PURL_EXACT",
        score: 100,
        status: "DISMISSED",
        decidedAt: now(),
      } as never)
      .execute();

    await db.deleteFrom("bom_entries").where("id", "=", entry).execute();

    const row = await db
      .selectFrom("bom_component_suggestions")
      .selectAll()
      .where("id", "=", suggestionId)
      .executeTakeFirstOrThrow();
    expect(row.bomEntryId).toBeNull();
    expect(row.status).toBe("DISMISSED");

    // The pair-guard still holds — a re-stage of the decided pair is
    // rejected, so DISMISSED decisions can't resurrect (T082).
    await expect(
      db
        .insertInto("bom_component_suggestions")
        .values({
          id: uuidv7(),
          bomEntryId: null,
          parentComponentId: parent,
          childComponentId: child,
          reason: "PURL_EXACT",
          score: 100,
          status: "PENDING",
        } as never)
        .execute(),
    ).rejects.toThrow();
  });
});
