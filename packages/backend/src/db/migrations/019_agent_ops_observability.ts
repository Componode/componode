import { Kysely } from "kysely";

/**
 * Migration 019 — agent operations observability (spec 028, ADR-116
 * Amendment 3).
 *
 * `import_agents."reportedStatus"` holds the latest agent-reported ops
 * snapshot (the heartbeat `ops` payload plus a hub-stamped `receivedAt`).
 * Replace-on-write per heartbeat; NULL means the agent has never
 * reported — read surfaces translate that to "not reported by this
 * agent". No CHECK constraint: the shape is Zod-validated at the wire
 * boundary before persistence and read back verbatim.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("import_agents")
    .addColumn("reportedStatus", "jsonb")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("import_agents")
    .dropColumn("reportedStatus")
    .execute();
}
