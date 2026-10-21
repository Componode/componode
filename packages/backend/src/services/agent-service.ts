import { randomBytes } from "crypto";
import { uuidv7 } from "uuidv7";
import type { Kysely, Selectable, Transaction, Updateable } from "kysely";
import {
  AGENT_ENROLLMENT_TTL_MS,
  type AgentDisconnectReason,
  type AgentSession,
  type CreateImportAgentInput,
  type ImportAgent,
  type UpdateImportAgentInput,
} from "@componode/core";
import { db } from "../db/connection.js";
import { toJsonb } from "../db/json.js";
import type { DB, ImportAgentRow } from "../db/types.js";
import { writeEntityChange, type Actor } from "./audit-service.js";
import { hashToken } from "../utils/crypto.js";
import { getManifests } from "./importer-registry.js";

// Minimal seam so the session service can be injected without a circular
// import (agent-channel route wires the real instance).
export interface AgentSessionDropper {
  dropAgent(agentId: string, reason: AgentDisconnectReason): Promise<void>;
}

// Import Agent service (spec 025, ADR-116). Credential and enrollment token
// material is stored hashed only; plaintext is returned once at issuance and
// never persisted or logged.

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function toApi(
  row: Selectable<ImportAgentRow>,
  boundConfigCount: number,
): ImportAgent {
  const enrollmentPending =
    row.enrollmentTokenHash !== null &&
    row.enrollmentTokenUsedAt === null &&
    row.enrollmentTokenExpiresAt !== null &&
    new Date(row.enrollmentTokenExpiresAt).getTime() > Date.now();
  return {
    id: row.id,
    name: row.name,
    status: row.status as ImportAgent["status"],
    agentVersion: row.agentVersion,
    protocolVersion: row.protocolVersion,
    importerVersions: row.importerVersions ?? [],
    allowedImporters: row.allowedImporters ?? [],
    maxConcurrentJobs: row.maxConcurrentJobs,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    hasCredential: row.credentialHash !== null,
    pendingEnrollment: enrollmentPending,
    boundConfigCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type DbOrTrx = Kysely<DB> | Transaction<DB>;

async function boundConfigCounts(
  ids: string[],
  dbOrTrx: DbOrTrx = db,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const rows = await dbOrTrx
    .selectFrom("importer_configs")
    .select(["agentId"])
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("agentId", "in", ids)
    .groupBy("agentId")
    .execute();
  for (const row of rows) {
    if (row.agentId) counts.set(row.agentId, Number(row.count));
  }
  return counts;
}

export class AgentError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function validateAllowedImporters(
  names: string[] | undefined,
): Promise<string[]> {
  if (!names || names.length === 0) return names ?? [];
  const known = new Set((await getManifests()).map((m) => m.name));
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length > 0) {
    throw new AgentError(
      400,
      "VALIDATION_FAILED",
      `Unknown importers: ${unknown.join(", ")}`,
    );
  }
  return names;
}

async function assertNameFree(name: string, excludeId?: string): Promise<void> {
  let query = db
    .selectFrom("import_agents")
    .select("id")
    .where("name", "=", name);
  if (excludeId) query = query.where("id", "!=", excludeId);
  const existing = await query.executeTakeFirst();
  if (existing) {
    throw new AgentError(
      409,
      "AGENT_NAME_TAKEN",
      `Agent name "${name}" is already in use`,
    );
  }
}

// Creates the agent + issues the single-use enrollment token. The plaintext
// token is returned exactly once and never stored.
export async function createAgent(
  input: CreateImportAgentInput,
  actor: Actor,
): Promise<{
  agent: ImportAgent;
  enrollment: { token: string; expiresAt: string };
}> {
  const allowedImporters = await validateAllowedImporters(
    input.allowedImporters,
  );
  await assertNameFree(input.name);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + AGENT_ENROLLMENT_TTL_MS);
  const id = uuidv7();
  const now = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    try {
      await trx
        .insertInto("import_agents")
        .values({
          id,
          name: input.name,
          status: "NEVER_CONNECTED",
          allowedImporters: toJsonb(allowedImporters),
          enrollmentTokenHash: hashToken(token),
          enrollmentTokenExpiresAt: expiresAt.toISOString(),
          createdBy: actor.id,
          updatedBy: actor.id,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    } catch (err) {
      // check-then-insert race: a concurrent create can win the UNIQUE on
      // name between assertNameFree and this insert — map it to the same
      // 409 the pre-check produces instead of leaking a 500.
      if ((err as { code?: string }).code === "23505") {
        throw new AgentError(
          409,
          "AGENT_NAME_TAKEN",
          `Agent name "${input.name}" is already in use`,
        );
      }
      throw err;
    }

    await writeEntityChange(
      {
        entityType: "import_agent",
        entityId: id,
        action: "created",
        changes: { name: input.name, allowedImporters },
        actor,
      },
      trx,
    );

    const row = await trx
      .selectFrom("import_agents")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return {
      agent: toApi(row, 0),
      enrollment: { token, expiresAt: expiresAt.toISOString() },
    };
  });
}

export async function listAgents(): Promise<ImportAgent[]> {
  const rows = await db
    .selectFrom("import_agents")
    .selectAll()
    .orderBy("name", "asc")
    .execute();
  const counts = await boundConfigCounts(rows.map((r) => r.id));
  return rows.map((r) => toApi(r, counts.get(r.id) ?? 0));
}

export async function getAgent(id: string): Promise<ImportAgent | null> {
  const row = await db
    .selectFrom("import_agents")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  const counts = await boundConfigCounts([row.id]);
  return toApi(row, counts.get(row.id) ?? 0);
}

// Exchange a single-use enrollment token for a durable bearer credential.
// Returns the plaintext credential exactly once. On a rotated agent this
// replaces credentialHash — the old credential dies and its live session is
// dropped `superseded` (graceful overlap ends here, spec clarification).
export async function exchangeEnrollmentToken(
  token: string,
  sessions?: AgentSessionDropper,
): Promise<{ agentToken: string; agent: ImportAgent } | null> {
  const hash = hashToken(token);
  const nowIso = new Date().toISOString();
  const agentToken = generateToken();

  // Single-use is enforced atomically: the UPDATE's WHERE clause requires the
  // token to still be unused/unexpired/unrevoked under the row lock, so two
  // concurrent exchanges of the same token can never both succeed (ADR-116).
  const exchanged = await db.transaction().execute(async (trx) => {
    const result = await trx
      .updateTable("import_agents")
      .set({
        credentialHash: hashToken(agentToken),
        credentialIssuedAt: nowIso,
        enrollmentTokenHash: null,
        enrollmentTokenExpiresAt: null,
        enrollmentTokenUsedAt: nowIso,
        updatedAt: nowIso,
      })
      .where("enrollmentTokenHash", "=", hash)
      .where("enrollmentTokenUsedAt", "is", null)
      .where("enrollmentTokenExpiresAt", ">", nowIso)
      .where("revokedAt", "is", null)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1) return null;

    const updated = await trx
      .selectFrom("import_agents")
      .selectAll()
      .where("credentialHash", "=", hashToken(agentToken))
      .executeTakeFirstOrThrow();

    await writeEntityChange(
      {
        entityType: "import_agent",
        entityId: updated.id,
        action: "enrolled",
        changes: null,
        // Self-service act by the agent itself — no person actor.
        actor: { id: null, name: `agent:${updated.name}` },
      },
      trx,
    );

    const counts = await boundConfigCounts([updated.id], trx);
    return { row: updated, agent: toApi(updated, counts.get(updated.id) ?? 0) };
  });

  if (!exchanged) return null;

  // Drop the incumbent session only AFTER the new credential is stored — the
  // old credential was valid until this exchange (rotation overlap). A live
  // session can only exist when a prior credential did, so dropAgent is a
  // safe no-op on first enrollment. `replaced` (not `superseded`): the close
  // contract reserves `superseded` for a second connection reusing the SAME
  // credential — this session's credential is being replaced by a new one.
  if (sessions) await sessions.dropAgent(exchanged.row.id, "replaced");

  return { agentToken, agent: exchanged.agent };
}

export async function getAgentRow(
  id: string,
): Promise<Selectable<ImportAgentRow> | null> {
  return (
    (await db
      .selectFrom("import_agents")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()) ?? null
  );
}

// Issue a fresh enrollment token for an existing agent (credential rotation).
// The old durable credential stays valid until the new token is exchanged
// (graceful overlap); rotating a revoked agent clears revokedAt — this is the
// re-enablement path (spec clarifications, ADR-116 amendment).
export async function rotateAgentCredential(
  id: string,
  actor: Actor,
): Promise<{
  agent: ImportAgent;
  enrollment: { token: string; expiresAt: string };
}> {
  const existing = await getAgentRow(id);
  if (!existing)
    throw new AgentError(404, "AGENT_NOT_FOUND", "Agent not found");

  const token = generateToken();
  const expiresAt = new Date(Date.now() + AGENT_ENROLLMENT_TTL_MS);
  const nowIso = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("import_agents")
      .set({
        enrollmentTokenHash: hashToken(token),
        enrollmentTokenExpiresAt: expiresAt.toISOString(),
        enrollmentTokenUsedAt: null,
        revokedAt: null,
        updatedAt: nowIso,
        updatedBy: actor.id,
      })
      .where("id", "=", id)
      .execute();

    await writeEntityChange(
      {
        entityType: "import_agent",
        entityId: id,
        action: "token_rotated",
        changes: null,
        actor,
      },
      trx,
    );

    const row = await trx
      .selectFrom("import_agents")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    const counts = await boundConfigCounts([id], trx);
    return {
      agent: toApi(row, counts.get(id) ?? 0),
      enrollment: { token, expiresAt: expiresAt.toISOString() },
    };
  });
}

// Revoke: credential dies now, live session dropped, identity preserved.
// Re-enablement is only via rotateAgentCredential.
export async function revokeAgent(
  id: string,
  actor: Actor,
  sessions?: AgentSessionDropper,
): Promise<ImportAgent> {
  const existing = await getAgentRow(id);
  if (!existing)
    throw new AgentError(404, "AGENT_NOT_FOUND", "Agent not found");
  const nowIso = new Date().toISOString();

  const agent = await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("import_agents")
      .set({ revokedAt: nowIso, updatedAt: nowIso, updatedBy: actor.id })
      .where("id", "=", id)
      .execute();

    await writeEntityChange(
      {
        entityType: "import_agent",
        entityId: id,
        action: "revoked",
        changes: null,
        actor,
      },
      trx,
    );

    const row = await trx
      .selectFrom("import_agents")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    const counts = await boundConfigCounts([id], trx);
    return toApi(row, counts.get(id) ?? 0);
  });

  if (sessions) await sessions.dropAgent(id, "revoked");
  return agent;
}

// Delete: blocked while importer_configs reference the agent (FR-005,
// RESTRICT FK is the backstop); agent_sessions cascade with the row (spec
// clarification — the `deleted` audit entry is the durable trace).
export async function deleteAgent(
  id: string,
  actor: Actor,
  sessions?: AgentSessionDropper,
): Promise<void> {
  const existing = await getAgentRow(id);
  if (!existing)
    throw new AgentError(404, "AGENT_NOT_FOUND", "Agent not found");

  const bound = await db
    .selectFrom("importer_configs")
    .select("id")
    .where("agentId", "=", id)
    .executeTakeFirst();
  if (bound) {
    throw new AgentError(
      409,
      "AGENT_IN_USE",
      "Agent has bound importer configs",
    );
  }

  // `revoked`, not `shutdown`: the close contract reserves `shutdown` for
  // reconnect-able drops (server restart, heartbeat sweep). A deleted
  // agent's credential is gone — its reconnect hits 401 and must be
  // terminal, so tell the agent to exit rather than flap (spec edge case).
  if (sessions) await sessions.dropAgent(id, "revoked");

  await db.transaction().execute(async (trx) => {
    await writeEntityChange(
      {
        entityType: "import_agent",
        entityId: id,
        action: "deleted",
        changes: { name: existing.name },
        actor,
      },
      trx,
    );
    await trx.deleteFrom("import_agents").where("id", "=", id).execute();
  });
}

export async function listAgentSessions(
  id: string,
  limit = 50,
): Promise<AgentSession[]> {
  const existing = await getAgentRow(id);
  if (!existing)
    throw new AgentError(404, "AGENT_NOT_FOUND", "Agent not found");

  // `limit` is already bounded by `listAgentSessionsQuerySchema` at the
  // route — no second clamp here.
  const rows = await db
    .selectFrom("agent_sessions")
    .selectAll()
    .where("agentId", "=", id)
    .orderBy("connectedAt", "desc")
    .limit(limit)
    .execute();
  // disconnectReason is CHECK-constrained to AGENT_DISCONNECT_REASONS.
  return rows as AgentSession[];
}

export async function updateAgent(
  id: string,
  input: UpdateImportAgentInput,
  actor: Actor,
): Promise<ImportAgent> {
  const existing = await getAgentRow(id);
  if (!existing)
    throw new AgentError(404, "AGENT_NOT_FOUND", "Agent not found");

  const allowedImporters =
    input.allowedImporters !== undefined
      ? await validateAllowedImporters(input.allowedImporters)
      : undefined;
  if (input.name && input.name !== existing.name) {
    await assertNameFree(input.name, id);
  }

  return db.transaction().execute(async (trx) => {
    const updates: Updateable<ImportAgentRow> = {
      updatedAt: new Date().toISOString(),
      updatedBy: actor.id,
    };
    if (input.name !== undefined) updates.name = input.name;
    if (allowedImporters !== undefined) {
      updates.allowedImporters = toJsonb(allowedImporters);
    }

    try {
      await trx
        .updateTable("import_agents")
        .set(updates)
        .where("id", "=", id)
        .execute();
    } catch (err) {
      // Same check-then-write race as createAgent: a concurrent rename can
      // win the UNIQUE on name between assertNameFree and this update.
      if (input.name && (err as { code?: string }).code === "23505") {
        throw new AgentError(
          409,
          "AGENT_NAME_TAKEN",
          `Agent name "${input.name}" is already in use`,
        );
      }
      throw err;
    }

    // Policy-relevant fields (name, allowedImporters) are audited — the admin
    // must be able to trace who changed which agent could run what.
    await writeEntityChange(
      {
        entityType: "import_agent",
        entityId: id,
        action: "updated",
        changes: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(allowedImporters !== undefined ? { allowedImporters } : {}),
        },
        actor,
      },
      trx,
    );

    const row = await trx
      .selectFrom("import_agents")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    const counts = await boundConfigCounts([id], trx);
    return toApi(row, counts.get(id) ?? 0);
  });
}
