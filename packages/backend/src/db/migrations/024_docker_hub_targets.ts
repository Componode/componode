import type { Kysely } from "kysely";
import { sql } from "kysely";
import { IMPORT_RUN_CANCEL_REASONS } from "@componode/core";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("docker_targets")
    .addColumn("id", "uuid", (c) => c.primaryKey())
    .addColumn("targetId", "text", (c) => c.notNull())
    .addColumn("label", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .addColumn("profile", "jsonb", (c) => c.notNull())
    .addColumn("enabled", "boolean", (c) => c.notNull().defaultTo(true))
    .addColumn("createdBy", "uuid", (c) => c.references("persons.id").onDelete("set null"))
    .addColumn("updatedBy", "uuid", (c) => c.references("persons.id").onDelete("set null"))
    .addColumn("createdAt", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updatedAt", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("docker_targets_target_id_len", sql`length(btrim("targetId")) BETWEEN 1 AND 200`)
    .addUniqueConstraint("docker_targets_target_id_unique", ["targetId"])
    .execute();
  await db.schema.createIndex("docker_targets_enabled_idx").on("docker_targets").column("enabled").execute();
  await db.schema
    .alterTable("import_runs")
    .addColumn("cancelReason", "text")
    .execute();
  await db.schema
    .alterTable("import_runs")
    .addCheckConstraint(
      "import_runs_cancel_reason_check",
      sql`"cancelReason" IN (${sql.join(IMPORT_RUN_CANCEL_REASONS.map((r: string) => sql.lit(r)))})`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("import_runs").dropConstraint("import_runs_cancel_reason_check").execute();
  await db.schema.alterTable("import_runs").dropColumn("cancelReason").execute();
  await db.schema.dropTable("docker_targets").execute();
}
