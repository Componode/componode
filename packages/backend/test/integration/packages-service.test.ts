import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import { normalizePurlIdentity } from "@componode/core";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import type { listPackages as listPackagesT } from "../../src/services/packages-service.js";

// Spec 074 T007 — `listPackages` groups bom_entries by the stored normalized
// version-free identity (migration 034). Rows are seeded with real
// normalizePurlIdentity output so the tests read like production data.
let listPackages: typeof listPackagesT;

const now = () => new Date().toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function seedComponent(
  db: TestDb["db"],
  opts: { name: string; slug: string; lifecycle?: string },
): Promise<string> {
  const id = uuidv7();
  await db
    .insertInto("components")
    .values({
      id, name: opts.name, slug: opts.slug, category: "REPOSITORY",
      provider: "GITHUB", resourceType: "github:repository",
      lifecycle: opts.lifecycle ?? "ACTIVE", teamOwnerId: null,
      externalId: opts.slug, details: null, sunsetAt: null, lastSeenAt: null,
      lastSeenInRunId: null, createdBy: null, updatedBy: null,
      createdAt: now(), updatedAt: now(),
    } as never)
    .execute();
  return id;
}

interface SeedEntry {
  purl: string;
  name?: string;
  version?: string | null;
  ecosystem?: string;
  scope?: string;
  direct?: boolean;
  lastReportedAt?: string;
}

async function seedEntry(
  db: TestDb["db"],
  componentId: string,
  e: SeedEntry,
): Promise<void> {
  await sql`
    INSERT INTO bom_entries
      (id, "componentId", purl, "purlIdentity", name, version, ecosystem,
       scope, "evidenceSource", licenses, direct, "lastReportedAt",
       "createdAt", "updatedAt")
    VALUES (${uuidv7()}, ${componentId}, ${e.purl},
            ${normalizePurlIdentity(e.purl) ?? e.purl},
            ${e.name ?? "pkg"}, ${e.version === undefined ? "1.0.0" : e.version},
            ${e.ecosystem ?? "npm"}, ${e.scope ?? "RUNTIME"}, 'REGISTRY_API',
            '[]'::jsonb, ${e.direct ?? true}, ${e.lastReportedAt ?? now()},
            ${now()}, ${now()})
  `.execute(db);
}

const baseQuery = { page: 1, pageSize: 25, order: "desc" as const, sort: "components" as const };

describe("packages-service listPackages", () => {
  let testDb: TestDb;
  let compA = "";
  let compB = "";
  let compRetired = "";

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    ({ listPackages } = await import("../../src/services/packages-service.js"));
    compA = await seedComponent(testDb.db, { name: "App A", slug: "app-a" });
    compB = await seedComponent(testDb.db, { name: "App B", slug: "app-b" });
    compRetired = await seedComponent(testDb.db, {
      name: "Old", slug: "old", lifecycle: "RETIRED",
    });
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  beforeEach(async () => {
    await testDb.db.deleteFrom("bom_entries").execute();
  });

  it("returns one row per version-free purl across versions and casing", async () => {
    await seedEntry(testDb!.db, compA, { purl: "pkg:npm/Lodash@4.17.21", name: "Lodash", version: "4.17.21" });
    await seedEntry(testDb!.db, compB, { purl: "pkg:npm/lodash@4.17.20", name: "lodash", version: "4.17.20" });
    await seedEntry(testDb!.db, compA, { purl: "pkg:deb/debian/curl@7.88.1#usr/bin/curl", name: "curl", version: "7.88.1", ecosystem: "deb" });

    const res = await listPackages({ ...baseQuery });
    expect(res.pagination.total).toBe(2);
    const lodash = res.data.find((r) => r.purl === "pkg:npm/lodash")!;
    expect(lodash.versionCount).toBe(2);
    expect(lodash.componentCount).toBe(2);
    expect(lodash.ecosystem).toBe("npm");
    expect(lodash.catalogComponent).toBeNull();
    expect(lodash.pendingSuggestionCount).toBe(0);
    const curl = res.data.find((r) => r.purl === "pkg:deb/debian/curl")!;
    expect(curl.name).toBe("curl");
  });

  it("picks the most recently reported name as representative", async () => {
    await seedEntry(testDb!.db, compA, { purl: "pkg:npm/x@1", name: "older-name", lastReportedAt: daysAgo(5) });
    await seedEntry(testDb!.db, compB, { purl: "pkg:npm/x@2", name: "newer-name", version: "2", lastReportedAt: daysAgo(1) });
    const res = await listPackages({ ...baseQuery });
    expect(res.data[0]!.name).toBe("newer-name");
  });

  it("counts and lists ACTIVE components only", async () => {
    await seedEntry(testDb!.db, compA, { purl: "pkg:npm/lodash@4.17.21", name: "lodash" });
    await seedEntry(testDb!.db, compRetired, { purl: "pkg:npm/lodash@4.17.21", name: "lodash" });
    const res = await listPackages({ ...baseQuery });
    expect(res.data[0]!.componentCount).toBe(1);
    expect(res.data[0]!.versions[0]!.componentCount).toBe(1);
  });

  it("matches search on name, verbatim purl, and purlIdentity", async () => {
    await seedEntry(testDb!.db, compA, { purl: "pkg:npm/lodash@4.17.21", name: "lodash" });
    await seedEntry(testDb!.db, compA, { purl: "pkg:deb/debian/curl@7.88.1", name: "curl", ecosystem: "deb" });
    for (const [q, expected] of [
      ["lodas", 1], ["pkg:npm/lodash@4", 1], ["pkg:deb", 1], ["zz-none", 0],
    ] as const) {
      const res = await listPackages({ ...baseQuery, search: q });
      expect(res.data.length, `search ${q}`).toBe(expected);
    }
  });

  it("applies ecosystem and scope filters at entry level before grouping", async () => {
    await seedEntry(testDb!.db, compA, { purl: "pkg:npm/a@1", name: "a", scope: "RUNTIME" });
    await seedEntry(testDb!.db, compA, { purl: "pkg:npm/a@1", name: "a", scope: "DEV" });
    await seedEntry(testDb!.db, compA, { purl: "pkg:deb/b@2", name: "b", ecosystem: "deb" });

    expect((await listPackages({ ...baseQuery, ecosystem: ["deb"] })).data.length).toBe(1);
    // scope=DEV still surfaces package a (an entry matches) even though its
    // other entries are RUNTIME.
    const scoped = await listPackages({ ...baseQuery, scope: ["DEV"] });
    expect(scoped.data.length).toBe(1);
    expect(scoped.data[0]!.purl).toBe("pkg:npm/a");
  });

  it("returns the full ecosystem facet domain regardless of filters", async () => {
    await seedEntry(testDb!.db, compA, { purl: "pkg:npm/a@1", name: "a" });
    await seedEntry(testDb!.db, compA, { purl: "pkg:deb/b@2", name: "b", ecosystem: "deb" });
    await seedEntry(testDb!.db, compRetired, { purl: "pkg:pypi/c@3", name: "c", ecosystem: "pypi" });

    // Even filtered to one row, facets list every ACTIVE-inventory
    // ecosystem — a filtered-out value stays selectable (T053).
    const filtered = await listPackages({ ...baseQuery, ecosystem: ["deb"] });
    expect(filtered.facets.ecosystems).toEqual(["deb", "npm"]);
    // Empty result set still carries the facet domain.
    const empty = await listPackages({ ...baseQuery, search: "no-match-zzz" });
    expect(empty.data).toEqual([]);
    expect(empty.facets.ecosystems).toEqual(["deb", "npm"]);
  });

  it("sorts by whitelist keys and defaults components desc + name asc", async () => {
    await seedEntry(testDb!.db, compA, { purl: "pkg:npm/zeta@1", name: "zeta" });
    await seedEntry(testDb!.db, compB, { purl: "pkg:npm/zeta@1", name: "zeta" });
    await seedEntry(testDb!.db, compA, { purl: "pkg:npm/alpha@1", name: "alpha" });
    await seedEntry(testDb!.db, compA, { purl: "pkg:npm/mid@1", name: "mid" });
    await seedEntry(testDb!.db, compB, { purl: "pkg:npm/mid@1", name: "mid" });

    const def = await listPackages({ ...baseQuery });
    expect(def.data.map((r) => r.purl)).toEqual([
      "pkg:npm/mid", "pkg:npm/zeta", "pkg:npm/alpha",
    ]);
    const byName = await listPackages({ ...baseQuery, sort: "name", order: "asc" });
    expect(byName.data[0]!.purl).toBe("pkg:npm/alpha");
    const byVersions = await listPackages({ ...baseQuery, sort: "versions", order: "desc" });
    expect(byVersions.data.map((r) => r.purl)).toContain("pkg:npm/zeta");
  });

  it("returns top-5 versions by component count with versionCount overflow", async () => {
    for (let v = 1; v <= 6; v++) {
      await seedEntry(testDb!.db, compA, { purl: `pkg:npm/many@${v}.0.0`, name: "many", version: `${v}.0.0` });
    }
    // Version 1.0.0 is the most-consumed (compB also reports it).
    await seedEntry(testDb!.db, compB, { purl: "pkg:npm/many@1.0.0", name: "many", version: "1.0.0" });

    const res = await listPackages({ ...baseQuery });
    const row = res.data[0]!;
    expect(row.versionCount).toBe(6);
    expect(row.versions.length).toBe(5);
    expect(row.versions[0]).toEqual({ version: "1.0.0", componentCount: 2 });
  });

  it("excludes null versions from chips and versionCount", async () => {
    await seedEntry(testDb!.db, compA, { purl: "pkg:generic/blob", name: "blob", version: null, ecosystem: "generic" });
    const res = await listPackages({ ...baseQuery });
    expect(res.data[0]!.versionCount).toBe(0);
    expect(res.data[0]!.versions).toEqual([]);
  });

  it("paginates the grouped rollup", async () => {
    for (let i = 0; i < 30; i++) {
      await seedEntry(testDb!.db, compA, { purl: `pkg:npm/p${String(i).padStart(3, "0")}@1`, name: `p${i}` });
    }
    const res = await listPackages({ ...baseQuery, pageSize: 25 });
    expect(res.data.length).toBe(25);
    expect(res.pagination.total).toBe(30);
    expect(res.pagination.hasNext).toBe(true);
    const page2 = await listPackages({ ...baseQuery, page: 2, pageSize: 25 });
    expect(page2.data.length).toBe(5);
  });
});
