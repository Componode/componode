import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { Actor } from "./audit-service.js";
import { writeEntityChange } from "./audit-service.js";
import { db } from "../db/connection.js";
import type { DB, DockerTargetRow } from "../db/types.js";
import { sql, type Kysely, type Transaction } from "kysely";
import { getImporter, getManifest } from "./importer-registry.js";
import { decryptSecrets, loadKeyring } from "../utils/credential-crypto.js";
import type {
  CreateDockerTargetInput,
  ListDockerTargetsQuery,
  Paginated,
  ProbeDockerTargetInput,
  TestDockerTargetInput,
  UpdateDockerTargetInput,
} from "@componode/core";
import { paginateQuery, sortTarget, type OrderTarget } from "../utils/pagination.js";

type DockerTargetSortKey = NonNullable<ListDockerTargetsQuery["sort"]>;

/** Sort whitelist mirrors listDockerTargetsQuerySchema — `name` sorts by
 *  the display `label` column (contract note, spec 069 / B.3). */
const DOCKER_TARGET_SORT_COLUMNS: Record<DockerTargetSortKey, OrderTarget> = {
  name: "docker_targets.label",
  targetId: "docker_targets.targetId",
  enabled: "docker_targets.enabled",
  createdAt: "docker_targets.createdAt",
};

type Executor = Kysely<DB> | Transaction<DB>;
type Profile = Record<string, unknown>;
type TestController = { controller: AbortController; reject: (e: Error) => void };
const activeTests = new Map<string, Set<TestController>>();

const err = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const api = (r: Omit<DockerTargetRow,"createdAt"|"updatedAt"> & {createdAt:string;updatedAt:string}) => ({ ...r, profile: r.profile as Profile });

async function validateProfile(profile: unknown): Promise<Profile> {
  const m = await getManifest("docker");
  const schema = m.targetProfileSchema as z.ZodTypeAny | undefined;
  if (!schema) throw err(400, "VALIDATION_FAILED", "Docker target profile schema is unavailable");
  const parsed = schema.safeParse(profile);
  if (!parsed.success) throw err(400, "VALIDATION_FAILED", "Invalid Docker target profile");
  return parsed.data as Profile;
}

export function profileSecretKeys(profile: Profile): string[] {
  return Object.entries(profile)
    .filter(([k, v]) => k.endsWith("Key") && typeof v === "string" && v.length > 0)
    .map(([, v]) => v as string);
}

export async function resolveHubTargetProfile(targetId: string, executor: Executor = db) {
  const row = await executor.selectFrom("docker_targets").selectAll().where("targetId", "=", targetId).executeTakeFirst();
  if (!row) throw err(404, "TARGET_NOT_FOUND", `Docker target not found: ${targetId}`);
  if (!row.enabled) throw err(409, "TARGET_DISABLED", `Docker target "${row.label}" is disabled`);
  try {
    return { target: api(row), profile: await validateProfile(row.profile) };
  } catch {
    throw err(400, "TARGET_RESOLUTION_FAILED", `Docker target "${targetId}" profile is malformed`);
  }
}

export async function assertHubDockerConfig(scope: Profile, credentialIds: string[], executor: Executor = db) {
  const targetId = scope.targetId;
  if (typeof targetId !== "string") throw err(400, "VALIDATION_FAILED", "Docker scope requires targetId");
  const { profile } = await resolveHubTargetProfile(targetId, executor);
  const required = profileSecretKeys(profile);
  if (!required.length) return;
  const creds = credentialIds.length ? await executor.selectFrom("credentials").select(["keyHints"]).where("id", "in", credentialIds).where("kind", "=", "STORED").execute() : [];
  const provided = new Set(creds.flatMap((c) => Object.keys(c.keyHints ?? {})));
  const missing = required.filter((k) => !provided.has(k));
  if (missing.length) throw err(400, "CREDENTIAL_MISSING_KEY", `Missing required secret key ${missing.map((k) => `"${k}"`).join(", ")}`);
}

// Spec 068 / ADR-130: standardized list contract — `name` sorts by the
// display `label` column; `targetId`/`enabled` are the stored columns the
// Target ID/Status cells render (the transport cell is a JSONB profile
// field, so it has no sort key — FR-005). `profile` carries connection
// metadata only (secret material stays in credentials, referenced by key
// name).
export async function listDockerTargets(
  query: ListDockerTargetsQuery,
): Promise<Paginated<ReturnType<typeof api>>> {
  let q = db.selectFrom("docker_targets").selectAll();
  if (query.search) {
    const term = `%${query.search}%`;
    q = q.where((eb) =>
      eb.or([
        eb("docker_targets.label", "ilike", term),
        eb("docker_targets.targetId", "ilike", term),
      ]),
    );
  }
  const { data, pagination } = await paginateQuery(
    q,
    { page: query.page, pageSize: query.pageSize },
    {
      orderBy: (qb) =>
        // Deterministic tie-break (ADR-130).
        qb.orderBy(
          sortTarget(DOCKER_TARGET_SORT_COLUMNS, query.sort, DOCKER_TARGET_SORT_COLUMNS.name),
          query.order,
        ).orderBy("docker_targets.id", query.order),
    },
  );
  return { data: data.map(api), pagination };
}
export async function getDockerTarget(id: string) { const r = await db.selectFrom("docker_targets").selectAll().where("id", "=", id).executeTakeFirst(); return r ? api(r) : null; }

export async function createDockerTarget(input: CreateDockerTargetInput, actor: Actor) {
  const profile = await validateProfile(input.profile);
  const dup = await db.selectFrom("docker_targets").select("id").where("targetId", "=", input.targetId).executeTakeFirst();
  if (dup) throw err(409, "CONFLICT", `Docker targetId "${input.targetId}" is already in use`);
  const id = uuidv7(); const now = new Date().toISOString();
  return db.transaction().execute(async (trx) => {
    const row = await trx.insertInto("docker_targets").values({ id, targetId: input.targetId, label: input.label, description: input.description ?? null, profile, enabled: true, createdBy: actor.id, createdAt: now, updatedAt: now }).returningAll().executeTakeFirstOrThrow();
    await writeEntityChange({ entityType: "docker_target", entityId: id, action: "created", changes: { targetId: input.targetId, label: input.label, profile }, actor }, trx);
    return api(row);
  });
}

export async function updateDockerTarget(id: string, input: UpdateDockerTargetInput, actor: Actor) {
  const existing = await getDockerTarget(id); if (!existing) return null;
  if (input.label === undefined && input.description === undefined) return existing;
  const updates = { ...(input.label !== undefined ? { label: input.label } : {}), ...(input.description !== undefined ? { description: input.description } : {}), updatedBy: actor.id, updatedAt: new Date().toISOString() };
  await db.transaction().execute(async (trx) => { await trx.updateTable("docker_targets").set(updates).where("id", "=", id).execute(); await writeEntityChange({ entityType: "docker_target", entityId: id, action: "updated", changes: updates, actor }, trx); });
  return getDockerTarget(id);
}

async function setEnabled(id: string, enabled: boolean, actor: Actor) {
  const existing = await getDockerTarget(id); if (!existing) return null;
  if (existing.enabled === enabled) return existing;
  await db.transaction().execute(async (trx) => { await trx.updateTable("docker_targets").set({ enabled, updatedBy: actor.id, updatedAt: new Date().toISOString() }).where("id", "=", id).execute(); await writeEntityChange({ entityType: "docker_target", entityId: id, action: enabled ? "enabled" : "disabled", changes: { targetId: existing.targetId, label: existing.label, profile: existing.profile }, actor }, trx); });
  if (!enabled) {
    for (const c of activeTests.get(existing.targetId) ?? []) c.controller.abort();
    const runs = await db.selectFrom("import_runs").innerJoin("importer_configs", "importer_configs.id", "import_runs.configId").select("import_runs.id").where("importer_configs.importerName", "=", "docker").where("import_runs.agentId", "is", null).where("import_runs.status", "in", ["PENDING", "RUNNING"]).where(sql`"importer_configs"."scope" ->> 'targetId'`, "=", existing.targetId).execute();
    const { cancelRun } = await import("./import-run-service.js");
    await Promise.all(runs.map((r) => cancelRun(r.id, "TARGET_DISABLED")));
  }
  return getDockerTarget(id);
}
export const enableDockerTarget = (id: string, a: Actor) => setEnabled(id, true, a);
export const disableDockerTarget = (id: string, a: Actor) => setEnabled(id, false, a);

export async function deleteDockerTarget(id: string, actor: Actor) {
  const existing = await getDockerTarget(id); if (!existing) return null;
  const inUse = await db.selectFrom("importer_configs").select("id").where("importerName", "=", "docker").where(sql`"importer_configs"."scope" ->> 'targetId'`, "=", existing.targetId).limit(1).executeTakeFirst();
  if (inUse) throw err(409, "TARGET_IN_USE", `Docker target "${existing.targetId}" is referenced by an importer config`);
  await db.transaction().execute(async (trx) => { await trx.deleteFrom("docker_targets").where("id", "=", id).execute(); await writeEntityChange({ entityType: "docker_target", entityId: id, action: "deleted", changes: { targetId: existing.targetId, label: existing.label, profile: existing.profile }, actor }, trx); });
  return existing;
}

export async function testDockerTarget(id: string, input: TestDockerTargetInput, actor: Actor) {
  const row = await db.selectFrom("docker_targets").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) throw err(404, "TARGET_NOT_FOUND", "Docker target not found");
  const finish = async (ok: boolean, error?: string) => { await writeEntityChange({ entityType: "docker_target", entityId: id, action: "tested", changes: { targetId: row.targetId, label: row.label, ok, ...(error ? { error } : {}) }, actor }); return { ok, ...(error ? { error } : {}) }; };
  if (!row.enabled) return finish(false, "TARGET_DISABLED");
  const profile = await validateProfile(row.profile);
  const keys = profileSecretKeys(profile); let scope: Profile = { targetId: row.targetId }; let credentialIds: string[] = [];
  if (keys.length) {
    if (!input.configId) return finish(false, "CREDENTIAL_MISSING_KEY");
    const cfg = await db.selectFrom("importer_configs").selectAll().where("id", "=", input.configId).executeTakeFirst();
    if (!cfg || cfg.importerName !== "docker" || cfg.agentId !== null || cfg.scope?.targetId !== row.targetId) return finish(false, "TARGET_RESOLUTION_FAILED");
    scope = cfg.scope; credentialIds = (await db.selectFrom("importer_config_credentials").select("credentialId").where("configId", "=", cfg.id).execute()).map((r) => r.credentialId);
  }
  const keyring = await loadKeyring();
  const secrets: Record<string,string> = {};
  if (credentialIds.length) {
    if (!keyring) return finish(false, "CREDENTIAL_KEY_UNAVAILABLE");
    const creds = await db.selectFrom("credentials").selectAll().where("id", "in", credentialIds).where("kind", "=", "STORED").execute();
    for (const c of creds) Object.assign(secrets, decryptSecrets(c.encryptedPayload!, keyring));
  }
  const ctl: TestController = { controller: new AbortController(), reject: () => undefined };
  const abort = new Promise<never>((_, reject) => { ctl.reject = reject; ctl.controller.signal.addEventListener("abort", () => reject(err(409, "TARGET_DISABLED", "Target was disabled"))); });
  const set = activeTests.get(row.targetId) ?? new Set(); set.add(ctl); activeTests.set(row.targetId, set);
  try { const importer = await getImporter("docker"); const result = await Promise.race([importer.testSecrets!(secrets, scope, profile), abort]); return await finish(result.ok, result.error); }
  catch (e) { return await finish(false, (e as { code?: string }).code ?? "TARGET_RESOLUTION_FAILED"); }
  finally { set.delete(ctl); }
}

/**
 * Stateless pre-persistence probe (spec 063): validates a prospective profile
 * and secret material, then runs the importer's /version probe. Writes no
 * rows and no audit events — the caller may discard the result freely.
 */
export async function probeDockerTarget(input: ProbeDockerTargetInput) {
  const profile = await validateProfile(input.profile);
  const required = profileSecretKeys(profile);
  let secrets: Record<string, string> = input.secrets ?? {};
  if (input.credentialId) {
    const cred = await db.selectFrom("credentials").selectAll().where("id", "=", input.credentialId).executeTakeFirst();
    if (!cred || cred.kind !== "STORED") throw err(404, "CREDENTIAL_NOT_FOUND", "Credential not found");
    if (cred.status === "REVOKED") throw err(409, "CREDENTIAL_REVOKED", "Credential is revoked");
    const keyring = await loadKeyring();
    if (!keyring || !cred.encryptedPayload) throw err(503, "CREDENTIAL_KEY_UNAVAILABLE", "Credential key is unavailable");
    secrets = decryptSecrets(cred.encryptedPayload, keyring);
    const provided = new Set(Object.keys(secrets));
    const missing = required.filter((k) => !provided.has(k));
    if (missing.length) throw err(400, "CREDENTIAL_MISSING_KEY", `Missing required secret key ${missing.map((k) => `"${k}"`).join(", ")}`);
  }
  const importer = await getImporter("docker");
  if (!importer.testSecrets) return { ok: false, error: "Docker importer does not support connectivity tests" };
  return importer.testSecrets(secrets, {}, profile);
}
