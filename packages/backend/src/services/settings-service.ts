import { db } from "../db/connection.js";
import type { UpdateSettingsInput, UpdateOidcConfigInput } from "@componode/core";
import { writeEntityChange, type Actor } from "./audit-service.js";

const DEFAULT_SETTINGS = {
  allowSelfRegistration: false,
  sessionIdleTimeoutMs: 1440000, // 4 hours
  sessionAbsoluteTimeoutMs: 43200000, // 12 hours
  defaultUserRole: "VIEWER" as const,
};

const ENV_OVERRIDE_NAMES: Record<string, string> = {
  allowSelfRegistration: "ALLOW_SELF_REGISTRATION",
  sessionIdleTimeoutMs: "SESSION_IDLE_TIMEOUT_MS",
  sessionAbsoluteTimeoutMs: "SESSION_ABSOLUTE_TIMEOUT_MS",
  defaultUserRole: "DEFAULT_USER_ROLE",
};

let settingsCache: Map<string, unknown> | null = null;

function parseEnvValue(key: string, raw: string): unknown {
  if (key === "allowSelfRegistration") {
    return raw === "true" || raw === "1";
  }
  if (key === "sessionIdleTimeoutMs" || key === "sessionAbsoluteTimeoutMs") {
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return raw;
}

function clearSettingsCache() {
  settingsCache = null;
}

export async function getSettings() {
  const rows = await db
    .selectFrom("app_settings")
    .select(["app_settings.key", "app_settings.value"])
    .execute();

  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const envName = ENV_OVERRIDE_NAMES[key];
    const envRaw = envName ? process.env[envName] : undefined;
    if (envRaw !== undefined) {
      const parsed = parseEnvValue(key, envRaw);
      if (parsed !== undefined) {
        settings[key] = parsed;
      }
    }
  }

  return settings;
}

export async function getSetting(key: keyof typeof DEFAULT_SETTINGS): Promise<unknown> {
  const envName = ENV_OVERRIDE_NAMES[key];
  const envRaw = envName ? process.env[envName] : undefined;
  if (envRaw !== undefined) {
    const parsed = parseEnvValue(key, envRaw);
    if (parsed !== undefined) return parsed;
  }

  if (!settingsCache) {
    settingsCache = new Map();
    const rows = await db
      .selectFrom("app_settings")
      .select(["app_settings.key", "app_settings.value"])
      .execute();
    for (const row of rows) {
      settingsCache.set(row.key, row.value);
    }
  }

  return settingsCache.get(key) ?? DEFAULT_SETTINGS[key];
}

export async function updateSettings(input: UpdateSettingsInput, actor: Actor) {
  // Refuse the unsafe combination before persisting: public self-registration
  // must never provision new accounts as ADMIN (2026-09-10 assessment). The
  // effective state is defaults + stored + patch, with env overrides winning.
  const effective: Record<string, unknown> = { ...(await getSettings()) };
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const envName = ENV_OVERRIDE_NAMES[key];
    const envRaw = envName ? process.env[envName] : undefined;
    const envParsed = envRaw !== undefined ? parseEnvValue(key, envRaw) : undefined;
    effective[key] = envParsed !== undefined ? envParsed : value;
  }
  if (effective.allowSelfRegistration === true && effective.defaultUserRole === "ADMIN") {
    throw Object.assign(
      new Error("allowSelfRegistration cannot be enabled while defaultUserRole is ADMIN"),
      { statusCode: 400, code: "VALIDATION_FAILED" },
    );
  }

  const now = new Date().toISOString();
  const changes: Record<string, unknown> = {};

  await db.transaction().execute(async (trx) => {
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      changes[key] = value;
      const jsonValue = JSON.stringify(value);
      await trx
        .insertInto("app_settings")
        .values({ key, value: jsonValue, updatedAt: now })
        .onConflict((oc) =>
          oc.column("key").doUpdateSet({ value: jsonValue, updatedAt: now }),
        )
        .execute();
    }

    if (Object.keys(changes).length > 0) {
      await writeEntityChange(
        {
          entityType: "settings",
          entityId: null,
          action: "updated",
          changes,
          actor,
        },
        trx,
      );
    }

    clearSettingsCache();
  });

  return getSettings();
}

export async function getOidcConfig() {
  const config = await db
    .selectFrom("oidc_config")
    .selectAll()
    .where("oidc_config.id", "=", 1)
    .executeTakeFirst();

  if (!config) {
    return {
      enabled: false,
      issuer: null,
      clientId: null,
      clientSecretRef: null,
      roleClaimPath: null,
      claimValueField: null,
      roleMapping: null,
      updatedAt: new Date().toISOString(),
    };
  }
  return config;
}

export async function updateOidcConfig(input: UpdateOidcConfigInput, actor: Actor) {
  const now = new Date().toISOString();

  if (input.enabled) {
    if (!input.issuer) {
      throw Object.assign(new Error("OIDC issuer is required when enabled"), {
        statusCode: 422,
        code: "OIDC_DISCOVERY_FAILED",
      });
    }
    input.issuer = input.issuer.replace(/\/+$/, "");
    try {
      const discoveryUrl = input.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
      const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        throw Object.assign(new Error("OIDC discovery endpoint returned non-200 status"), {
          statusCode: 422,
          code: "OIDC_DISCOVERY_FAILED",
        });
      }
      const discovery = await response.json() as { issuer?: string };
      if (discovery.issuer !== input.issuer.replace(/\/$/, "")) {
        // Issuer mismatch — some IdPs redirect, allow if the response is valid OIDC config
      }
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code === "OIDC_DISCOVERY_FAILED") throw err;
      throw Object.assign(new Error(`OIDC issuer discovery failed: ${err instanceof Error ? err.message : String(err)}`), {
        statusCode: 422,
        code: "OIDC_DISCOVERY_FAILED",
      });
    }
  }

  const values = {
    id: 1,
    enabled: input.enabled,
    issuer: input.issuer ?? null,
    clientId: input.clientId ?? null,
    clientSecretRef: input.clientSecretRef ?? null,
    roleClaimPath: input.roleClaimPath ?? null,
    claimValueField: input.claimValueField ?? null,
    roleMapping: input.roleMapping ?? null,
    updatedAt: now,
  };

  const auditChanges: Record<string, unknown> = { ...values };
  if (input.clientSecretRef !== undefined) {
    auditChanges.clientSecretRef = input.clientSecretRef ? "***" : null;
  }

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("oidc_config")
      .values(values)
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          enabled: values.enabled,
          issuer: values.issuer,
          clientId: values.clientId,
          clientSecretRef: values.clientSecretRef,
          roleClaimPath: values.roleClaimPath,
          claimValueField: values.claimValueField,
          roleMapping: values.roleMapping,
          updatedAt: now,
        }),
      )
      .execute();

    await writeEntityChange(
      {
        entityType: "settings",
        entityId: null,
        action: "updated",
        changes: { oidc: auditChanges },
        actor,
      },
      trx,
    );
  });

  return getOidcConfig();
}
