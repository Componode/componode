import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Migration 037 — `bom_component_suggestions.bomEntryId` nullable +
 * `ON DELETE SET NULL` (spec 075 T082).
 *
 * BOM inventory pruning (`deleteAbsentBomEntries`) must not cascade-delete
 * decided suggestions: losing the row also loses the
 * (parentComponentId, childComponentId) unique guard, so a re-staged pair
 * would resurrect a DISMISSED decision. The suggestion row is provenance
 * (`bomEntryId` points at the representative entry); decided pairs are
 * terminal independent of whether that entry still exists.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("bom_component_suggestions")
    .dropConstraint("bom_component_suggestions_bomEntryId_fkey")
    .execute();

  await db.schema
    .alterTable("bom_component_suggestions")
    .alterColumn("bomEntryId", (col) => col.dropNotNull())
    .execute();

  await db.schema
    .alterTable("bom_component_suggestions")
    .addForeignKeyConstraint(
      "bom_component_suggestions_bomEntryId_fkey",
      ["bomEntryId"],
      "bom_entries",
      ["id"],
      (cb) => cb.onDelete("set null"),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("bom_component_suggestions")
    .dropConstraint("bom_component_suggestions_bomEntryId_fkey")
    .execute();

  // Re-prune any orphaned rows so NOT NULL can be restored.
  await sql`DELETE FROM bom_component_suggestions WHERE "bomEntryId" IS NULL`.execute(
    db,
  );

  await db.schema
    .alterTable("bom_component_suggestions")
    .alterColumn("bomEntryId", (col) => col.setNotNull())
    .execute();

  await db.schema
    .alterTable("bom_component_suggestions")
    .addForeignKeyConstraint(
      "bom_component_suggestions_bomEntryId_fkey",
      ["bomEntryId"],
      "bom_entries",
      ["id"],
      (cb) => cb.onDelete("cascade"),
    )
    .execute();
}
