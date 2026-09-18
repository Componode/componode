import { Migrator, type MigrationProvider, type Migration } from "kysely/migration";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { db } from "./db/connection.js";
import { assertDatabasePlatform } from "./db/platform-check.js";
import { buildApp } from "./app.js";
import { bootstrapAdmin } from "./services/bootstrap-service.js";
import { bootstrapCredentialStore } from "./services/credential-boot.js";
import { recoverRuns } from "./services/recovery-service.js";
import { initScheduler } from "./services/scheduler-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class FileMigrationProvider implements MigrationProvider {
  constructor(private readonly migrationsPath: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = await fs.readdir(this.migrationsPath);
    const migrationFiles = files.filter((f) => f.endsWith(".js") && !f.endsWith(".d.ts"));

    const migrations: Record<string, Migration> = {};
    for (const file of migrationFiles.sort()) {
      const mod = await import(`file://${join(this.migrationsPath, file)}`);
      migrations[file.replace(/\.js$/, "")] = {
        up: mod.up,
        down: mod.down,
      };
    }
    return migrations;
  }
}

async function runMigrations(): Promise<void> {
  const migrationsPath = join(__dirname, "db", "migrations");

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider(migrationsPath),
  });

  const result = await migrator.migrateToLatest();
  if (result.error) {
    console.error("Migration failed:", result.error);
    process.exit(1);
  }
  console.log(`Migrations complete: ${result.results?.length ?? 0} migrations executed`);
}

async function main(): Promise<void> {
  // 1. Verify database platform prerequisites before migrations
  await assertDatabasePlatform();

  // 2. Run migrations
  await runMigrations();

  // 2.5. Credential store: load the master keyring, re-encrypt payloads under
  // the current key during dual-key rotation, fail when stored credentials
  // are unreadable, or run degraded when the store is empty and keyless.
  await bootstrapCredentialStore(console);

  // 3. Recover any stale import runs from a previous crash
  await recoverRuns();

  // 4. Bootstrap admin (if DB is empty)
  await bootstrapAdmin();

  // 5. Initialize scheduled importers
  await initScheduler();

  // 6. Build and start the server
  const app = await buildApp();
  const port = parseInt(process.env.PORT ?? "3000", 10);

  try {
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`Componode server listening on port ${port}`);
  } catch (err) {
    app.log.error(err, "Failed to start server");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
