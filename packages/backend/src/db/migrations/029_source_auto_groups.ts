import type { Kysely } from "kysely";

/**
 * Migration 029 — Source-scoped auto ComponentGroups (spec 067, ADR-129).
 *
 * Adds `importer_sources.componentGroupId`: the durable source→group link
 * and the auto-managed marker. A `component_groups` row is auto-managed iff
 * an ImporterSource points at it — the link survives group renames (unlike
 * a slug convention) and drives the `GROUP_AUTO_MANAGED` write guards on
 * PATCH lifecycle / DELETE.
 *
 * `ON DELETE SET NULL` is defense-in-depth: the service layer rejects
 * deletion of auto-managed groups, so the set-null path is unreachable via
 * the API; if the row is ever removed out-of-band the next grouping pass
 * re-provisions and re-links.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("importer_sources")
    .addColumn("componentGroupId", "uuid", (col) =>
      col.references("component_groups.id").onDelete("set null"),
    )
    .execute();

  await db.schema
    .createIndex("importer_sources_component_group_idx")
    .on("importer_sources")
    .column("componentGroupId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("importer_sources_component_group_idx")
    .execute();

  await db.schema
    .alterTable("importer_sources")
    .dropColumn("componentGroupId")
    .execute();
}
