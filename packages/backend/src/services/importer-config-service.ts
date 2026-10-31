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
import { unmonitorSourcesForConfig } from "./importer-source-service.js";

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
 * Save-time agent-binding check (spec 027 US1, ADR-116): the agent must
 * exist, not be revoked, and — when it advertises a non-empty
 * `allowedImporters` policy — cover this config's importer.
 */
export async function assertAgentAssignable(
  executor: Executor,
  agentId: string,
  importerName: string,
): Promise<void> {
  const agent = await executor
    .selectFrom("import_agents")
    .selectAll()
    .where("id", "=", agentId)
    .executeTakeFirst();
  if (!agent) {
    throw Object.assign(new Error(`Import agent not found: ${agentId}`), {
      statusCode: 404,
      code: "AGENT_NOT_FOUND",
    });
  }
  if (agent.revokedAt !== null) {
    throw Object.assign(
      new Error(`Agent "${agent.name}" has been revoked`),
      { statusCode: 400, code: "AGENT_INCOMPATIBLE" },
    );
  }
  const allowed = agent.allowedImporters ?? [];
  if (allowed.length > 0 && !allowed.includes(importerName)) {
    throw Object.assign(
      new Error(
        `Agent "${agent.name}" is not allowed to run importer "${importerName}"`,
      ),
      { statusCode: 400, code: "AGENT_INCOMPATIBLE" },
    );
  }
}

/** Joined agent summary + read-time incompatibility flag (spec 027 US5):
 *  the flag is derived, never persisted — policy edits surface on the next
 *  read without a re-scan job. */
function isAgentIncompatible(
  agent: { revokedAt: string | null; allowedImporters: string[] } | null | undefined,
  importerName: string,
): boolean {
  if (!agent) return false;
  if (agent.revokedAt !== null) return true;
  const allowed = agent.allowedImporters ?? [];
  return allowed.length > 0 && !allowed.includes(importerName);
}

async function loadAgentSummaries(
  executor: Executor,
  agentIds: string[],
): Promise<Map<string, { id: string; name: string; status: string; revokedAt: string | null; allowedImporters: string[] }>> {
  const map = new Map<string, { id: string; name: string; status: string; revokedAt: string | null; allowedImporters: string[] }>();
  if (agentIds.length === 0) return map;
  const rows = await executor
    .selectFrom("import_agents")
    .select(["id", "name", "status", "revokedAt", "allowedImporters"])
    .where("id", "in", agentIds)
    .execute();
  for (const row of rows) map.set(row.id, row);
  return map;
}

/** Add `agent`/`agentIncompatible` to a config row that already carries
 *  `agentId` (spec 027). */
function attachAgentFields<
  T extends { id: string; importerName: string; agentId?: string | null },
>(
  row: T,
  agentMap: Map<string, { id: string; name: string; status: string; revokedAt: string | null; allowedImporters: string[] }>,
): T & { agent: { id: string; name: string; status: string } | null; agentIncompatible: boolean } {
  const agent = row.agentId ? (agentMap.get(row.agentId) ?? null) : null;
  return {
    ...row,
    agentId: row.agentId ?? null,
    agent: agent ? { id: agent.id, name: agent.name, status: agent.status } : null,
    agentIncompatible: agent ? isAgentIncompatible(agent, row.importerName) : false,
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
  agentId: string | null = null,
): Promise<void> {
  const manifest = await getManifest(importerName);
  const declarations = manifest.secrets ?? [];

  // Executor-kind enforcement (spec 027 FR-003): legacy env/file refs are
  // hub-local — a bound config must carry agent-managed credentials. Their
  // keys would count toward coverage yet never ship in job.assign.
  if (agentId && secretRefs.length > 0) {
    throw Object.assign(
      new Error(
        "Legacy env/file secret refs cannot feed an agent-bound config — convert them to an agent-managed credential",
      ),
      { statusCode: 400, code: "CREDENTIAL_KIND_MISMATCH" },
    );
  }

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
      .select(["id", "label", "status", "kind", "keyHints"])
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
      // Executor-kind enforcement (spec 026): secrets resolved on an agent
      // can only feed agent-bound configs; hub-encrypted credentials can
      // never be shipped to an agent.
      if (credential.kind === "AGENT_MANAGED" && !agentId) {
        throw Object.assign(
          new Error(
            `Credential "${credential.label}" is agent-managed and requires a config bound to an import agent`,
          ),
          { statusCode: 400, code: "CREDENTIAL_KIND_MISMATCH" },
        );
      }
      if (credential.kind !== "AGENT_MANAGED" && agentId) {
        throw Object.assign(
          new Error(
            `Credential "${credential.label}" holds hub-encrypted values and cannot be used by an agent-bound config`,
          ),
          { statusCode: 400, code: "CREDENTIAL_KIND_MISMATCH" },
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
      "agentId",
      "createdAt",
      "updatedAt",
    ])
    .orderBy("createdAt", "desc")
    .execute();
  const credMap = await loadCredentialIds(db, rows.map((r) => r.id));
  const agentMap = await loadAgentSummaries(
    db,
    rows.map((r) => r.agentId).filter((a): a is string => a !== null),
  );
  return rows.map((row) =>
    attachAgentFields(attachCredentialFields(maskRowSecretRefs(row), credMap), agentMap),
  );
}

export async function getImporterConfig(id: string) {
  const row = await db
    .selectFrom("importer_configs")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return row;
  const credMap = await loadCredentialIds(db, [id]);
  const agentMap = await loadAgentSummaries(db, row.agentId ? [row.agentId] : []);
  return attachAgentFields(attachCredentialFields(maskRowSecretRefs(row), credMap), agentMap);
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
    if (input.agentId) {
      await assertAgentAssignable(trx, input.agentId, input.importerName);
    }
    await validateSecretSources(
      input.importerName,
      input.secretRefs ?? [],
      input.credentialIds ?? [],
      trx,
      input.agentId ?? null,
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
        agentId: input.agentId ?? null,
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
  if (input.agentId !== undefined) updates.agentId = input.agentId;

  const secretRefsChanged = input.secretRefs !== undefined;
  const credentialIdsChanged = input.credentialIds !== undefined;
  const agentIdChanged = input.agentId !== undefined;
  const junctionChanged = secretRefsChanged || credentialIdsChanged;

  if (Object.keys(updates).length === 0 && !credentialIdsChanged) {
    return existing;
  }

  // The executor that will own the config after this update — credential
  // kind rules apply against THIS pair (spec 026/027).
  const effectiveAgentId =
    input.agentId !== undefined ? input.agentId : (existing.agentId ?? null);

  updates.updatedBy = actor.id;
  updates.updatedAt = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    if (input.agentId) {
      await assertAgentAssignable(trx, input.agentId, importerName);
    }
    // Executor changes re-validate credentials even when the junction did
    // not change — binding a hub config holding STORED credentials to an
    // agent must fail here, not at dispatch.
    if (junctionChanged || agentIdChanged) {
      const effectiveRefs =
        input.secretRefs ?? (existing.secretRefs ?? []);
      const effectiveCredentialIds =
        input.credentialIds ?? (existing.credentialIds ?? []);
      await validateSecretSources(
        importerName,
        effectiveRefs,
        effectiveCredentialIds,
        trx,
        effectiveAgentId,
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
    // Bound Sources go UNMONITORED before the row is removed — the FK
    // clears boundConfigId and run history keeps its sourceId
    // attribution (ADR-119, ADR-047 A1).
    await unmonitorSourcesForConfig(id, actor, trx);
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
  const agentMap = await loadAgentSummaries(trx, row.agentId ? [row.agentId] : []);
  return attachAgentFields(attachCredentialFields(maskRowSecretRefs(row), credMap), agentMap);
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

  // Same collision rule the write path enforces — the new credential's
  // keys must not overlap credentials already linked to this config.
  const linked = await db
    .selectFrom("importer_config_credentials")
    .innerJoin(
      "credentials",
      "credentials.id",
      "importer_config_credentials.credentialId",
    )
    .select(["credentials.label", "credentials.keyHints"])
    .where("importer_config_credentials.configId", "=", configId)
    .execute();
  checkKeyCollisions([
    ...linked.map((c) => ({
      source: `credential "${c.label}"`,
      keys: Object.keys(c.keyHints ?? {}),
    })),
    { source: "converted legacy secret refs", keys: refs.map((r) => r.key) },
  ]);

  // Bound configs convert to an AGENT_MANAGED credential carrying the same
  // references verbatim — the values resolve on the agent host, so nothing
  // is decrypted here and no STORED credential bypasses the kind rules.
  let credential;
  if (row.agentId) {
    const secretRefMap: Record<string, { env: string } | { file: string }> = {};
    for (const ref of refs) {
      if (ref.env) secretRefMap[ref.key] = { env: ref.env };
      else if (ref.file) secretRefMap[ref.key] = { file: ref.file };
    }
    credential = await createCredential(
      { kind: "AGENT_MANAGED", label: `${row.label} secrets`, secretRefMap },
      actor,
    );
  } else {
    let secrets: Record<string, string>;
    try {
      secrets = await resolveSecrets(refs);
    } catch (err) {
      throw Object.assign(
        new Error(`Legacy secret could not be resolved: ${(err as Error).message}`),
        { statusCode: 502, code: "LEGACY_SECRET_UNRESOLVABLE" },
      );
    }
    credential = await createCredential(
      { kind: "STORED", label: `${row.label} secrets`, secrets },
      actor,
    );
  }

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
