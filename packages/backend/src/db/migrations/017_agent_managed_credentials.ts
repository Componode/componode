import { Kysely, sql } from "kysely";
import { CREDENTIAL_KINDS } from "@componode/core";

/**
 * Migration 017 — agent-managed credentials (spec 026, ADR-117).
 *
 * Adds a `kind` discriminator to `credentials`: `STORED` (existing
 * AES-256-GCM payloads, unchanged) or `AGENT_MANAGED` (reference-only —
 * `secretRefMap` jsonb holds per-key `{env|file}` names resolved on the
 * Import Agent host; no encrypted payload exists for this kind). A
 * coherence CHECK makes the kind/payload combination unrepresentable in
 * the wrong shape.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const kindCheck = sql`"kind" IN (${sql.join(
    CREDENTIAL_KINDS.map((k: string) => sql.lit(k)),
  )})`;

  await db.schema
    .alterTable("credentials")
    .addColumn("kind", "text", (col) =>
      col.notNull().defaultTo("STORED"),
    )
    .addColumn("secretRefMap", "jsonb")
    .execute();

  await db.schema
    .alterTable("credentials")
    .alterColumn("encryptedPayload", (col) => col.dropNotNull())
    .execute();

  await db.schema
    .alterTable("credentials")
    .addCheckConstraint("credentials_kind_check", kindCheck)
    .execute();

  await db.schema
    .alterTable("credentials")
    .addCheckConstraint(
      "credentials_kind_payload_check",
      sql`("kind" = 'STORED' AND "encryptedPayload" IS NOT NULL AND "secretRefMap" IS NULL)
       OR ("kind" = 'AGENT_MANAGED' AND "secretRefMap" IS NOT NULL AND "encryptedPayload" IS NULL)`,
    )
    .execute();

  await db.schema
    .createIndex("credentials_kind_idx")
    .on("credentials")
    .column("kind")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("credentials_kind_idx")
    .ifExists()
    .execute();

  await db.schema
    .alterTable("credentials")
    .dropConstraint("credentials_kind_payload_check")
    .execute();

  await db.schema
    .alterTable("credentials")
    .dropConstraint("credentials_kind_check")
    .execute();

  // Fails if any AGENT_MANAGED rows exist — downgrade requires removing them
  // first (their refs have no pre-migration representation).
  await db.schema
    .alterTable("credentials")
    .alterColumn("encryptedPayload", (col) => col.setNotNull())
    .execute();

  await db.schema
    .alterTable("credentials")
    .dropColumn("kind")
    .dropColumn("secretRefMap")
    .execute();
}
