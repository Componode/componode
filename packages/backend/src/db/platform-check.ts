import { sql, type Kysely } from "kysely";
import { db } from "./connection.js";
import type { DB } from "./types.js";

/**
 * Startup database platform preflight (ADR-101 amendment): fails fast with a
 * clear error when the database cannot support Componode, before migrations
 * produce less diagnosable failures. Requires PostgreSQL >= 14 and the
 * pgcrypto extension (used for gen_random_uuid() in migrations).
 */
export const MIN_POSTGRES_VERSION_NUM = 140000;

export function assertPostgresVersion(versionNum: number): void {
  if (!Number.isInteger(versionNum) || versionNum < MIN_POSTGRES_VERSION_NUM) {
    const major = Math.floor(versionNum / 10000);
    throw new Error(
      `Unsupported PostgreSQL version ${versionNum} (major ${major}). Componode requires PostgreSQL 14 or newer.`,
    );
  }
}

async function hasPgcrypto(database: Kysely<DB>): Promise<boolean> {
  const { rows } = await sql<{ extname: string }>`
    SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'
  `.execute(database);
  return rows.length > 0;
}

export async function assertDatabasePlatform(database: Kysely<DB> = db): Promise<void> {
  const { rows } = await sql<{ server_version_num: string }>`
    SHOW server_version_num
  `.execute(database);
  assertPostgresVersion(parseInt(rows[0]?.server_version_num ?? "0", 10));

  if (await hasPgcrypto(database)) return;

  // pgcrypto is a trusted extension, so the database owner can create it even
  // without superuser. init-db.sql also creates it for the bundled Compose DB.
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(database);
  } catch (err) {
    if (!(await hasPgcrypto(database))) {
      throw new Error(
        `Required PostgreSQL extension 'pgcrypto' is missing and could not be created. Grant CREATE on the database or install it as a superuser. Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
