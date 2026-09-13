import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { DB } from "../../src/db/types.js";

// Postgres containers terminate active connections during teardown, which can
// emit a 57P01 FATAL error on the pg client stream after the pool has ended.
// This is harmless test-cleanup noise; log and ignore it, but rethrow any
// other uncaught exception so real failures are not masked.
process.on("uncaughtException", (err) => {
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "57P01") {
    return;
  }
  console.error("Uncaught exception in test process:", err);
  process.exit(1);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TestDb {
  db: Kysely<DB>;
  container: StartedPostgreSqlContainer;
  cleanup: () => Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer("postgres:16.11-alpine").start();

  const pool = new Pool({
    connectionString: container.getConnectionUri(),
  });

  // Swallow late Postgres errors during container teardown to avoid unhandled
  // exception warnings in Vitest output.
  pool.on("error", () => {});

  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });

  // Run migrations
  const migrationsPath = join(__dirname, "..", "..", "src", "db", "migrations");
  const files = await fs.readdir(migrationsPath);
  const migrationFiles = files.filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

  for (const file of migrationFiles.sort()) {
    const mod = await import(`file://${join(migrationsPath, file)}`);
    if (mod.up) {
      await mod.up(db as unknown as Kysely<unknown>);
    }
  }

  const cleanup = async () => {
    await db.destroy();

    // Close the app-level connection pool (imported lazily so this helper can be
    // used by tests that never build a Fastify app) before stopping the
    // container; otherwise the pool's open sockets keep the worker process alive
    // or emit late errors when Postgres terminates them.
    try {
      const { closeDb } = await import("../../src/db/connection.js");
      await closeDb();
    } catch {
      // connection.js was not loaded or DATABASE_URL was not set.
    }

    try {
      const { stopScheduler } = await import("../../src/services/scheduler-service.js");
      stopScheduler();
    } catch {
      // scheduler-service.js was not loaded or DATABASE_URL was not set.
    }

    await container.stop();
  };

  return { db, container, cleanup };
}
