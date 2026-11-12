import { sql, type Kysely } from "kysely";
import { ENVIRONMENTS } from "@componode/core";

/**
 * Migration 031 — Manual environment override for ComponentInstances
 * (spec 071).
 *
 * `component_instances.environment` keeps its importer-reported meaning —
 * import runs continue to rewrite it every time. The three new nullable
 * columns form the human override layer: when `environmentOverride` is
 * set it wins over the reported value (effective = override ?? reported,
 * computed at serialization); `environmentOverriddenBy`/`…At` record who
 * set the current override and when. All NULL on existing rows — every
 * instance correctly starts unoverridden, so no backfill is needed.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("component_instances")
    .addColumn("environmentOverride", "text")
    .addColumn("environmentOverriddenBy", "uuid")
    .addColumn("environmentOverriddenAt", "timestamptz")
    .execute();

  await sql`
    ALTER TABLE component_instances
    ADD CONSTRAINT component_instances_environment_override_check
    CHECK ("environmentOverride" IS NULL OR "environmentOverride" IN (${sql.join(
      ENVIRONMENTS.map((e: string) => sql.lit(e)),
    )}))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE component_instances
    DROP CONSTRAINT IF EXISTS component_instances_environment_override_check
  `.execute(db);

  await db.schema
    .alterTable("component_instances")
    .dropColumn("environmentOverriddenAt")
    .dropColumn("environmentOverriddenBy")
    .dropColumn("environmentOverride")
    .execute();
}
