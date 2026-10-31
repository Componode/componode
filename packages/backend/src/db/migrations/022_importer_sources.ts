import type { Kysely } from "kysely";
import { sql } from "kysely";
import { IMPORTER_SOURCE_STATUSES } from "@componode/core";

/**
 * Migration 022 — ImporterSource core (spec 044, ADR-119).
 *
 * `importer_sources` is the durable provenance record that outlives the
 * editable `importer_configs` row feeding it. Source→Component and
 * Source→ComponentInstance membership tables are the source-scoped
 * reconciliation unit (ADR-036 Amendment 1). `import_runs` gains durable
 * `sourceId` attribution and `configId` becomes nullable
 * `ON DELETE SET NULL` so deleting a config preserves run history
 * (ADR-047 Amendment 1).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("importer_sources")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("importerName", "text", (col) => col.notNull())
    .addColumn("externalIdentity", "text", (col) => col.notNull())
    .addColumn("label", "text")
    .addColumn("status", "text", (col) =>
      col.notNull().defaultTo(sql.lit("ACTIVE")),
    )
    .addColumn("boundConfigId", "uuid", (col) =>
      col.references("importer_configs.id").onDelete("set null"),
    )
    .addColumn("firstSeenInRunId", "uuid", (col) =>
      col.references("import_runs.id").onDelete("set null"),
    )
    .addColumn("lastSeenInRunId", "uuid", (col) =>
      col.references("import_runs.id").onDelete("set null"),
    )
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "importer_sources_status_check",
      sql`status IN (${sql.join(IMPORTER_SOURCE_STATUSES.map((s: string) => sql.lit(s)))})`,
    )
    .addUniqueConstraint("importer_sources_identity_unique", [
      "importerName",
      "externalIdentity",
    ])
    .execute();

  await db.schema
    .createIndex("importer_sources_bound_config_idx")
    .on("importer_sources")
    .column("boundConfigId")
    .execute();
  await db.schema
    .createIndex("importer_sources_status_idx")
    .on("importer_sources")
    .column("status")
    .execute();

  await db.schema
    .createTable("source_component_memberships")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("sourceId", "uuid", (col) =>
      col.notNull().references("importer_sources.id").onDelete("cascade"),
    )
    .addColumn("componentId", "uuid", (col) =>
      col.notNull().references("components.id").onDelete("cascade"),
    )
    .addColumn("active", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("details", "jsonb")
    .addColumn("firstSeenInRunId", "uuid", (col) =>
      col.references("import_runs.id").onDelete("set null"),
    )
    .addColumn("lastSeenInRunId", "uuid", (col) =>
      col.references("import_runs.id").onDelete("set null"),
    )
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("source_component_memberships_unique", [
      "sourceId",
      "componentId",
    ])
    .execute();

  await db.schema
    .createIndex("source_component_memberships_component_idx")
    .on("source_component_memberships")
    .column("componentId")
    .execute();

  await db.schema
    .createTable("source_instance_memberships")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("sourceId", "uuid", (col) =>
      col.notNull().references("importer_sources.id").onDelete("cascade"),
    )
    .addColumn("componentInstanceId", "uuid", (col) =>
      col
        .notNull()
        .references("component_instances.id")
        .onDelete("cascade"),
    )
    .addColumn("active", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("details", "jsonb")
    .addColumn("firstSeenInRunId", "uuid", (col) =>
      col.references("import_runs.id").onDelete("set null"),
    )
    .addColumn("lastSeenInRunId", "uuid", (col) =>
      col.references("import_runs.id").onDelete("set null"),
    )
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("source_instance_memberships_unique", [
      "sourceId",
      "componentInstanceId",
    ])
    .execute();

  await db.schema
    .createIndex("source_instance_memberships_instance_idx")
    .on("source_instance_memberships")
    .column("componentInstanceId")
    .execute();

  // Durable source attribution on runs. FK is RESTRICT — run history must
  // never silently lose its Source reference (ADR-119 #5).
  await db.schema
    .alterTable("import_runs")
    .addColumn("sourceId", "uuid", (col) =>
      col.references("importer_sources.id").onDelete("restrict"),
    )
    .execute();

  // configId becomes nullable ON DELETE SET NULL — deleting a config
  // preserves the run row and its Source attribution (ADR-047 Amendment 1).
  await sql`
    DO $$
    DECLARE conname text;
    BEGIN
      FOR conname IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_class f ON c.confrelid = f.oid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
        WHERE t.relname = 'import_runs'
          AND f.relname = 'importer_configs'
          AND a.attname = 'configId'
      LOOP
        EXECUTE format('ALTER TABLE import_runs DROP CONSTRAINT %I', conname);
      END LOOP;
    END $$;
  `.execute(db);

  await db.schema
    .alterTable("import_runs")
    .alterColumn("configId", (col) => col.dropNotNull())
    .execute();

  await sql`
    ALTER TABLE import_runs
    ADD CONSTRAINT import_runs_configId_fkey
    FOREIGN KEY ("configId") REFERENCES importer_configs(id) ON DELETE SET NULL
  `.execute(db);

  await db.schema
    .createIndex("import_runs_config_idx")
    .on("import_runs")
    .column("configId")
    .execute();
  await db.schema
    .createIndex("import_runs_source_idx")
    .on("import_runs")
    .column("sourceId")
    .execute();

  // The terminal-state guard (migration 003) would reject the FK's
  // ON DELETE SET NULL write on completed runs. Permit exactly that
  // write — a NEW row identical to OLD except configId NULL — while every
  // other terminal mutation still raises (ADR-047 A1 refinement).
  await sql`
    CREATE OR REPLACE FUNCTION prevent_import_runs_terminal_modification()
    RETURNS trigger AS $$
    DECLARE expected import_runs%ROWTYPE;
    BEGIN
      IF OLD.status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED') THEN
        expected := OLD;
        expected."configId" := NULL;
        IF NEW = expected THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Cannot modify import_runs in terminal state (ADR-100): %', OLD.status;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("import_runs_source_idx").execute();
  await db.schema.dropIndex("import_runs_config_idx").execute();

  await sql`
    ALTER TABLE import_runs DROP CONSTRAINT IF EXISTS import_runs_configId_fkey
  `.execute(db);
  await sql`DELETE FROM import_runs WHERE "configId" IS NULL`.execute(db);
  await db.schema
    .alterTable("import_runs")
    .alterColumn("configId", (col) => col.setNotNull())
    .execute();
  await sql`
    ALTER TABLE import_runs
    ADD CONSTRAINT import_runs_configId_fkey
    FOREIGN KEY ("configId") REFERENCES importer_configs(id) ON DELETE CASCADE
  `.execute(db);

  await db.schema
    .alterTable("import_runs")
    .dropColumn("sourceId")
    .execute();

  await db.schema.dropTable("source_instance_memberships").execute();
  await db.schema.dropTable("source_component_memberships").execute();
  await db.schema.dropTable("importer_sources").execute();

  // Restore the pre-022 terminal-state guard (no configId-NULL allowance).
  await sql`
    CREATE OR REPLACE FUNCTION prevent_import_runs_terminal_modification()
    RETURNS trigger AS $$
    BEGIN
      IF OLD.status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED') THEN
        RAISE EXCEPTION 'Cannot modify import_runs in terminal state (ADR-100): %', OLD.status;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);
}
