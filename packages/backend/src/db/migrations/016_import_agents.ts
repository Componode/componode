import type { Kysely } from "kysely";
import { sql } from "kysely";
import { AGENT_STATUSES, AGENT_DISCONNECT_REASONS } from "@componode/core";

/**
 * Migration 016 — Import Agents foundation (spec 025, ADR-116).
 *
 * `import_agents` holds the agent identity + credential material (hashes
 * only); `agent_sessions` is operational telemetry per connection episode —
 * not an append-only audit table (ADR-100 amendment in ADR-116).
 * `importer_configs.agentId` binds a config to an agent (nullable; null =
 * in-process execution). It is populated by spec 027; the RESTRICT delete
 * is already enforced so FR-005 holds at the DB layer.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("import_agents")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull().unique())
    .addColumn("status", "text", (col) =>
      col.notNull().defaultTo(sql.lit("NEVER_CONNECTED")),
    )
    .addColumn("agentVersion", "text")
    .addColumn("protocolVersion", "integer")
    .addColumn("importerVersions", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn("allowedImporters", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn("maxConcurrentJobs", "integer")
    .addColumn("credentialHash", "text")
    .addColumn("credentialIssuedAt", "timestamptz")
    .addColumn("enrollmentTokenHash", "text")
    .addColumn("enrollmentTokenExpiresAt", "timestamptz")
    .addColumn("enrollmentTokenUsedAt", "timestamptz")
    .addColumn("revokedAt", "timestamptz")
    .addColumn("lastSeenAt", "timestamptz")
    .addColumn("createdBy", "uuid", (col) => col.references("persons.id"))
    .addColumn("updatedBy", "uuid", (col) => col.references("persons.id"))
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "import_agents_status_check",
      sql`status IN (${sql.join(AGENT_STATUSES.map((s: string) => sql.lit(s)))})`,
    )
    .execute();

  await db.schema
    .createIndex("import_agents_status_idx")
    .on("import_agents")
    .column("status")
    .execute();
  await db.schema
    .createIndex("import_agents_credential_hash_idx")
    .on("import_agents")
    .column("credentialHash")
    .execute();
  await db.schema
    .createIndex("import_agents_enrollment_hash_idx")
    .on("import_agents")
    .column("enrollmentTokenHash")
    .execute();

  await db.schema
    .createTable("agent_sessions")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("agentId", "uuid", (col) =>
      col.notNull().references("import_agents.id").onDelete("cascade"),
    )
    .addColumn("connectedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("disconnectedAt", "timestamptz")
    .addColumn("disconnectReason", "text")
    .addColumn("remoteAddress", "text")
    .addColumn("agentVersion", "text")
    .addColumn("protocolVersion", "integer")
    .addColumn("importerVersions", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addCheckConstraint(
      "agent_sessions_disconnect_reason_check",
      sql`"disconnectReason" IS NULL OR "disconnectReason" IN (${sql.join(
        AGENT_DISCONNECT_REASONS.map((r: string) => sql.lit(r)),
      )})`,
    )
    .execute();

  await db.schema
    .createIndex("agent_sessions_agent_idx")
    .on("agent_sessions")
    .columns(["agentId", "connectedAt"])
    .execute();
  // Partial index — fast "is there a live session" check.
  await sql`CREATE INDEX agent_sessions_open_idx ON agent_sessions ("agentId") WHERE "disconnectedAt" IS NULL`.execute(db);

  await db.schema
    .alterTable("importer_configs")
    .addColumn("agentId", "uuid", (col) =>
      col.references("import_agents.id").onDelete("restrict"),
    )
    .execute();
  await db.schema
    .createIndex("importer_configs_agent_idx")
    .on("importer_configs")
    .column("agentId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("importer_configs")
    .dropColumn("agentId")
    .execute();
  await db.schema.dropTable("agent_sessions").execute();
  await db.schema.dropTable("import_agents").execute();
}
