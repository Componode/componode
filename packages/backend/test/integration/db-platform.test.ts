import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "kysely";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";

// Regression for 2026-09-10 assessment findings 8.3.7/8.3.8: the backend did
// not verify the PostgreSQL version or the pgcrypto extension at startup.
describe("database platform preflight", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
  });

  afterAll(async () => {
    delete process.env.DATABASE_URL;
    await testDb.cleanup();
  });

  it("assertPostgresVersion rejects PostgreSQL < 14", async () => {
    const { assertPostgresVersion } = await import("../../src/db/platform-check.js");
    expect(() => assertPostgresVersion(130012)).toThrow(/PostgreSQL 14 or newer/);
    expect(() => assertPostgresVersion(0)).toThrow(/PostgreSQL 14 or newer/);
    expect(() => assertPostgresVersion(140000)).not.toThrow();
    expect(() => assertPostgresVersion(160002)).not.toThrow();
  });

  it("assertDatabasePlatform passes on a supported server and ensures pgcrypto", async () => {
    const { assertDatabasePlatform } = await import("../../src/db/platform-check.js");
    await expect(assertDatabasePlatform(testDb.db)).resolves.toBeUndefined();
    const { rows } = await sql<{ extname: string }>`
      SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'
    `.execute(testDb.db);
    expect(rows).toHaveLength(1);
  });

  it("recreates pgcrypto when it has been dropped", async () => {
    await sql`DROP EXTENSION IF EXISTS pgcrypto`.execute(testDb.db);
    const { assertDatabasePlatform } = await import("../../src/db/platform-check.js");
    await expect(assertDatabasePlatform(testDb.db)).resolves.toBeUndefined();
    const { rows } = await sql<{ extname: string }>`
      SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'
    `.execute(testDb.db);
    expect(rows).toHaveLength(1);
  });
});
