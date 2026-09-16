import type { Kysely } from "kysely";
import { sql } from "kysely";
import { COMPONENT_CATEGORIES } from "@componode/core";

/**
 * Migration 010 — add ACCOUNT to the component category taxonomy.
 *
 * The components_category_check constraint is rebuilt from the extended
 * COMPONENT_CATEGORIES list (constitution III three-way taxonomy update).
 * Down-migration restores the pre-ACCOUNT list; it fails safely if ACCOUNT
 * rows still exist.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("components")
    .dropConstraint("components_category_check")
    .execute();

  const categoryCheck = sql`category IN (${sql.join(
    COMPONENT_CATEGORIES.map((c: string) => sql.lit(c)),
  )})`;

  await db.schema
    .alterTable("components")
    .addCheckConstraint("components_category_check", categoryCheck)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("components")
    .dropConstraint("components_category_check")
    .execute();

  const previousCategories = COMPONENT_CATEGORIES.filter(
    (c: string) => c !== "ACCOUNT",
  );
  const categoryCheck = sql`category IN (${sql.join(
    previousCategories.map((c: string) => sql.lit(c)),
  )})`;

  await db.schema
    .alterTable("components")
    .addCheckConstraint("components_category_check", categoryCheck)
    .execute();
}
