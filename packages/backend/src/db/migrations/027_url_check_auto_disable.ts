import type { Kysely } from "kysely";
import { sql } from "kysely";
import { URL_CHECK_AUTO_DISABLE_AFTER_MAX } from "@componode/core";

/**
 * Migration 027 — URL Check repeated-failure policy (spec 056, ADR-124
 * Amendment 3).
 *
 * Adds the auto-disable columns to `url_checks`:
 * - `autoDisableAfter`: per-check threshold override (NULL = inherit the
 *   `URL_CHECK_AUTO_DISABLE_AFTER` env default, 0 = never auto-disable).
 * - `consecutiveFailures`: maintained streak — +1 per non-SUCCESS
 *   observation (FAILURE or MISSED), reset on SUCCESS and on manual
 *   re-enable.
 * - `autoDisabledAt`: set only by the auto-disable transition, cleared on
 *   re-enable — distinguishes an auto-disabled check from a manual disable.
 *
 * Existing checks backfill to consecutiveFailures=0: their streak starts
 * clean when the policy ships.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("url_checks")
    .addColumn("autoDisableAfter", "integer")
    .addColumn("consecutiveFailures", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn("autoDisabledAt", "timestamptz")
    .execute();

  const thresholdCheck = sql`"autoDisableAfter" IS NULL OR ("autoDisableAfter" >= 0 AND "autoDisableAfter" <= ${sql.lit(
    URL_CHECK_AUTO_DISABLE_AFTER_MAX,
  )})`;

  await db.schema
    .alterTable("url_checks")
    .addCheckConstraint("url_checks_auto_disable_after_check", thresholdCheck)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("url_checks")
    .dropConstraint("url_checks_auto_disable_after_check")
    .execute();

  await db.schema
    .alterTable("url_checks")
    .dropColumn("autoDisableAfter")
    .dropColumn("consecutiveFailures")
    .dropColumn("autoDisabledAt")
    .execute();
}
