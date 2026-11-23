import type { Kysely } from "kysely";
import { sql } from "kysely";
import {
  BOM_SUGGESTION_REASONS,
  BOM_SUGGESTION_STATUSES,
} from "@componode/core";

/**
 * Migration 035 — `bom_component_suggestions` (spec 075, ADR-132).
 *
 * ADR-113 lifecycle clone of `edge_suggestions`, for component→library
 * DEPENDS_ON candidates produced by the BOM matching pass and the
 * curation endpoints. One row per (parentComponentId, childComponentId)
 * pair ever — decided pairs are terminal and never resurrect (the upsert
 * only touches PENDING rows). `reason`/`score` are NULL on SUPERSEDED
 * tombstones (edge_suggestions parity).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // NULLable reason/score — tombstones carry NULL (passes the CHECK fine).
  const reasonCheck = sql`reason IN (${sql.join(
    BOM_SUGGESTION_REASONS.map((r: string) => sql.lit(r)),
  )})`;
  const statusCheck = sql`status IN (${sql.join(
    BOM_SUGGESTION_STATUSES.map((s: string) => sql.lit(s)),
  )})`;

  await db.schema
    .createTable("bom_component_suggestions")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("bomEntryId", "uuid", (col) =>
      col.notNull().references("bom_entries.id").onDelete("cascade"),
    )
    .addColumn("parentComponentId", "uuid", (col) =>
      col.notNull().references("components.id").onDelete("cascade"),
    )
    .addColumn("childComponentId", "uuid", (col) =>
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
    .addUniqueConstraint("bom_component_suggestions_pair_unique", [
      "parentComponentId",
      "childComponentId",
    ])
    .addCheckConstraint("bom_component_suggestions_reason_check", reasonCheck)
    .addCheckConstraint("bom_component_suggestions_status_check", statusCheck)
    .execute();

  await db.schema
    .createIndex("bom_component_suggestions_child_status_idx")
    .on("bom_component_suggestions")
    .columns(["childComponentId", "status"])
    .execute();

  await db.schema
    .createIndex("bom_component_suggestions_entry_idx")
    .on("bom_component_suggestions")
    .column("bomEntryId")
    .execute();

  // (status, score DESC) — Kysely's createIndex has no per-column ordering.
  await sql`CREATE INDEX bom_component_suggestions_queue_idx ON bom_component_suggestions (status, score DESC)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("bom_component_suggestions").execute();
}
