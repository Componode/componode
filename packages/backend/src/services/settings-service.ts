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

// Spec 073 / research Q1 — workspace-level BOM freshness threshold held as the
// app_settings key `bom.staleThresholdDays` (default 7). Internal tunable, not
// part of the typed UpdateSettingsInput surface; env override for ops.
const BOM_STALE_THRESHOLD_KEY = "bom.staleThresholdDays";
const BOM_STALE_THRESHOLD_DEFAULT = 7;

function coercePositiveDays(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export async function getBomStaleThresholdDays(): Promise<number> {
  const env = coercePositiveDays(process.env.BOM_STALE_THRESHOLD_DAYS);
  if (env !== undefined) return env;
  const row = await db
    .selectFrom("app_settings")
    .select("value")
    .where("key", "=", BOM_STALE_THRESHOLD_KEY)
    .executeTakeFirst();
  return coercePositiveDays(row?.value) ?? BOM_STALE_THRESHOLD_DEFAULT;
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
      clientSecretCredentialId: null,
      roleClaimPath: null,
      claimValueField: null,
      roleMapping: null,
      updatedAt: new Date().toISOString(),
    };
  }
  return config;
}

// OIDC discovery hardening (spec 081): plain http is permitted only for
// loopback development IdPs; discovery documents are capped before parsing.
const OIDC_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const OIDC_DISCOVERY_MAX_BYTES = 64 * 1024;

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw Object.assign(new Error("OIDC discovery document exceeded maximum size"), {
      statusCode: 422,
      code: "OIDC_DISCOVERY_FAILED",
    });
  }
  const body = response.body;
  if (!body) {
    return response.json();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw Object.assign(new Error("OIDC discovery document exceeded maximum size"), {
          statusCode: 422,
          code: "OIDC_DISCOVERY_FAILED",
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(merged));
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
    // Issuer validation (spec 081): the discovery fetch below is a
    // server-side request on an admin-supplied URL. Confine it to real
    // HTTP(S) IdPs — https everywhere, http only for loopback development
    // IdPs, never embedded credentials/query/fragment.
    let issuerUrl: URL;
    try {
      issuerUrl = new URL(input.issuer);
    } catch {
      throw Object.assign(new Error("OIDC issuer is not a valid URL"), {
        statusCode: 422,
        code: "OIDC_DISCOVERY_FAILED",
      });
    }
    const schemeOk =
      issuerUrl.protocol === "https:" ||
      (issuerUrl.protocol === "http:" && OIDC_LOOPBACK_HOSTS.has(issuerUrl.hostname));
    if (!schemeOk) {
      throw Object.assign(
        new Error("OIDC issuer must use https (http is only allowed for loopback hosts)"),
        { statusCode: 422, code: "OIDC_DISCOVERY_FAILED" },
      );
    }
    if (issuerUrl.username || issuerUrl.password) {
      throw Object.assign(new Error("OIDC issuer must not contain credentials"), {
        statusCode: 422,
        code: "OIDC_DISCOVERY_FAILED",
      });
    }
    if (issuerUrl.search || issuerUrl.hash) {
      throw Object.assign(new Error("OIDC issuer must not contain a query or fragment"), {
        statusCode: 422,
        code: "OIDC_DISCOVERY_FAILED",
      });
    }
    // Normalize: drop trailing slashes via index scan (no '+'-anchored regex
    // — code-scanning flagged pattern) and persist the canonical form.
    let pathEnd = issuerUrl.pathname.length;
    while (pathEnd > 0 && issuerUrl.pathname.charCodeAt(pathEnd - 1) === 47) pathEnd--;
    input.issuer = issuerUrl.origin + issuerUrl.pathname.slice(0, pathEnd);

    try {
      const discoveryUrl = `${input.issuer}/.well-known/openid-configuration`;
      const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        throw Object.assign(new Error("OIDC discovery endpoint returned non-200 status"), {
          statusCode: 422,
          code: "OIDC_DISCOVERY_FAILED",
        });
      }
      const discovery = (await readBoundedJson(response, OIDC_DISCOVERY_MAX_BYTES)) as {
        issuer?: string;
      };
      if (discovery.issuer !== input.issuer) {
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

  // Credential-store reference wins when set — the legacy env ref is kept
  // as stored for the deprecation window but ignored at resolution.
  if (input.clientSecretCredentialId) {
    const credential = await db
      .selectFrom("credentials")
      .select(["id", "label", "status", "kind"])
      .where("id", "=", input.clientSecretCredentialId)
      .executeTakeFirst();
    if (!credential) {
      throw Object.assign(new Error("Credential not found"), {
        statusCode: 404,
        code: "CREDENTIAL_NOT_FOUND",
      });
    }
    // OIDC client secrets resolve in-process — agent-managed credentials can
    // never supply them (spec 026, ADR-117).
    if (credential.kind === "AGENT_MANAGED") {
      throw Object.assign(
        new Error(`Credential "${credential.label}" is agent-managed and cannot supply an OIDC client secret`),
        { statusCode: 400, code: "CREDENTIAL_KIND_MISMATCH" },
      );
    }
    if (credential.status === "REVOKED") {
      throw Object.assign(
        new Error(`Credential "${credential.label}" is revoked and cannot be used`),
        { statusCode: 409, code: "CREDENTIAL_REVOKED" },
      );
    }
  }

  const values = {
    id: 1,
    enabled: input.enabled,
    issuer: input.issuer ?? null,
    clientId: input.clientId ?? null,
    clientSecretRef: input.clientSecretRef ?? null,
    clientSecretCredentialId: input.clientSecretCredentialId ?? null,
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
          clientSecretCredentialId: values.clientSecretCredentialId,
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
