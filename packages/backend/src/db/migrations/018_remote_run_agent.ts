import { Kysely } from "kysely";

/**
 * Migration 018 — remote run executor (spec 027, ADR-116).
 *
 * `import_runs.agentId` records which Import Agent executed a remote run;
 * NULL means the run executed in-process. Deliberately no FK to
 * `import_agents`: the run row is history — deleting an agent must not
 * require deleting its run history (mirrors the `credentialIds` jsonb
 * precedent: the row records *who ran*, not a live relationship).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("import_runs")
    .addColumn("agentId", "uuid")
    .execute();

  await db.schema
    .createIndex("import_runs_agent_idx")
    .on("import_runs")
    .column("agentId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex("import_runs_agent_idx")
    .ifExists()
    .execute();

  await db.schema
    .alterTable("import_runs")
    .dropColumn("agentId")
    .execute();
}
