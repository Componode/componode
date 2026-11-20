import { sql, type Kysely } from "kysely";
import { normalizePurlIdentity } from "@componode/core";

/**
 * Migration 034 — `bom_entries.purlIdentity` (spec 074, research D1).
 *
 * `purl` stays verbatim (display, export, upsert keys). `purlIdentity` is the
 * normalized, version-free package identity — version, qualifiers and
 * subpath stripped with purl-spec per-type casing/encoding rules via
 * packageurl-js (`normalizePurlIdentity`). It is the grouping key for
 * `GET /packages`, the match key for `GET /packages/consumers?purl=`, and
 * the Phase-2 join target for `resolvedComponentId` matching against
 * `components.externalId`.
 *
 * Normalization can't run in SQL, so the backfill is a per-row UPDATE loop
 * in TS — one pass over existing entries at migrate time. Rows whose purl
 * fails to parse keep the verbatim purl as their identity (still a stable
 * group key).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("bom_entries")
    .addColumn("purlIdentity", "text")
    .execute();

  const rows = await sql<{ id: string; purl: string }>`
    SELECT id, purl FROM bom_entries
  `.execute(db);
  for (const row of rows.rows) {
    await sql`
      UPDATE bom_entries
      SET "purlIdentity" = ${normalizePurlIdentity(row.purl) ?? row.purl}
      WHERE id = ${row.id}
    `.execute(db);
  }

  await sql`
    ALTER TABLE bom_entries
    ALTER COLUMN "purlIdentity" SET NOT NULL
  `.execute(db);

  await db.schema
    .createIndex("bom_entries_purl_identity_idx")
    .on("bom_entries")
    .column("purlIdentity")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("bom_entries_purl_identity_idx").execute();
  await db.schema
    .alterTable("bom_entries")
    .dropColumn("purlIdentity")
    .execute();
}
