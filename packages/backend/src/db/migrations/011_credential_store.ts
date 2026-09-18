import type { Kysely } from "kysely";
import { sql } from "kysely";
import { CREDENTIAL_STATUSES } from "@componode/core";

/**
 * Migration 011 — encrypted credential store (spec 013, ADR-107).
 *
 * Adds:
 * - `credentials`: encrypted key/value secret bundles for in-app integration
 *   secrets (importer credentials, OIDC client secret). Supersedes ADR-023's
 *   "no secrets at rest" for this scope; env/file `secretRefs` remain during
 *   the deprecation window.
 * - `importer_config_credentials`: junction linking configs to credentials.
 *   credential side is ON DELETE RESTRICT so a referenced credential cannot
 *   be removed (FR-014 enforced at the DB layer).
 * - `import_runs.credentialIds`: JSONB record of which credentials a run
 *   resolved (historical; no FK so it survives credential deletion).
 * - `oidc_config.clientSecretCredentialId`: credential reference for the
 *   OIDC client secret (RESTRICT, same delete-protection).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const statusCheck = sql`status IN (${sql.join(
    CREDENTIAL_STATUSES.map((s: string) => sql.lit(s)),
  )})`;

  await db.schema
    .createTable("credentials")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("slug", "text", (col) => col.notNull().unique())
    .addColumn("label", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull().defaultTo("ACTIVE"))
    .addColumn("encryptedPayload", "text", (col) => col.notNull())
    .addColumn("keyVersion", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("keyHints", "jsonb", (col) => col.notNull().defaultTo(sql`'{}'`))
    .addColumn("expiresAt", "timestamptz")
    .addColumn("lastUsedAt", "timestamptz")
    .addColumn("createdBy", "uuid", (col) => col.references("persons.id"))
    .addColumn("updatedBy", "uuid", (col) => col.references("persons.id"))
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint("credentials_status_check", statusCheck)
    .execute();

  await db.schema
    .createIndex("credentials_status_idx")
    .on("credentials")
    .column("status")
    .execute();

  await db.schema
    .createIndex("credentials_expires_at_idx")
    .on("credentials")
    .column("expiresAt")
    .execute();

  await db.schema
    .createTable("importer_config_credentials")
    .addColumn("configId", "uuid", (col) =>
      col.notNull().references("importer_configs.id").onDelete("cascade"),
    )
    .addColumn("credentialId", "uuid", (col) =>
      col.notNull().references("credentials.id").onDelete("restrict"),
    )
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("importer_config_credentials_pk", [
      "configId",
      "credentialId",
    ])
    .execute();

  await db.schema
    .createIndex("importer_config_credentials_credential_idx")
    .on("importer_config_credentials")
    .column("credentialId")
    .execute();

  await db.schema
    .alterTable("import_runs")
    .addColumn("credentialIds", "jsonb")
    .execute();

  await db.schema
    .alterTable("oidc_config")
    .addColumn("clientSecretCredentialId", "uuid", (col) =>
      col.references("credentials.id").onDelete("restrict"),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("oidc_config")
    .dropColumn("clientSecretCredentialId")
    .execute();

  await db.schema
    .alterTable("import_runs")
    .dropColumn("credentialIds")
    .execute();

  await db.schema
    .dropIndex("importer_config_credentials_credential_idx")
    .ifExists()
    .execute();

  await db.schema.dropTable("importer_config_credentials").execute();

  await db.schema
    .dropIndex("credentials_expires_at_idx")
    .ifExists()
    .execute();

  await db.schema
    .dropIndex("credentials_status_idx")
    .ifExists()
    .execute();

  await db.schema.dropTable("credentials").execute();
}
