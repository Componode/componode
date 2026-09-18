import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { CreateImporterConfigInput, UpdateImporterConfigInput } from "@componode/core";
import { db } from "../db/connection.js";
import { getManifest } from "./importer-registry.js";
import {
  assertSecretCoverage,
  checkKeyCollisions,
  resolveSecrets,
} from "../utils/secret-resolver.js";
import { createCredential } from "./credential-service.js";
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

// --- Stored-credential references (spec 013) --------------------------------

type Executor =
  | import("kysely").Kysely<import("../db/types.js").DB>
  | import("kysely").Transaction<import("../db/types.js").DB>;

async function loadCredentialIds(executor: Executor, configIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (configIds.length === 0) return map;
  const rows = await executor
    .selectFrom("importer_config_credentials")
    .select(["configId", "credentialId"])
    .where("configId", "in", configIds)
    .execute();
  for (const row of rows) {
    const list = map.get(row.configId) ?? [];
    list.push(row.credentialId);
    map.set(row.configId, list);
  }
  return map;
}

/** Add `credentialIds` + `secretRefsDeprecated` to a masked config row. */
function attachCredentialFields<T extends { id: string; secretRefs?: unknown[] | null }>(
  row: T,
  credMap: Map<string, string[]>,
): T & { credentialIds: string[]; secretRefsDeprecated: boolean } {
  return {
    ...row,
    credentialIds: credMap.get(row.id) ?? [],
    secretRefsDeprecated: (row.secretRefs?.length ?? 0) > 0,
  };
}

/**
 * Save-time validation (FR-008/FR-009): the union of key names from legacy
 * refs and referenced credentials must cover the manifest's required keys,
 * and no key may be provided twice. Key names only — nothing is decrypted.
 */
async function validateSecretSources(
  importerName: string,
  secretRefs: Array<{ key: string; env?: string; file?: string }>,
  credentialIds: string[],
  executor: Executor,
): Promise<void> {
  const manifest = await getManifest(importerName);
  const declarations = manifest.secrets ?? [];

  const sources: Array<{ source: string; keys: string[] }> = [];
  const providedKeys: string[] = secretRefs.map((r) => r.key);
  for (const ref of secretRefs) {
    sources.push({
      source: ref.env ? `env ref "${ref.env}"` : `file ref "${ref.file}"`,
      keys: [ref.key],
    });
  }

  if (credentialIds.length > 0) {
    const credentials = await executor
      .selectFrom("credentials")
      .select(["id", "label", "status", "keyHints"])
      .where("id", "in", credentialIds)
      .execute();
    const byId = new Map(credentials.map((c) => [c.id, c]));
    for (const credentialId of credentialIds) {
      const credential = byId.get(credentialId);
      if (!credential) {
        throw Object.assign(new Error(`Credential not found: ${credentialId}`), {
          statusCode: 404,
          code: "CREDENTIAL_NOT_FOUND",
        });
      }
      if (credential.status === "REVOKED") {
        throw Object.assign(
          new Error(`Credential "${credential.label}" is revoked and cannot be used`),
          { statusCode: 409, code: "CREDENTIAL_REVOKED" },
        );
      }
      const keys = Object.keys(credential.keyHints ?? {});
      providedKeys.push(...keys);
      sources.push({ source: `credential "${credential.label}"`, keys });
    }
  }

  checkKeyCollisions(sources);
  assertSecretCoverage(declarations, providedKeys);
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
  const credMap = await loadCredentialIds(db, rows.map((r) => r.id));
  return rows.map((row) => attachCredentialFields(maskRowSecretRefs(row), credMap));
}

export async function getImporterConfig(id: string) {
  const row = await db
    .selectFrom("importer_configs")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return row;
  const credMap = await loadCredentialIds(db, [id]);
  return attachCredentialFields(maskRowSecretRefs(row), credMap);
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
    await validateSecretSources(
      input.importerName,
      input.secretRefs ?? [],
      input.credentialIds ?? [],
      trx,
    );

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

    for (const credentialId of input.credentialIds ?? []) {
      await trx
        .insertInto("importer_config_credentials")
        .values({ configId: id, credentialId })
        .execute();
    }

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

  const secretRefsChanged = input.secretRefs !== undefined;
  const credentialIdsChanged = input.credentialIds !== undefined;
  const junctionChanged = secretRefsChanged || credentialIdsChanged;

  if (Object.keys(updates).length === 0 && !credentialIdsChanged) {
    return existing;
  }

  updates.updatedBy = actor.id;
  updates.updatedAt = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    if (junctionChanged) {
      const effectiveRefs =
        input.secretRefs ?? (existing.secretRefs ?? []);
      const effectiveCredentialIds =
        input.credentialIds ?? (existing.credentialIds ?? []);
      await validateSecretSources(
        importerName,
        effectiveRefs,
        effectiveCredentialIds,
        trx,
      );
    }

    if (Object.keys(updates).length > 0) {
      await trx
        .updateTable("importer_configs")
        .set(updates)
        .where("id", "=", id)
        .execute();
    }

    if (credentialIdsChanged) {
      await trx
        .deleteFrom("importer_config_credentials")
        .where("configId", "=", id)
        .execute();
      for (const credentialId of input.credentialIds!) {
        await trx
          .insertInto("importer_config_credentials")
          .values({ configId: id, credentialId })
          .execute();
      }
    }

    await writeEntityChange(
      {
        entityType: "importer_config",
        entityId: id,
        action: "updated",
        changes: {
          ...updates,
          secretRefs: input.secretRefs !== undefined ? maskSecretRefs(input.secretRefs) : undefined,
          credentialIds: input.credentialIds,
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
  if (!row) return row;
  const credMap = await loadCredentialIds(trx, [id]);
  return attachCredentialFields(maskRowSecretRefs(row), credMap);
}

// One-click legacy migration (spec 013 US5): resolves the config's
// env/file secretRefs into a new bundle credential, links it via the
// junction, and clears secretRefs. Both sides are audited; nothing secret
// is returned.
export async function convertLegacySecrets(configId: string, actor: Actor) {
  const row = await db
    .selectFrom("importer_configs")
    .selectAll()
    .where("id", "=", configId)
    .executeTakeFirst();
  if (!row) return null;

  const refs = row.secretRefs ?? [];
  if (refs.length === 0) {
    throw Object.assign(
      new Error("Config has no legacy secret refs to convert"),
      { statusCode: 400, code: "CONVERSION_NOTHING_TO_CONVERT" },
    );
  }

  let secrets: Record<string, string>;
  try {
    secrets = await resolveSecrets(refs);
  } catch (err) {
    throw Object.assign(
      new Error(`Legacy secret could not be resolved: ${(err as Error).message}`),
      { statusCode: 502, code: "LEGACY_SECRET_UNRESOLVABLE" },
    );
  }

  const credential = await createCredential(
    { label: `${row.label} secrets`, secrets },
    actor,
  );

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("importer_config_credentials")
      .values({ configId, credentialId: credential.id })
      .execute();
    await trx
      .updateTable("importer_configs")
      .set({
        secretRefs: JSON.stringify([]) as unknown as Array<{
          key: string;
          env?: string;
          file?: string;
        }>,
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", configId)
      .execute();
    await writeEntityChange(
      {
        entityType: "importer_config",
        entityId: configId,
        action: "updated",
        changes: { secretRefs: [], credentialIds: [credential.id] },
        actor,
      },
      trx,
    );
  });

  return { credential, config: await getImporterConfig(configId) };
}
