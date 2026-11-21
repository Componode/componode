import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import type * as StoreT from "../../src/services/bom-suggestion-store.js";

// Spec 075 T011 — bom-suggestion-store primitives: idempotent staging,
// tombstone supersede, terminal accept, identity matching, slug suffixes.

let store: typeof StoreT;
const now = () => new Date().toISOString();

async function seedComponent(
  db: TestDb["db"],
  overrides: Partial<{
    provider: string;
    category: string;
    externalId: string;
    slug: string;
    name: string;
  }> = {},
) {
  const id = uuidv7();
  await db
    .insertInto("components")
    .values({
      id,
      name: overrides.name ?? `c-${id.slice(-12)}`,
      slug: overrides.slug ?? `c-${id.slice(-12)}`,
      category: overrides.category ?? "LIBRARY",
      provider: overrides.provider ?? "NPM",
      resourceType: "npm:package",
      lifecycle: "ACTIVE",
      teamOwnerId: null,
      externalId: overrides.externalId ?? null,
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

async function seedBomEntry(
  db: TestDb["db"],
  componentId: string,
  identity = "pkg:npm/lodash",
) {
  const id = uuidv7();
  await db
    .insertInto("bom_entries")
    .values({
      id,
      componentId,
      purl: `${identity}@4.17.21`,
      purlIdentity: identity,
      name: "lodash",
      ecosystem: "npm",
      scope: "RUNTIME",
      evidenceSource: "REGISTRY_API",
    } as never)
    .execute();
  return id;
}

describe("bom-suggestion-store", () => {
  let testDb: TestDb | null = null;

  beforeEach(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    store = await import("../../src/services/bom-suggestion-store.js");
  });
  afterEach(async () => {
    await testDb?.cleanup();
    testDb = null;
  });

  it("stages PENDING rows and refreshes reason/score only while pending", async () => {
    const db = testDb!.db;
    const parent = await seedComponent(db);
    const child = await seedComponent(db);
    const entry = await seedBomEntry(db, parent);

    const staged = await store.stageBomSuggestions(
      [
        {
          bomEntryId: entry,
          parentComponentId: parent,
          childComponentId: child,
          reason: "PURL_NAME_MATCH",
          score: 0.5,
        },
      ],
      db,
    );
    expect(staged).toBe(1);
    let row = await db
      .selectFrom("bom_component_suggestions")
      .selectAll()
      .where("parentComponentId", "=", parent)
      .executeTakeFirstOrThrow();
    expect(row.score).toBe(50); // centi-score

    // Unchanged rescan → idempotent no-op.
    expect(
      await store.stageBomSuggestions(
        [
          {
            bomEntryId: entry,
            parentComponentId: parent,
            childComponentId: child,
            reason: "PURL_NAME_MATCH",
            score: 0.5,
          },
        ],
        db,
      ),
    ).toBe(0);

    // Changed signal → PENDING refreshes.
    expect(
      await store.stageBomSuggestions(
        [
          {
            bomEntryId: entry,
            parentComponentId: parent,
            childComponentId: child,
            reason: "PURL_EXACT",
            score: 1.0,
          },
        ],
        db,
      ),
    ).toBe(1);
    row = await db
      .selectFrom("bom_component_suggestions")
      .selectAll()
      .where("parentComponentId", "=", parent)
      .executeTakeFirstOrThrow();
    expect(row.reason).toBe("PURL_EXACT");
    expect(row.score).toBe(100);

    // Terminal rows never resurrect.
    await db
      .updateTable("bom_component_suggestions")
      .set({ status: "DISMISSED", decidedAt: now() })
      .execute();
    expect(
      await store.stageBomSuggestions(
        [
          {
            bomEntryId: entry,
            parentComponentId: parent,
            childComponentId: child,
            reason: "PURL_EXACT",
            score: 1.0,
          },
        ],
        db,
      ),
    ).toBe(0);
    row = await db
      .selectFrom("bom_component_suggestions")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("DISMISSED");
  });

  it("supersede flips PENDING and tombstones absent pairs", async () => {
    const db = testDb!.db;
    const parent = await seedComponent(db);
    const childA = await seedComponent(db);
    const childB = await seedComponent(db);
    const entry = await seedBomEntry(db, parent);

    await store.stageBomSuggestions(
      [
        {
          bomEntryId: entry,
          parentComponentId: parent,
          childComponentId: childA,
          reason: "PURL_EXACT",
          score: 1.0,
        },
      ],
      db,
    );

    const res = await store.supersedeBomPairs(
      db,
      [
        { parentComponentId: parent, childComponentId: childA, bomEntryId: entry },
        { parentComponentId: parent, childComponentId: childB, bomEntryId: entry },
      ],
    );
    expect(res).toEqual({ flipped: 1, inserted: 1 });

    const rows = await db
      .selectFrom("bom_component_suggestions")
      .selectAll()
      .execute();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.status).toBe("SUPERSEDED");
      expect(r.reason).toBeNull();
      expect(r.score).toBeNull();
      expect(r.decidedAt).toBeTruthy();
    }

    // Idempotent: already-terminal pairs are untouched.
    const again = await store.supersedeBomPairs(
      db,
      [
        { parentComponentId: parent, childComponentId: childA, bomEntryId: entry },
      ],
    );
    expect(again).toEqual({ flipped: 0, inserted: 0 });
  });

  it("acceptBomSuggestions stamps the decider on PENDING only", async () => {
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
        displayName: "Editor",
        email: null,
        role: "EDITOR",
        passwordHash: null,
        oidcSubject: null,
        teamId: null,
        isActive: true,
      } as never)
      .execute();
    await store.stageBomSuggestions(
      [
        {
          bomEntryId: entry,
          parentComponentId: parent,
          childComponentId: child,
          reason: "PURL_EXACT",
          score: 1.0,
        },
      ],
      db,
    );
    const pending = await store.findPendingSuggestionId(db, parent, child);
    expect(pending).toBeTruthy();

    const flipped = await store.acceptBomSuggestions(db, [pending!], {
      id: personId,
      slug: "editor",
      role: "EDITOR",
    });
    expect(flipped).toEqual([pending]);

    const row = await db
      .selectFrom("bom_component_suggestions")
      .selectAll()
      .where("id", "=", pending!)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("ACCEPTED");
    expect(row.decidedBy).toBe(personId);

    // Second accept on a terminal row is a no-op.
    expect(
      await store.acceptBomSuggestions(db, [pending!], {
        id: uuidv7(),
        slug: "editor2",
        role: "EDITOR",
      }),
    ).toEqual([]);
  });

  it("findComponentByPackageIdentity matches verbatim + versioned purls across providers", async () => {
    const db = testDb!.db;
    const verbatim = await seedComponent(db, {
      externalId: "pkg:npm/lodash",
      provider: "NPM",
    });
    const versioned = await seedComponent(db, {
      externalId: "pkg:npm/react@18.2.0",
      provider: "OTHER",
      category: "COMPUTE",
    });
    await seedComponent(db, { externalId: "not-a-purl" });
    await seedComponent(db, { externalId: null });

    expect(
      (await store.findComponentByPackageIdentity("pkg:npm/lodash", db))?.id,
    ).toBe(verbatim);
    expect(
      (await store.findComponentByPackageIdentity("pkg:npm/react", db))?.id,
    ).toBe(versioned);
    expect(
      await store.findComponentByPackageIdentity("pkg:maven/com.google:g", db),
    ).toBeNull();
  });

  it("allocateLibrarySlug suffixes on collision", async () => {
    const db = testDb!.db;
    await seedComponent(db, { slug: "pkg-npm-lodash" });
    expect(await store.allocateLibrarySlug("npm", "lodash", db)).toBe(
      "pkg-npm-lodash-2",
    );
    await seedComponent(db, { slug: "pkg-npm-lodash-2" });
    expect(await store.allocateLibrarySlug("npm", "lodash", db)).toBe(
      "pkg-npm-lodash-3",
    );
    expect(await store.allocateLibrarySlug("npm", "@scope/name", db)).toBe(
      "pkg-npm-scope-name",
    );
  });
});
