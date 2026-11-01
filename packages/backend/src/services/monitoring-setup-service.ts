import { uuidv7 } from "uuidv7";
import type { Kysely, Selectable, Transaction } from "kysely";
import {
  updateMonitoringSetupSchema,
  type MonitoringSetup,
  type UpdateMonitoringSetupInput,
  URL_CHECK_DEFAULT_CADENCE_SECONDS,
} from "@componode/core";
import { db } from "../db/connection.js";
import type { DB, ComponentMonitoringSetupRow } from "../db/types.js";
import { writeEntityChange, type Actor } from "./audit-service.js";

type DbOrTrx = Kysely<DB> | Transaction<DB>;

const coded = (message: string, statusCode: number, code: string) =>
  Object.assign(new Error(message), { statusCode, code });

function toApi(row: Selectable<ComponentMonitoringSetupRow>, agentName: string | null): MonitoringSetup {
  return {
    id: row.id,
    componentId: row.componentId,
    cadenceSeconds: row.cadenceSeconds,
    vantage: row.vantage as MonitoringSetup["vantage"],
    agentId: row.agentId,
    agentName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function componentExists(componentId: string): Promise<void> {
  const component = await db
    .selectFrom("components")
    .select("id")
    .where("id", "=", componentId)
    .executeTakeFirst();
  if (!component) {
    throw coded("Component not found", 404, "NOT_FOUND");
  }
}

/** Agent must exist and not be revoked (mirrors assertAgentAssignable). */
export async function assertAgentUsable(agentId: string): Promise<void> {
  const agent = await db
    .selectFrom("import_agents")
    .select(["id", "name", "revokedAt"])
    .where("id", "=", agentId)
    .executeTakeFirst();
  if (!agent) {
    throw coded(`Import agent not found: ${agentId}`, 404, "AGENT_NOT_FOUND");
  }
  if (agent.revokedAt !== null) {
    throw coded(`Agent "${agent.name}" has been revoked`, 400, "AGENT_INCOMPATIBLE");
  }
}

export async function getSetup(
  componentId: string,
): Promise<MonitoringSetup | null> {
  const row = await db
    .selectFrom("component_monitoring_setups")
    .leftJoin(
      "import_agents",
      "import_agents.id",
      "component_monitoring_setups.agentId",
    )
    .selectAll("component_monitoring_setups")
    .select("import_agents.name as agentName")
    .where("component_monitoring_setups.componentId", "=", componentId)
    .executeTakeFirst();
  if (!row) return null;
  return toApi(row, row.agentName ?? null);
}

/** Create the setup row with defaults if absent (internal — no audit). */
export async function ensureSetup(
  componentId: string,
  trx: DbOrTrx = db,
): Promise<string> {
  const existing = await trx
    .selectFrom("component_monitoring_setups")
    .select("id")
    .where("componentId", "=", componentId)
    .executeTakeFirst();
  if (existing) return existing.id;
  const id = uuidv7();
  await trx
    .insertInto("component_monitoring_setups")
    .values({
      id,
      componentId,
      cadenceSeconds: URL_CHECK_DEFAULT_CADENCE_SECONDS,
      vantage: "HUB",
      agentId: null,
    })
    .execute();
  return id;
}

export async function upsertSetup(
  componentId: string,
  input: UpdateMonitoringSetupInput,
  actor: Actor,
): Promise<MonitoringSetup> {
  const parsed = updateMonitoringSetupSchema.parse(input);
  await componentExists(componentId);

  if (parsed.vantage === "AGENT" && !parsed.agentId) {
    throw coded(
      "agentId is required when vantage is AGENT",
      400,
      "VALIDATION_FAILED",
    );
  }
  if (parsed.agentId) {
    await assertAgentUsable(parsed.agentId);
  }

  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("component_monitoring_setups")
      .selectAll()
      .where("componentId", "=", componentId)
      .executeTakeFirst();

    const changes: Record<string, unknown> = {};
    const fields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (parsed.cadenceSeconds !== undefined) {
      fields.cadenceSeconds = parsed.cadenceSeconds;
      changes.cadenceSeconds = parsed.cadenceSeconds;
    }
    if (parsed.vantage !== undefined) {
      fields.vantage = parsed.vantage;
      changes.vantage = parsed.vantage;
    }
    if (parsed.agentId !== undefined || parsed.vantage === "HUB") {
      fields.agentId = parsed.vantage === "HUB" ? null : (parsed.agentId ?? null);
      changes.agentId = fields.agentId;
    }

    let setupId: string;
    if (existing) {
      setupId = existing.id;
      await trx
        .updateTable("component_monitoring_setups")
        .set(fields)
        .where("id", "=", existing.id)
        .execute();
      await writeEntityChange(
        {
          entityType: "monitoring_setup",
          entityId: setupId,
          action: "updated",
          changes,
          actor,
        },
        trx,
      );
    } else {
      setupId = uuidv7();
      await trx
        .insertInto("component_monitoring_setups")
        .values({
          id: setupId,
          componentId,
          cadenceSeconds:
            parsed.cadenceSeconds ?? URL_CHECK_DEFAULT_CADENCE_SECONDS,
          vantage: parsed.vantage ?? "HUB",
          agentId: parsed.vantage === "AGENT" ? (parsed.agentId ?? null) : null,
        })
        .execute();
      await writeEntityChange(
        {
          entityType: "monitoring_setup",
          entityId: setupId,
          action: "created",
          changes: { componentId, ...changes },
          actor,
        },
        trx,
      );
    }

    const row = await trx
      .selectFrom("component_monitoring_setups")
      .selectAll()
      .where("id", "=", setupId)
      .executeTakeFirstOrThrow();
    const agentName = row.agentId
      ? (
          await trx
            .selectFrom("import_agents")
            .select("name")
            .where("id", "=", row.agentId)
            .executeTakeFirst()
        )?.name ?? null
      : null;
    return toApi(row, agentName);
  });
}
