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
import { getImporter } from "./importer-registry.js";

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
  return rows.map(toApi);
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
  const keyring = await requireKeyring();
  const { encryptedPayload, keyVersion } = encryptSecrets(input.secrets, keyring);
  const keyHints = computeKeyHints(input.secrets);

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
        encryptedPayload,
        keyVersion,
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

  const importer = await getImporter(input.importerName);
  if (typeof importer.testSecrets !== "function") {
    throw codedError(
      400,
      "MANIFEST_NO_TEST",
      `Importer ${input.importerName} does not support credential testing`,
    );
  }

  const keyring = await requireKeyring();
  const secrets = decryptSecrets(row.encryptedPayload, keyring);
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
  if (rotating && row.status === "REVOKED") {
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
  const keyHints = rotating ? computeKeyHints(input.secrets!) : undefined;
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
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedBy: actor.id,
        updatedAt: now,
      })
      .where("id", "=", id)
      .execute();

    const action = rotating ? "rotated" : input.status === "REVOKED" ? "revoked" : "updated";
    const changes: Record<string, unknown> = {};
    if (input.label !== undefined) changes.label = input.label;
    if (input.expiresAt !== undefined) changes.expiresAt = input.expiresAt;
    if (rotating) changes.keyHints = keyHints;
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
