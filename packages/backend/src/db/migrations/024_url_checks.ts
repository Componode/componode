import type { Kysely } from "kysely";
import { sql } from "kysely";
import {
  URL_CHECK_AUTH_MODES,
  URL_CHECK_ERROR_TYPES,
  URL_CHECK_MAX_CADENCE_SECONDS,
  URL_CHECK_METHODS,
  URL_CHECK_MIN_CADENCE_SECONDS,
  URL_CHECK_OUTCOMES,
  URL_CHECK_VANTAGES,
  URL_CHECK_WINDOWS,
} from "@componode/core";

/**
 * Migration 024 — URL Check monitoring (spec 051, ADR-123/ADR-077 A3).
 *
 * Adds:
 * - `component_monitoring_setups`: one shared monitoring setup per Component
 *   (cadence + execution vantage Hub/Agent).
 * - `url_checks`: configured HTTP(S) checks attached to a ComponentInstance,
 *   with method, cadence override, success policy, availability target, and
 *   per-check auth mode + credential reference (key names only — values stay
 *   in `credentials`, ADR-107/117).
 * - `url_check_observations`: one row per probe attempt (or MISSED slot).
 *   Retention purge (30 days) is handled by the URL check scheduler.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const inList = (col: string, values: readonly string[]) =>
    sql`${sql.ref(col)} IN (${sql.join(values.map((v) => sql.lit(v)))})`;
  const vantageCheck = inList("vantage", URL_CHECK_VANTAGES);
  const methodCheck = inList("method", URL_CHECK_METHODS);
  const authModeCheck = inList("authMode", URL_CHECK_AUTH_MODES);
  const outcomeCheck = inList("outcome", URL_CHECK_OUTCOMES);
  const errorTypeCheck = inList("errorType", URL_CHECK_ERROR_TYPES);
  const targetWindowCheck = inList("targetWindow", URL_CHECK_WINDOWS);
  const cadenceCheck = sql.raw(
    `("cadenceSeconds" >= ${URL_CHECK_MIN_CADENCE_SECONDS} AND "cadenceSeconds" <= ${URL_CHECK_MAX_CADENCE_SECONDS})`,
  );

  await db.schema
    .createTable("component_monitoring_setups")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("componentId", "uuid", (col) =>
      col.notNull().unique().references("components.id").onDelete("cascade"),
    )
    .addColumn("cadenceSeconds", "integer", (col) =>
      col.notNull().defaultTo(300),
    )
    .addColumn("vantage", "text", (col) => col.notNull().defaultTo("HUB"))
    .addColumn("agentId", "uuid", (col) =>
      col.references("import_agents.id").onDelete("restrict"),
    )
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint("monitoring_setups_vantage_check", vantageCheck)
    .addCheckConstraint("monitoring_setups_cadence_check", cadenceCheck)
    .addCheckConstraint(
      "monitoring_setups_vantage_agent_check",
      sql.raw(`((vantage = 'AGENT') = ("agentId" IS NOT NULL))`),
    )
    .execute();

  await db.schema
    .createTable("url_checks")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("setupId", "uuid", (col) =>
      col
        .notNull()
        .references("component_monitoring_setups.id")
        .onDelete("cascade"),
    )
    .addColumn("componentInstanceId", "uuid", (col) =>
      col
        .notNull()
        .references("component_instances.id")
        .onDelete("cascade"),
    )
    .addColumn("credentialId", "uuid", (col) =>
      col.references("credentials.id").onDelete("restrict"),
    )
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("url", "text", (col) => col.notNull())
    .addColumn("method", "text", (col) => col.notNull().defaultTo("GET"))
    .addColumn("enabled", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("cadenceSeconds", "integer")
    .addColumn("successPolicy", "jsonb", (col) =>
      col
        .notNull()
        .defaultTo(sql.raw(`'{"codes":[],"ranges":[{"min":200,"max":299}]}'`)),
    )
    .addColumn("authMode", "text", (col) => col.notNull().defaultTo("NONE"))
    .addColumn("authConfig", "jsonb")
    .addColumn("availabilityTarget", "decimal")
    .addColumn("targetWindow", "text")
    .addColumn("nextProbeAt", "timestamptz")
    .addColumn("createdBy", "uuid", (col) => col.references("persons.id"))
    .addColumn("updatedBy", "uuid", (col) => col.references("persons.id"))
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint("url_checks_method_check", methodCheck)
    .addCheckConstraint("url_checks_auth_mode_check", authModeCheck)
    .addCheckConstraint("url_checks_target_window_check", targetWindowCheck)
    .addCheckConstraint(
      "url_checks_cadence_check",
      sql.raw(
        `("cadenceSeconds" IS NULL OR ("cadenceSeconds" >= ${URL_CHECK_MIN_CADENCE_SECONDS} AND "cadenceSeconds" <= ${URL_CHECK_MAX_CADENCE_SECONDS}))`,
      ),
    )
    .addCheckConstraint(
      "url_checks_auth_requires_credential_check",
      sql.raw(`("authMode" = 'NONE' OR "credentialId" IS NOT NULL)`),
    )
    .addCheckConstraint(
      "url_checks_target_pairing_check",
      sql.raw(`(("availabilityTarget" IS NULL) = ("targetWindow" IS NULL))`),
    )
    .execute();

  await db.schema
    .createIndex("url_checks_setup_idx")
    .on("url_checks")
    .column("setupId")
    .execute();

  await db.schema
    .createIndex("url_checks_instance_idx")
    .on("url_checks")
    .column("componentInstanceId")
    .execute();

  await db.schema
    .createIndex("url_checks_due_idx")
    .on("url_checks")
    .columns(["enabled", "nextProbeAt"])
    .execute();

  await db.schema
    .createTable("url_check_observations")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("urlCheckId", "uuid", (col) =>
      col.notNull().references("url_checks.id").onDelete("cascade"),
    )
    .addColumn("scheduledAt", "timestamptz", (col) => col.notNull())
    .addColumn("outcome", "text", (col) => col.notNull())
    .addColumn("httpStatus", "integer")
    .addColumn("durationMs", "integer")
    .addColumn("errorType", "text")
    .addColumn("vantage", "text", (col) => col.notNull())
    .addColumn("agentId", "uuid")
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint("url_check_obs_outcome_check", outcomeCheck)
    .addCheckConstraint("url_check_obs_error_type_check", errorTypeCheck)
    .addCheckConstraint("url_check_obs_vantage_check", vantageCheck)
    .execute();

  await db.schema
    .createIndex("url_check_obs_check_time_idx")
    .on("url_check_observations")
    .columns(["urlCheckId", "scheduledAt"])
    .execute();

  await db.schema
    .createIndex("url_check_obs_scheduled_idx")
    .on("url_check_observations")
    .column("scheduledAt")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("url_check_observations").execute();
  await db.schema.dropTable("url_checks").execute();
  await db.schema.dropTable("component_monitoring_setups").execute();
}
