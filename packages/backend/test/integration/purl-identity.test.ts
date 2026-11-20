import { describe, it, expect, afterEach } from "vitest";
import { sql } from "kysely";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { uuidv7 } from "uuidv7";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import type { DB } from "../../src/db/types.js";
import type { DiscoveredBomEntry } from "@componode/core";
import type { processBomEntries as processBomEntriesT } from "../../src/services/bom-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const now = () => new Date().toISOString();

// Spec 074 T003 — `purlIdentity` (migration 034) is the stored, normalized,
// version-free package identity the /packages rollup groups on and
// /packages/consumers matches against (research D1).

async function seedComponent(db: Kysely<DB>, id: string) {
  await db
    .insertInto("components")
    .values({
      id, name: "app", slug: "app", category: "REPOSITORY", provider: "GITHUB",
      resourceType: "github:repository", lifecycle: "ACTIVE", teamOwnerId: null,
      externalId: "app", details: null, sunsetAt: null, lastSeenAt: null,
      lastSeenInRunId: null, createdBy: null, updatedBy: null,
      createdAt: now(), updatedAt: now(),
    } as never)
    .execute();
}

describe("migration 034 — bom_entries.purlIdentity backfill", () => {
  let container: StartedPostgreSqlContainer | null = null;
  let db: Kysely<DB> | null = null;

  afterEach(async () => {
    if (db) await db.destroy();
    if (container) await container.stop();
    db = null;
    container = null;
  });

  it("backfills normalized version-free identities and enforces NOT NULL + index", async () => {
    // Boot a DB at the pre-034 schema: run every migration except 034, then
    // insert rows shaped like Phase-1 data (verbatim, versioned purls).
    container = await new PostgreSqlContainer("postgres:16.11-alpine").start();
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    pool.on("error", () => {});
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

    const migrationsPath = join(__dirname, "..", "..", "src", "db", "migrations");
    const files = (await fs.readdir(migrationsPath))
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
      .filter((f) => !f.startsWith("034_"))
      .sort();
    for (const file of files) {
      const mod = await import(`file://${join(migrationsPath, file)}`);
      if (mod.up) await mod.up(db as unknown as Kysely<unknown>);
    }

    const componentId = uuidv7();
    await seedComponent(db, componentId);
    const cases: [string, string][] = [
      ["pkg:npm/lodash@4.17.21", "pkg:npm/lodash"],
      ["pkg:npm/Lodash@4.17.20", "pkg:npm/lodash"],
      ["pkg:npm/left-pad@1.3.0?arch=amd64", "pkg:npm/left-pad"],
      ["pkg:deb/debian/curl@7.88.1#usr/bin/curl", "pkg:deb/debian/curl"],
      ["not a purl at all", "not a purl at all"],
    ];
    for (const [purl] of cases) {
      await sql`
        INSERT INTO bom_entries
          (id, "componentId", purl, name, version, ecosystem, scope,
           "evidenceSource", licenses, direct, "createdAt", "updatedAt")
        VALUES (${uuidv7()}, ${componentId}, ${purl}, 'x', '1.0.0', 'npm',
                'RUNTIME', 'REGISTRY_API', '[]'::jsonb, true, ${now()}, ${now()})
      `.execute(db);
    }

    const mod = await import(
      `file://${join(migrationsPath, "034_bom_entries_purl_identity.ts")}`
    );
    await mod.up(db as unknown as Kysely<unknown>);

    const rows = await sql<{ purl: string; purlIdentity: string }>`
      SELECT purl, "purlIdentity" FROM bom_entries ORDER BY purl
    `.execute(db);
    const byPurl = new Map(rows.rows.map((r) => [r.purl, r.purlIdentity]));
    for (const [purl, expected] of cases) {
      expect(byPurl.get(purl), `identity for ${purl}`).toBe(expected);
    }

    // NOT NULL enforced.
    await expect(
      sql`
        INSERT INTO bom_entries
          (id, "componentId", purl, name, version, ecosystem, scope,
           "evidenceSource", licenses, direct, "createdAt", "updatedAt")
        VALUES (${uuidv7()}, ${componentId}, 'pkg:npm/noident@1.0.0', 'x',
                '1.0.0', 'npm', 'RUNTIME', 'REGISTRY_API', '[]'::jsonb,
                true, ${now()}, ${now()})
      `.execute(db),
    ).rejects.toThrow();

    // Index exists for the grouping/matching path.
    const idx = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'bom_entries' AND indexname = 'bom_entries_purl_identity_idx'
    `.execute(db);
    expect(idx.rows.length).toBe(1);
  });
});

describe("bom write path — purlIdentity", () => {
  let testDb: TestDb | null = null;
  let processBomEntries: typeof processBomEntriesT;
  let componentId = "";
  let runId = "";

  afterEach(async () => {
    if (testDb) await testDb.cleanup();
    testDb = null;
  });

  async function setup() {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    ({ processBomEntries } = await import("../../src/services/bom-service.js"));
    componentId = uuidv7();
    runId = uuidv7();
    await seedComponent(testDb.db, componentId);
    await testDb.db
      .insertInto("import_runs")
      .values({
        id: runId, configId: null, sourceId: null, status: "RUNNING",
        assetsProcessed: 0, assetsCreated: 0, assetsUpdated: 0,
        instancesOrphaned: 0, componentsRetired: 0, createdAt: now(),
      } as never)
      .execute();
  }

  function entry(purl: string, partial: Partial<DiscoveredBomEntry> = {}): DiscoveredBomEntry {
    return { purl, name: "x", version: "1.0.0", scope: "RUNTIME", evidenceSource: "REGISTRY_API", ...partial };
  }

  async function identities(): Promise<Map<string, string>> {
    const rows = await testDb!.db
      .selectFrom("bom_entries")
      .select(["purl", "purlIdentity"])
      .where("componentId", "=", componentId)
      .execute();
    return new Map(rows.map((r) => [r.purl, r.purlIdentity]));
  }

  it("writes the normalized version-free identity on insert", async () => {
    await setup();
    await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId,
        componentInstanceId: null,
        sourceId: null,
        runId,
        entries: [
          entry("pkg:npm/Lodash@4.17.21"),
          entry("pkg:npm/left-pad@1.3.0?arch=amd64"),
          entry("pkg:deb/debian/curl@7.88.1#usr/bin/curl"),
        ],
      }),
    );
    const map = await identities();
    expect(map.get("pkg:npm/Lodash@4.17.21")).toBe("pkg:npm/lodash");
    expect(map.get("pkg:npm/left-pad@1.3.0?arch=amd64")).toBe("pkg:npm/left-pad");
    expect(map.get("pkg:deb/debian/curl@7.88.1#usr/bin/curl")).toBe("pkg:deb/debian/curl");
  });

  it("keeps identity stable across conflict-updates of the same key", async () => {
    await setup();
    const run2 = uuidv7();
    await testDb!.db
      .insertInto("import_runs")
      .values({
        id: run2, configId: null, sourceId: null, status: "RUNNING",
        assetsProcessed: 0, assetsCreated: 0, assetsUpdated: 0,
        instancesOrphaned: 0, componentsRetired: 0, createdAt: now(),
      } as never)
      .execute();
    for (const run of [runId, run2]) {
      await testDb!.db.transaction().execute((trx) =>
        processBomEntries(trx, {
          componentId,
          componentInstanceId: null,
          sourceId: null,
          runId: run,
          entries: [entry("pkg:npm/lodash@4.17.21", { name: "lodash-renamed" })],
        }),
      );
    }
    const map = await identities();
    expect(map.get("pkg:npm/lodash@4.17.21")).toBe("pkg:npm/lodash");
  });
});
