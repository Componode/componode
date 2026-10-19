import type { Kysely } from "kysely";
import { sql } from "kysely";
import { EDGE_SUGGESTION_REASON, EDGE_SUGGESTION_STATUS } from "@componode/core";

/**
 * Migration 014 — staged edge suggestions (ADR-113, spec 022).
 *
 * `edge_suggestions` persists server-generated DEPENDS_ON candidates: one row
 * per (productId, componentId) pair. `reason`/`score` are NULL on coverage
 * tombstones — rows upserted SUPERSEDED by the edge-write path so that
 * deliberately unwired pairs never regenerate as suggestions. PENDING is the
 * only live state; ACCEPTED/DISMISSED/SUPERSEDED are terminal and enforced at
 * the service layer.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // reason is NULLable (coverage tombstones) — NULL passes a CHECK fine.
  // Convention: bare sql expression, same as migrations 010/012 — the
  // check-constraint-helper fragments include the CHECK keyword and are for
  // sql-template use, not addCheckConstraint.
  const reasonCheck = sql`reason IN (${sql.join(
    EDGE_SUGGESTION_REASON.map((r: string) => sql.lit(r)),
  )})`;
  const statusCheck = sql`status IN (${sql.join(
    EDGE_SUGGESTION_STATUS.map((s: string) => sql.lit(s)),
  )})`;

  await db.schema
    .createTable("edge_suggestions")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("productId", "uuid", (col) =>
      col.notNull().references("digital_products.id").onDelete("cascade"),
    )
    .addColumn("componentId", "uuid", (col) =>
      col.notNull().references("components.id").onDelete("cascade"),
    )
    .addColumn("reason", "text")
    .addColumn("score", "integer")
    .addColumn("status", "text", (col) => col.notNull().defaultTo("PENDING"))
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("decidedAt", "timestamptz")
    .addColumn("decidedBy", "uuid", (col) =>
      col.references("persons.id").onDelete("set null"),
    )
    .addUniqueConstraint("edge_suggestions_pair_unique", [
      "productId",
      "componentId",
    ])
    .addCheckConstraint("edge_suggestions_reason_check", reasonCheck)
    .addCheckConstraint("edge_suggestions_status_check", statusCheck)
    .execute();

  // (status, score DESC) per data-model — Kysely's createIndex has no
  // per-column ordering, so this one uses raw DDL.
  await sql`CREATE INDEX edge_suggestions_queue_idx ON edge_suggestions (status, score DESC)`.execute(
    db,
  );

  await db.schema
    .createIndex("edge_suggestions_component_idx")
    .on("edge_suggestions")
    .column("componentId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("edge_suggestions").execute();
}
