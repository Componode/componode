import { uuidv7 } from "uuidv7";
import type { Selectable } from "kysely";
import type {
  CreateCredentialInput,
  Credential,
  CredentialDependents,
  CredentialTestResult,
  TestCredentialInput,
  UpdateCredentialInput,
} from "@componode/core";
import { db } from "../db/connection.js";
import type { CredentialRow } from "../db/types.js";
import { writeEntityChange, type Actor } from "./audit-service.js";
import {
  decryptSecrets,
  encryptSecrets,
  loadKeyring,
  type Keyring,
} from "../utils/credential-crypto.js";
import { getImporter, getManifest } from "./importer-registry.js";
import { assertSecretCoverage } from "../utils/secret-resolver.js";
import { logger as appLogger } from "../plugins/logging.js";
import type { AgentSessionService } from "./agent-session-service.js";
import { metrics } from "../plugins/metrics.js";
import { refSource } from "@componode/core/secrets";

// Credential service (spec 013, ADR-107). Secret values are write-only:
// they are encrypted via credential-crypto before persistence and never
// appear in any return value, log, or audit payload.

export function deriveCredentialSlug(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "credential";
}

// Hints reveal the last 4 characters only when the value is long enough that
// the hint stays non-reversible — short values would leak (nearly) in full.
const MIN_HINTABLE_LENGTH = 8;

export function computeKeyHints(secrets: Record<string, string>): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    hints[key] = value.length >= MIN_HINTABLE_LENGTH ? value.slice(-4) : "****";
  }
  return hints;
}

// Agent-managed credentials (ADR-117): the hub never sees values, so hints
// are the resolution source type per key ("env"/"file") — names only.
export function computeRefHints(refMap: Record<string, { env?: string; file?: string }>): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const [key, ref] of Object.entries(refMap)) {
    hints[key] = refSource(ref);
  }
  return hints;
}

async function requireKeyring(): Promise<Keyring> {
  const keyring = await loadKeyring();
  if (!keyring) {
    throw Object.assign(
      new Error("Credential store is unavailable: no master key configured"),
      { statusCode: 503, code: "CREDENTIAL_KEY_UNAVAILABLE" },
    );
  }
  return keyring;
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 2; ; i++) {
    const existing = await db
      .selectFrom("credentials")
      .select("id")
      .where("slug", "=", slug)
      .executeTakeFirst();
    if (!existing) return slug;
    slug = `${base}-${i}`;
  }
}

function toApi(row: Selectable<CredentialRow>): Credential {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    status: row.status as Credential["status"],
    kind: row.kind as Credential["kind"],
    ...(row.secretRefMap
      ? { secretRefMap: row.secretRefMap as NonNullable<Credential["secretRefMap"]> }
      : {}),
    keyHints: row.keyHints ?? {},
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCredentials(): Promise<Credential[]> {
  const rows = await db
    .selectFrom("credentials")
    .selectAll()
    .orderBy("createdAt", "desc")
    .execute();
  // ADR-117 Amendment 1: list views get `keyHints` (key + source type)
  // only — reference names stay visible in `secretRefMap` on detail.
  return rows.map((row) => {
    const credential = toApi(row);
    delete credential.secretRefMap;
    return credential;
  });
}

export async function getDependents(credentialId: string): Promise<CredentialDependents> {
  const configs = await db
    .selectFrom("importer_config_credentials")
    .innerJoin("importer_configs", "importer_configs.id", "importer_config_credentials.configId")
    .select(["importer_configs.id", "importer_configs.label"])
    .where("importer_config_credentials.credentialId", "=", credentialId)
    .execute();

  const oidc = await db
    .selectFrom("oidc_config")
    .select("id")
    .where("clientSecretCredentialId", "=", credentialId)
    .executeTakeFirst();

  return { importerConfigs: configs, oidc: !!oidc };
}

export async function getCredential(id: string) {
  const row = await db
    .selectFrom("credentials")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  const dependents = await getDependents(row.id);
  return { credential: toApi(row), dependents };
}

export async function createCredential(
  input: CreateCredentialInput,
  actor: Actor,
): Promise<Credential> {
  // AGENT_MANAGED records carry references, not values — no keyring needed
  // and nothing is encrypted (ADR-117).
  const agentManaged = input.kind === "AGENT_MANAGED";
  const keyring = agentManaged ? null : await requireKeyring();
  const encrypted = !agentManaged
    ? encryptSecrets(input.secrets, keyring!)
    : null;
  const keyHints = agentManaged
    ? computeRefHints(input.secretRefMap)
    : computeKeyHints(input.secrets);

  const id = uuidv7();
  const now = new Date().toISOString();
  const slug = await uniqueSlug(deriveCredentialSlug(input.label));

  return db.transaction().execute(async (trx) => {
    await trx
      .insertInto("credentials")
      .values({
        id,
        slug,
        label: input.label,
        status: "ACTIVE",
        kind: input.kind,
        encryptedPayload: encrypted?.encryptedPayload ?? null,
        secretRefMap: agentManaged ? input.secretRefMap : null,
        keyVersion: encrypted?.keyVersion ?? 0,
        keyHints: keyHints as unknown as Record<string, string>,
        expiresAt: input.expiresAt ?? null,
        lastUsedAt: null,
        createdBy: actor.id,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await writeEntityChange(
      {
        entityType: "credential",
        entityId: id,
        action: "created",
        changes: {
          label: input.label,
          kind: input.kind,
          keyHints,
          expiresAt: input.expiresAt ?? null,
        },
        actor,
      },
      trx,
    );

    const row = await trx
      .selectFrom("credentials")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return toApi(row);
  });
}

function codedError(statusCode: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

// Dry-run a credential against an importer's `testSecrets` hook (spec 013
// US3). Plaintext exists only in memory for the duration of the probe; the
// result carries no secret material.
export async function testCredential(
  credentialId: string,
  input: TestCredentialInput,
  actor: Actor,
  sessions?: AgentSessionService,
): Promise<CredentialTestResult> {
  const row = await db
    .selectFrom("credentials")
    .selectAll()
    .where("id", "=", credentialId)
    .executeTakeFirst();
  if (!row) {
    throw codedError(404, "CREDENTIAL_NOT_FOUND", "Credential not found");
  }
  if (row.status === "REVOKED") {
    throw codedError(400, "CREDENTIAL_REVOKED", "Credential is revoked");
  }

  // AGENT_MANAGED: the refs are resolved on the agent host — the hub ships
  // the reference map over the agent stream, never values (ADR-117, US3).
  if (row.kind === "AGENT_MANAGED") {
    if (!sessions) {
      throw codedError(503, "AGENT_OFFLINE", "No agent session service is available");
    }
    // A test needs at least one agent-bound config referencing this
    // credential for the requested importer.
    const bound = await db
      .selectFrom("importer_config_credentials")
      .innerJoin("importer_configs", "importer_configs.id", "importer_config_credentials.configId")
      .innerJoin("import_agents", "import_agents.id", "importer_configs.agentId")
      .select([
        "importer_configs.id as configId",
        "importer_configs.agentId as agentId",
        "importer_configs.secretRefs as secretRefs",
        "import_agents.name as agentName",
      ])
      .where("importer_config_credentials.credentialId", "=", credentialId)
      .where("importer_configs.agentId", "is not", null)
      .where("importer_configs.importerName", "=", input.importerName)
      .orderBy("importer_configs.createdAt", "asc")
      .execute();
    if (bound.length === 0) {
      throw codedError(
        400,
        "CREDENTIAL_NO_BOUND_AGENT",
        `No agent-bound configuration for importer "${input.importerName}" references this credential`,
      );
    }

    // Coverage (spec edge case): a reference map edited to drop a required
    // key must fail the test with CREDENTIAL_MISSING_KEY naming the key —
    // the same check save-time validation runs, over the bound config's
    // full credential+legacy-ref set. One grouped query for every bound
    // config's credential keys.
    const manifest = await getManifest(input.importerName);
    const declarations = manifest.secrets ?? [];
    const linked = await db
      .selectFrom("importer_config_credentials")
      .innerJoin(
        "credentials",
        "credentials.id",
        "importer_config_credentials.credentialId",
      )
      .select([
        "importer_config_credentials.configId as configId",
        "credentials.keyHints",
      ])
      .where(
        "importer_config_credentials.configId",
        "in",
        bound.map((b) => b.configId),
      )
      .execute();
    const keysByConfig = new Map<string, string[]>();
    for (const l of linked) {
      const keys = keysByConfig.get(l.configId) ?? [];
      keys.push(
        ...Object.keys((l.keyHints ?? {}) as Record<string, string>),
      );
      keysByConfig.set(l.configId, keys);
    }

    let lastOffline: Error | null = null;
    let missingKey: Error | null = null;
    for (const candidate of bound) {
      // Broken coverage is a deterministic defect of THAT config — but any
      // bound agent is a valid probe (US3.5), so keep trying the other
      // candidates; only surface MISSING_KEY when none can dispatch.
      try {
        assertSecretCoverage(declarations, [
          ...(candidate.secretRefs ?? []).map((r) => r.key),
          ...(keysByConfig.get(candidate.configId) ?? []),
        ]);
      } catch (err) {
        missingKey ??= err as Error;
        continue;
      }

      const testId = uuidv7();
      // The dispatch audit + lastUsedAt stamp fire at send time (FR-018):
      // a timeout or mid-test disconnect still leaves the audit trail.
      let dispatched: Promise<void> | null = null;
      const markDispatched = () => {
        // Dispatch bookkeeping is best-effort and must never go unhandled:
        // the dispatch promise may not settle for the whole timeout window,
        // and an audit-write failure must not mask the test outcome.
        dispatched = (async () => {
          try {
            await db
              .updateTable("credentials")
              .set({ lastUsedAt: new Date().toISOString() })
              .where("id", "=", credentialId)
              .execute();
            await writeEntityChange({
              entityType: "import_agent",
              entityId: candidate.agentId!,
              action: "credential_test_dispatched",
              changes: {
                credentialId,
                credentialLabel: row.label,
                importerName: input.importerName,
              },
              actor,
            });
          } catch (err) {
            appLogger.warn(
              { err, credentialId },
              "credential test dispatch bookkeeping failed",
            );
          }
        })();
      };
      const recordOutcome = (ok: boolean, errorCode?: string) =>
        writeEntityChange({
          entityType: "credential",
          entityId: row.id,
          action: "tested",
          changes: {
            importer: input.importerName,
            ok,
            agent: candidate.agentName,
            ...(errorCode ? { error: errorCode } : {}),
          },
          actor,
        });
      try {
        const result = await sessions.dispatchCredentialTest(
          candidate.agentId!,
          {
            testId,
            credentialId,
            importerName: input.importerName,
            scope: input.scope,
            secretRefMap: row.secretRefMap as NonNullable<Credential["secretRefMap"]>,
          },
          markDispatched,
        );

        await dispatched;
        metrics.agentCredentialTestsTotal.inc({
          agent: candidate.agentName,
          result: result.ok ? "ok" : "error",
        });
        await recordOutcome(result.ok);
        return { ok: result.ok, error: result.error, agent: candidate.agentName };
      } catch (err) {
        await dispatched;
        const code = (err as { code?: string }).code;
        if (code === "AGENT_OFFLINE") {
          metrics.agentCredentialTestsTotal.inc({
            agent: candidate.agentName,
            result: "offline",
          });
          // A mid-test disconnect dispatched the frame — record the failed
          // outcome before trying the next bound agent.
          if (dispatched) await recordOutcome(false, code);
          lastOffline = err as Error;
          continue; // try the next bound agent
        }
        metrics.agentCredentialTestsTotal.inc({
          agent: candidate.agentName,
          result: code === "AGENT_TEST_TIMEOUT" ? "timeout" : "error",
        });
        if (dispatched) await recordOutcome(false, code ?? "error");
        throw err;
      }
    }
    // Nothing dispatched: prefer the deterministic coverage defect over the
    // transient offline state — it is the actionable error.
    throw missingKey ?? lastOffline!;
  }

  const importer = await getImporter(input.importerName);
  if (typeof importer.testSecrets !== "function") {
    throw codedError(
      400,
      "MANIFEST_NO_TEST",
      `Importer ${input.importerName} does not support credential testing`,
    );
  }

  const keyring = await requireKeyring();
  const secrets = decryptSecrets(row.encryptedPayload!, keyring);
  const result = await importer.testSecrets(secrets, input.scope);

  await writeEntityChange({
    entityType: "credential",
    entityId: row.id,
    action: "tested",
    changes: { importer: input.importerName, ok: result.ok },
    actor,
  });

  return result;
}

// Lifecycle update (spec 013 US4): label/expiresAt edits, in-place payload
// rotation (`secrets` present), and one-way revocation. Rotation preserves
// the credential id and all junction links — configs keep working.
export async function updateCredential(
  id: string,
  input: UpdateCredentialInput,
  actor: Actor,
): Promise<Credential | null> {
  const row = await db
    .selectFrom("credentials")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;

  const rotating = input.secrets !== undefined;
  const refEditing = input.secretRefMap !== undefined;

  // Kind is immutable: payload fields must match the row's kind.
  if (rotating && row.kind === "AGENT_MANAGED") {
    throw codedError(
      400,
      "CREDENTIAL_KIND_MISMATCH",
      "Agent-managed credentials hold references, not values — edit secretRefMap instead",
    );
  }
  if (refEditing && row.kind !== "AGENT_MANAGED") {
    throw codedError(
      400,
      "CREDENTIAL_KIND_MISMATCH",
      "secretRefMap applies only to agent-managed credentials",
    );
  }

  if ((rotating || refEditing) && row.status === "REVOKED") {
    throw codedError(
      400,
      "CREDENTIAL_REVOKED",
      "Cannot rotate a revoked credential — create a new one",
    );
  }

  const keyring = rotating ? await requireKeyring() : null;
  const encrypted = rotating
    ? encryptSecrets(input.secrets!, keyring!)
    : null;
  const keyHints = rotating
    ? computeKeyHints(input.secrets!)
    : refEditing
      ? computeRefHints(input.secretRefMap!)
      : undefined;
  const now = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("credentials")
      .set({
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        ...(encrypted
          ? { encryptedPayload: encrypted.encryptedPayload, keyVersion: encrypted.keyVersion, keyHints: keyHints as unknown as Record<string, string> }
          : {}),
        ...(refEditing
          ? { secretRefMap: input.secretRefMap!, keyHints: keyHints as unknown as Record<string, string> }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedBy: actor.id,
        updatedAt: now,
      })
      .where("id", "=", id)
      .execute();

    const action = rotating || refEditing ? "rotated" : input.status === "REVOKED" ? "revoked" : "updated";
    const changes: Record<string, unknown> = {};
    if (input.label !== undefined) changes.label = input.label;
    if (input.expiresAt !== undefined) changes.expiresAt = input.expiresAt;
    if (rotating || refEditing) changes.keyHints = keyHints;
    await writeEntityChange(
      { entityType: "credential", entityId: id, action, changes, actor },
      trx,
    );

    const updated = await trx
      .selectFrom("credentials")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return toApi(updated);
  });
}

// Deletion is blocked while anything references the credential — dependents
// are returned in the error details so the UI can list them (spec FR-014).
export async function deleteCredential(id: string, actor: Actor): Promise<void> {
  const row = await db
    .selectFrom("credentials")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) {
    throw codedError(404, "CREDENTIAL_NOT_FOUND", "Credential not found");
  }

  const dependents = await getDependents(id);
  if (dependents.importerConfigs.length > 0 || dependents.oidc) {
    throw Object.assign(
      new Error("Credential is in use and cannot be deleted"),
      { statusCode: 409, code: "CREDENTIAL_IN_USE", details: dependents },
    );
  }

  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("credentials").where("id", "=", id).execute();
    await writeEntityChange(
      { entityType: "credential", entityId: id, action: "deleted", changes: { label: row.label }, actor },
      trx,
    );
  });
}
