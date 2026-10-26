import { Kysely } from "kysely";

/**
 * Migration 021 — team ↔ LOB association (spec 034, gap G12, ADR-077
 * Amendment 1).
 *
 * `teams.lobId` links a team to at most one Line of Business — the same
 * ownership-FK shape as `digital_products.lobOwnerId` and
 * `persons.teamId`. Nullable: pre-existing teams start unassociated.
 * `ON DELETE SET NULL` — deleting a LOB clears the association on its
 * teams rather than blocking (the link is advisory, unlike
 * `lobOwnerId` which is ownership and still blocks).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("teams")
    .addColumn("lobId", "uuid", (col) =>
      col.references("line_of_businesses.id").onDelete("set null"),
    )
    .execute();

  await db.schema
    .createIndex("teams_lob_id_idx")
    .on("teams")
    .column("lobId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("teams_lob_id_idx").ifExists().execute();
  await db.schema.alterTable("teams").dropColumn("lobId").execute();
}
