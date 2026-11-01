import type { Kysely } from "kysely";
import { sql } from "kysely";
import { URL_CHECK_ERROR_TYPES } from "@componode/core";

/**
 * Migration 026 — URL Check probe bounds (spec 052, ADR-124 amendment).
 *
 * Adds `SATURATED` to the `url_check_observations.errorType` CHECK list:
 * the slot could not execute because probe work exceeded a configured
 * bound (per-agent deferral overflow on the hub, or an at-cap agent
 * refusal). Recorded on MISSED observations only — monitor-side
 * capacity, not an endpoint failure.
 *
 * Down-migration restores the pre-SATURATED list; it fails safely if
 * SATURATED rows still exist.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("url_check_observations")
    .dropConstraint("url_check_obs_error_type_check")
    .execute();

  const errorTypeCheck = sql`"errorType" IN (${sql.join(
    URL_CHECK_ERROR_TYPES.map((t: string) => sql.lit(t)),
  )})`;

  await db.schema
    .alterTable("url_check_observations")
    .addCheckConstraint("url_check_obs_error_type_check", errorTypeCheck)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("url_check_observations")
    .dropConstraint("url_check_obs_error_type_check")
    .execute();

  const previousTypes = URL_CHECK_ERROR_TYPES.filter(
    (t: string) => t !== "SATURATED",
  );
  const errorTypeCheck = sql`"errorType" IN (${sql.join(
    previousTypes.map((t: string) => sql.lit(t)),
  )})`;

  await db.schema
    .alterTable("url_check_observations")
    .addCheckConstraint("url_check_obs_error_type_check", errorTypeCheck)
    .execute();
}
