import type { Kysely } from "kysely";
import { sql } from "kysely";
import { EDGE_PROVENANCES, EDGE_KINDS } from "@componode/core";

/**
 * Migration 038 — edge provenance + edge suppression (spec 076, ADR-133).
 *
 * Provenance columns on the three component-edge junctions: `CURATED`
 * (human-written — every pre-existing row backfills so via the column
 * default) or `IMPORTER` (written by an opted-in import run, recording
 * which ImporterSource and run). `importerSourceId`/`importRunId` are
 * NO ACTION — the provenance CHECK below requires a Source on IMPORTER
 * rows, so a referenced Source/run cannot be deleted while importer
 * edges attribute to it (provenance is durable, never un-attributed).
 *
 * `component_edge_suppressions` makes "Hide edge" durable: a pair-keyed
 * record the edge pass consults on every completed run so a hidden edge
 * is never recreated (UX-EDGE-02). Pair scope, not per-source — Hide
 * means the edge is unwanted whoever reports it.
 */

const JUNCTIONS = [
  "component_depends_on_component",
  "component_sources_from",
  "component_exposes",
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  const provenanceCheck = sql`provenance IN (${sql.join(
    EDGE_PROVENANCES.map((p: string) => sql.lit(p)),
  )})`;

  for (const table of JUNCTIONS) {
    // Kysely's alter-table builders are single-operation — each column and
    // constraint gets its own statement.
    await db.schema
      .alterTable(table)
      .addColumn("provenance", "text", (col) =>
        col.notNull().defaultTo("CURATED"),
      )
      .execute();
    await db.schema
      .alterTable(table)
      .addColumn("importerSourceId", "uuid", (col) =>
        col.references("importer_sources.id").onDelete("no action"),
      )
      .execute();
    await db.schema
      .alterTable(table)
      .addColumn("importRunId", "uuid", (col) =>
        col.references("import_runs.id").onDelete("no action"),
      )
      .execute();
    await db.schema
      .alterTable(table)
      .addCheckConstraint(`${table}_provenance_check`, provenanceCheck)
      .execute();
    await db.schema
      .alterTable(table)
      .addCheckConstraint(
        `${table}_importer_provenance_check`,
        sql`provenance <> 'IMPORTER' OR "importerSourceId" IS NOT NULL`,
      )
      .execute();
  }

  const edgeKindCheck = sql`"edgeKind" IN (${sql.join(
    EDGE_KINDS.map((k: string) => sql.lit(k)),
  )})`;

  await db.schema
    .createTable("component_edge_suppressions")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("edgeKind", "text", (col) => col.notNull())
    .addColumn("fromComponentId", "uuid", (col) =>
      col.notNull().references("components.id").onDelete("cascade"),
    )
    .addColumn("toComponentId", "uuid", (col) =>
      col.notNull().references("components.id").onDelete("cascade"),
    )
    .addColumn("suppressedBy", "uuid", (col) =>
      col.references("persons.id").onDelete("set null"),
    )
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint("component_edge_suppressions_pair_unique", [
      "edgeKind",
      "fromComponentId",
      "toComponentId",
    ])
    .addCheckConstraint("component_edge_suppressions_kind_check", edgeKindCheck)
    .execute();

  await db.schema
    .createIndex("component_edge_suppressions_from_idx")
    .on("component_edge_suppressions")
    .column("fromComponentId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("component_edge_suppressions").execute();

  for (const table of JUNCTIONS) {
    await db.schema.alterTable(table).dropColumn("provenance").execute();
    await db.schema.alterTable(table).dropColumn("importerSourceId").execute();
    await db.schema.alterTable(table).dropColumn("importRunId").execute();
  }
}
