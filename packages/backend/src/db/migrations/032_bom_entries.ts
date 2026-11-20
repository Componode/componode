import { sql, type Kysely } from "kysely";
import {
  BOM_DEPENDENCY_SCOPES,
  BOM_EVIDENCE_SOURCES,
} from "@componode/core";

/**
 * Migration 032 — `bom_entries` (spec 073, ADR-131).
 *
 * Typed store for importer-reported package inventory. `parentBomEntryId`
 * (self-FK, CASCADE) preserves nested assemblies — CycloneDX
 * `components[]`, SPDX `CONTAINS`, multi-layer container images — at
 * arbitrary depth. `componentInstanceId` is nullable: entries may be
 * component-scoped or instance-scoped.
 *
 * Write semantics are source-scoped, diff-based replace on COMPLETED runs:
 * the two partial unique indexes are the upsert keys —
 * `(componentId, purl, scope, componentInstanceId)` for top-level rows and
 * the same plus `parentBomEntryId` for children. `NULLS NOT DISTINCT` is
 * required: component-level entries carry NULL `componentInstanceId`, and
 * a plain unique index treats NULLs as distinct — component-scoped BOMs
 * would re-insert every run instead of deduping.
 *
 * `resolvedComponentId` is Phase-2 surface (catalog match); nothing writes
 * it in Phase 1.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("bom_entries")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("componentId", "uuid", (col) =>
      col.notNull().references("components.id").onDelete("cascade"),
    )
    .addColumn("componentInstanceId", "uuid", (col) =>
      col.references("component_instances.id").onDelete("cascade"),
    )
    .addColumn("parentBomEntryId", "uuid", (col) =>
      col.references("bom_entries.id").onDelete("cascade"),
    )
    .addColumn("purl", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("version", "text")
    .addColumn("ecosystem", "text", (col) => col.notNull())
    .addColumn("scope", "text", (col) => col.notNull())
    .addColumn("evidenceSource", "text", (col) => col.notNull())
    .addColumn("evidenceDetail", "text")
    .addColumn("supplier", "text")
    .addColumn("licenses", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn("direct", "boolean", (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn("lastReportedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("cdxType", "text")
    .addColumn("cdxBomRef", "text")
    .addColumn("importRunId", "uuid", (col) =>
      col.references("import_runs.id").onDelete("set null"),
    )
    .addColumn("sourceId", "uuid", (col) =>
      col.references("importer_sources.id").onDelete("set null"),
    )
    .addColumn("resolvedComponentId", "uuid", (col) =>
      col.references("components.id").onDelete("set null"),
    )
    .addColumn("details", "jsonb")
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updatedAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    ALTER TABLE bom_entries
    ADD CONSTRAINT bom_entries_scope_check
    CHECK (scope IN (${sql.join(
      BOM_DEPENDENCY_SCOPES.map((s: string) => sql.lit(s)),
    )}))
  `.execute(db);

  await sql`
    ALTER TABLE bom_entries
    ADD CONSTRAINT bom_entries_evidence_source_check
    CHECK ("evidenceSource" IN (${sql.join(
      BOM_EVIDENCE_SOURCES.map((s: string) => sql.lit(s)),
    )}))
  `.execute(db);

  // Upsert keys — NULLS NOT DISTINCT so component-scoped (NULL
  // componentInstanceId) entries dedupe (PG15+).
  await sql`
    CREATE UNIQUE INDEX bom_entries_top_level_upsert_key
    ON bom_entries ("componentId", purl, scope, "componentInstanceId")
    NULLS NOT DISTINCT
    WHERE "parentBomEntryId" IS NULL
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX bom_entries_child_upsert_key
    ON bom_entries ("componentId", purl, scope, "componentInstanceId", "parentBomEntryId")
    NULLS NOT DISTINCT
    WHERE "parentBomEntryId" IS NOT NULL
  `.execute(db);

  await db.schema
    .createIndex("bom_entries_component_idx")
    .on("bom_entries")
    .column("componentId")
    .execute();
  await db.schema
    .createIndex("bom_entries_instance_idx")
    .on("bom_entries")
    .column("componentInstanceId")
    .execute();
  await db.schema
    .createIndex("bom_entries_parent_idx")
    .on("bom_entries")
    .column("parentBomEntryId")
    .execute();
  await db.schema
    .createIndex("bom_entries_purl_idx")
    .on("bom_entries")
    .column("purl")
    .execute();
  await db.schema
    .createIndex("bom_entries_resolved_idx")
    .on("bom_entries")
    .column("resolvedComponentId")
    .execute();
  await db.schema
    .createIndex("bom_entries_source_idx")
    .on("bom_entries")
    .column("sourceId")
    .execute();
  await db.schema
    .createIndex("bom_entries_ecosystem_idx")
    .on("bom_entries")
    .column("ecosystem")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("bom_entries").execute();
}
