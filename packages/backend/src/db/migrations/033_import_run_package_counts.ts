import type { Kysely } from "kysely";

/**
 * Migration 033 — package counters on `import_runs` (spec 073, UX-IMP-04).
 *
 * Mirrors the existing asset counters (`assetsCreated`/`assetsUpdated`/
 * `instancesOrphaned`/`componentsRetired`). `packagesUnchanged` counts
 * key-matched entries whose payload was identical (only `lastReportedAt`
 * refreshed); `packagesRemoved` counts entries diff-deleted at run
 * completion — the replace semantics of ADR-131.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("import_runs")
    .addColumn("packagesCreated", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn("packagesUpdated", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn("packagesUnchanged", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn("packagesRemoved", "integer", (col) =>
      col.notNull().defaultTo(0),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("import_runs")
    .dropColumn("packagesRemoved")
    .dropColumn("packagesUnchanged")
    .dropColumn("packagesUpdated")
    .dropColumn("packagesCreated")
    .execute();
}
