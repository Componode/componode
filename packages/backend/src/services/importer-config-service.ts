import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { CreateImporterConfigInput, UpdateImporterConfigInput } from "@componode/core";
import { db } from "../db/connection.js";
import { getManifest } from "./importer-registry.js";
import * as cron from "node-cron";
import { scheduleConfig, rescheduleConfig, unscheduleConfig } from "./scheduler-service.js";
import { writeEntityChange, type Actor } from "./audit-service.js";

function assertValidSchedule(schedule: string | null | undefined): void {
  if (!schedule) return;
  if (!cron.validate(schedule)) {
    throw Object.assign(new Error("Invalid cron expression"), {
      statusCode: 400,
      code: "VALIDATION_FAILED",
    });
  }
}

async function validateScopeForImporter(
  importerName: string,
  scope: Record<string, unknown>,
): Promise<void> {
  const manifest = await getManifest(importerName);
  const schema = manifest.configSchema as z.ZodTypeAny | undefined;
  if (!schema || typeof schema.safeParse !== "function") {
    return;
  }

  const result = schema.safeParse(scope);
  if (!result.success) {
    throw Object.assign(new Error("Scope validation failed"), {
      statusCode: 400,
      code: "VALIDATION_FAILED",
      details: result.error.issues,
    });
  }
}

function maskSecretRefs(
  secretRefs: Array<{ key: string; env?: string; file?: string }> | undefined,
): Array<{ key: string; env?: string; file?: string }> | undefined {
  if (!secretRefs) return undefined;
  return secretRefs.map((ref) => ({ key: ref.key }));
}

/** Strip env/file locations from a config row's secretRefs (response-only —
 *  the stored value is unchanged). */
function maskRowSecretRefs<T extends { secretRefs?: Array<{ key: string; env?: string; file?: string }> | null }>(row: T): T {
  return { ...row, secretRefs: maskSecretRefs(row.secretRefs ?? undefined) ?? [] };
}

export async function listImporterConfigs() {
  const rows = await db
    .selectFrom("importer_configs")
    .select([
      "id",
      "importerName",
      "label",
      "scope",
      "secretRefs",
      "schedule",
      "enabled",
      "createdAt",
      "updatedAt",
    ])
    .orderBy("createdAt", "desc")
    .execute();
  return rows.map(maskRowSecretRefs);
}

export async function getImporterConfig(id: string) {
  const row = await db
    .selectFrom("importer_configs")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? maskRowSecretRefs(row) : row;
}

export async function createImporterConfig(
  input: CreateImporterConfigInput,
  actor: Actor,
) {
  await validateScopeForImporter(input.importerName, input.scope);
  assertValidSchedule(input.schedule);

  const id = uuidv7();
  const now = new Date().toISOString();
  return db.transaction().execute(async (trx) => {
    await trx
      .insertInto("importer_configs")
      .values({
        id,
        importerName: input.importerName,
        label: input.label,
        scope: input.scope,
        secretRefs: JSON.stringify(input.secretRefs ?? []) as unknown as Array<{
          key: string;
          env?: string;
          file?: string;
        }>,
        schedule: input.schedule ?? null,
        enabled: input.enabled,
        createdBy: actor.id,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await writeEntityChange(
      {
        entityType: "importer_config",
        entityId: id,
        action: "created",
        changes: {
          ...input,
          secretRefs: maskSecretRefs(input.secretRefs),
        },
        actor,
      },
      trx,
    );

    await scheduleConfig({ id, schedule: input.schedule ?? null, enabled: input.enabled });
    return getImporterConfigWithTrx(trx, id);
  });
}

export async function updateImporterConfig(
  id: string,
  input: UpdateImporterConfigInput,
  actor: Actor,
) {
  const existing = await getImporterConfig(id);
  if (!existing) {
    return null;
  }

  const importerName = input.importerName ?? existing.importerName;
  const scope = input.scope ?? existing.scope;
  await validateScopeForImporter(importerName, scope);
  assertValidSchedule(input.schedule ?? existing.schedule);

  const updates: Record<string, unknown> = {};
  if (input.importerName !== undefined) updates.importerName = input.importerName;
  if (input.label !== undefined) updates.label = input.label;
  if (input.scope !== undefined) updates.scope = input.scope;
  if (input.secretRefs !== undefined) {
    updates.secretRefs = JSON.stringify(input.secretRefs) as unknown as Array<{
      key: string;
      env?: string;
      file?: string;
    }>;
  }
  if (input.schedule !== undefined) updates.schedule = input.schedule;
  if (input.enabled !== undefined) updates.enabled = input.enabled;

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  updates.updatedBy = actor.id;
  updates.updatedAt = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("importer_configs")
      .set(updates)
      .where("id", "=", id)
      .execute();

    await writeEntityChange(
      {
        entityType: "importer_config",
        entityId: id,
        action: "updated",
        changes: {
          ...updates,
          secretRefs: input.secretRefs !== undefined ? maskSecretRefs(input.secretRefs) : undefined,
        },
        actor,
      },
      trx,
    );

    const updated = await getImporterConfigWithTrx(trx, id);
    if (updated) {
      await rescheduleConfig({ id: updated.id, schedule: updated.schedule, enabled: updated.enabled });
    }
    return updated;
  });
}

export async function deleteImporterConfig(id: string, actor: Actor) {
  const existing = await getImporterConfig(id);
  if (!existing) {
    return null;
  }

  return db.transaction().execute(async (trx) => {
    await trx.deleteFrom("importer_configs").where("id", "=", id).execute();

    await writeEntityChange(
      {
        entityType: "importer_config",
        entityId: id,
        action: "deleted",
        changes: { label: existing.label, importerName: existing.importerName },
        actor,
      },
      trx,
    );

    unscheduleConfig(id);
    return existing;
  });
}

async function getImporterConfigWithTrx(
  trx: import("kysely").Transaction<import("../db/types.js").DB> | typeof db,
  id: string,
) {
  const row = await trx
    .selectFrom("importer_configs")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? maskRowSecretRefs(row) : row;
}
