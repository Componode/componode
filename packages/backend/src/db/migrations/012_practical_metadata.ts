import type { Kysely } from "kysely";
import { sql } from "kysely";
import { CRITICALITIES } from "@componode/core";

/**
 * Migration 012 — practical catalog metadata (ADR-111).
 *
 * Adds optional curated fields: `links` (jsonb) and `tags` (text[]) on
 * digital_products + components, `criticality` (CHECK from the CRITICALITIES
 * constant, products only), and `sunsetAt` on both. All additive and
 * nullable/defaulted — no backfill. Importer reconciliation writes explicit
 * column lists and never touches these fields (spec 017, FR-015).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("digital_products")
    .addColumn("links", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn("tags", sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::text[]`),
    )
    .addColumn("criticality", "text")
    .addColumn("sunsetAt", "timestamptz")
    .execute();

  const criticalityCheck = sql`criticality IS NULL OR criticality IN (${sql.join(
    CRITICALITIES.map((c: string) => sql.lit(c)),
  )})`;

  await db.schema
    .alterTable("digital_products")
    .addCheckConstraint("digital_products_criticality_check", criticalityCheck)
    .execute();

  await db.schema
    .alterTable("components")
    .addColumn("links", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn("tags", sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::text[]`),
    )
    .addColumn("sunsetAt", "timestamptz")
    .execute();

  await db.schema
    .createIndex("digital_products_tags_gin")
    .on("digital_products")
    .column("tags")
    .using("gin")
    .execute();

  await db.schema
    .createIndex("components_tags_gin")
    .on("components")
    .column("tags")
    .using("gin")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("components_tags_gin").ifExists().execute();
  await db.schema.dropIndex("digital_products_tags_gin").ifExists().execute();

  await db.schema
    .alterTable("digital_products")
    .dropConstraint("digital_products_criticality_check")
    .execute();

  await db.schema
    .alterTable("components")
    .dropColumn("sunsetAt")
    .dropColumn("tags")
    .dropColumn("links")
    .execute();

  await db.schema
    .alterTable("digital_products")
    .dropColumn("sunsetAt")
    .dropColumn("criticality")
    .dropColumn("tags")
    .dropColumn("links")
    .execute();
}
