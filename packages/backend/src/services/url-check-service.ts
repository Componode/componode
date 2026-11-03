import { isDeepStrictEqual } from "node:util";
import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import type { Kysely, Selectable, Transaction } from "kysely";
import {
  urlSafetyError,
  type ManagedCheckDefinition,
  type MonitoringSetup,
  type SuccessPolicy,
  type UrlCheck,
  type UrlCheckAuthConfig,
  type UrlCheckListItem,
  type UrlCheckObservation,
  type BasicAuthConfig,
  type BearerAuthConfig,
  type CustomHeadersAuthConfig,
} from "@componode/core";
import { db } from "../db/connection.js";
import type { DB, UrlCheckRow, UrlCheckObservationRow } from "../db/types.js";
import { writeEntityChange, type Actor } from "./audit-service.js";
import { ensureSetup, getSetup } from "./monitoring-setup-service.js";

type DbOrTrx = Kysely<DB> | Transaction<DB>;

const coded = (message: string, statusCode: number, code: string) =>
  Object.assign(new Error(message), { statusCode, code });

const DEFAULT_POLICY: SuccessPolicy = {
  codes: [],
  ranges: [{ min: 200, max: 299 }],
};

function toApi(row: Selectable<UrlCheckRow>): UrlCheck {
  return {
    id: row.id,
    setupId: row.setupId,
    componentInstanceId: row.componentInstanceId,
    managedKey: row.managedKey,
    credentialId: row.credentialId,
    name: row.name,
    url: row.url,
    method: row.method as UrlCheck["method"],
    enabled: row.enabled,
    cadenceSeconds: row.cadenceSeconds,
    successPolicy: (row.successPolicy as SuccessPolicy) ?? DEFAULT_POLICY,
    authMode: row.authMode as UrlCheck["authMode"],
    authConfig: (row.authConfig as UrlCheckAuthConfig | null) ?? null,
    availabilityTarget:
      row.availabilityTarget === null ? null : Number(row.availabilityTarget),
    targetWindow: row.targetWindow as UrlCheck["targetWindow"],
    nextProbeAt: row.nextProbeAt,
    autoDisableAfter: row.autoDisableAfter,
    consecutiveFailures: row.consecutiveFailures,
    autoDisabledAt: row.autoDisabledAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function observationToApi(
  row: Selectable<UrlCheckObservationRow>,
): UrlCheckObservation {
  return {
    id: row.id,
    urlCheckId: row.urlCheckId,
    scheduledAt: row.scheduledAt,
    outcome: row.outcome as UrlCheckObservation["outcome"],
    httpStatus: row.httpStatus,
    durationMs: row.durationMs,
    errorType: row.errorType as UrlCheckObservation["errorType"],
    vantage: row.vantage as UrlCheckObservation["vantage"],
    agentId: row.agentId,
    createdAt: row.createdAt,
  };
}

async function getCheckRow(id: string, executor: DbOrTrx = db) {
  const row = await executor
    .selectFrom("url_checks")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) {
    throw coded("URL check not found", 404, "URL_CHECK_NOT_FOUND");
  }
  return row;
}

/** The credential key names a check references, per auth mode. */
export function authKeyNames(
  authMode: string,
  authConfig: UrlCheckAuthConfig | null,
): string[] {
  if (authMode === "BASIC") {
    const c = authConfig as BasicAuthConfig | null;
    return c ? [c.usernameKey, c.passwordKey] : [];
  }
  if (authMode === "BEARER") {
    const c = authConfig as BearerAuthConfig | null;
    return c ? [c.tokenKey] : [];
  }
  if (authMode === "CUSTOM_HEADERS") {
    const c = authConfig as CustomHeadersAuthConfig | null;
    return c ? c.headers.map((h: { name: string; key: string }) => h.key) : [];
  }
  return [];
}

function authConfigMatchesMode(
  authMode: string,
  authConfig: UrlCheckAuthConfig | null,
): boolean {
  if (authMode === "BASIC") {
    return (
      authConfig !== null &&
      "usernameKey" in authConfig &&
      "passwordKey" in authConfig
    );
  }
  if (authMode === "BEARER") {
    return authConfig !== null && "tokenKey" in authConfig;
  }
  if (authMode === "CUSTOM_HEADERS") {
    return (
      authConfig !== null &&
      "headers" in authConfig &&
      authConfig.headers.length > 0
    );
  }
  return authConfig === null;
}

/** Validate URL (ADR-106), instance ownership, and the auth contract. */
async function validateCheck(
  trx: DbOrTrx,
  componentId: string,
  fields: {
    url?: string;
    componentInstanceId?: string;
    authMode?: string;
    credentialId?: string | null;
    authConfig?: UrlCheckAuthConfig | null;
    vantage: string;
  },
): Promise<void> {
  if (fields.url !== undefined) {
    const reason = urlSafetyError(fields.url);
    if (reason) {
      throw coded(`URL is not allowed: ${reason}`, 400, "VALIDATION_FAILED");
    }
  }

  if (fields.componentInstanceId !== undefined) {
    const instance = await trx
      .selectFrom("component_instances")
      .select("componentId")
      .where("id", "=", fields.componentInstanceId)
      .executeTakeFirst();
    if (!instance || instance.componentId !== componentId) {
      throw coded(
        "Component instance not found for this component",
        404,
        "NOT_FOUND",
      );
    }
  }

  const authMode = fields.authMode ?? "NONE";
  if (authMode !== "NONE") {
    // Auth controls exist only for API-category Components (ADR-123 §7).
    const component = await trx
      .selectFrom("components")
      .select("category")
      .where("id", "=", componentId)
      .executeTakeFirst();
    if (component?.category !== "API") {
      throw coded(
        "Check authentication is only available for API components",
        400,
        "VALIDATION_FAILED",
      );
    }
    if (!fields.credentialId) {
      throw coded(
        "credentialId is required when authMode is not NONE",
        400,
        "VALIDATION_FAILED",
      );
    }
    if (!authConfigMatchesMode(authMode, fields.authConfig ?? null)) {
      throw coded(
        "authConfig is required and must match authMode",
        400,
        "VALIDATION_FAILED",
      );
    }
    const credential = await trx
      .selectFrom("credentials")
      .select(["id", "status", "kind", "keyHints", "secretRefMap"])
      .where("id", "=", fields.credentialId)
      .executeTakeFirst();
    if (!credential) {
      throw coded("Credential not found", 404, "CREDENTIAL_NOT_FOUND");
    }
    if (credential.status !== "ACTIVE") {
      throw coded("Credential is revoked", 409, "CREDENTIAL_REVOKED");
    }
    // STORED values resolve only in the Hub — an agent-vantage check must
    // use an AGENT_MANAGED credential (values never leave their locus,
    // ADR-117; research R6).
    if (fields.vantage === "AGENT" && credential.kind !== "AGENT_MANAGED") {
      throw coded(
        "Agent-vantage checks require an agent-managed credential",
        400,
        "CREDENTIAL_KIND_MISMATCH",
      );
    }
    // Referenced key names must exist in the credential bundle.
    const available =
      credential.kind === "AGENT_MANAGED"
        ? Object.keys(
            (credential.secretRefMap as Record<string, unknown> | null) ?? {},
          )
        : Object.keys(
            (credential.keyHints as Record<string, string> | null) ?? {},
          );
    for (const key of authKeyNames(authMode, fields.authConfig ?? null)) {
      if (!available.includes(key)) {
        throw coded(
          `Credential does not contain key "${key}"`,
          400,
          "CREDENTIAL_MISSING_KEY",
        );
      }
    }
  }
}

export interface CheckListResult {
  setup: MonitoringSetup | null;
  checks: UrlCheckListItem[];
}

const RECENT_OBSERVATIONS_PER_CHECK = 12;
const SUMMARY_WINDOW_MS = 864e5; // rolling 24h — the fixed compact window

/** Shared windowed-rollup formula — listChecks summary and getMetrics must
 *  never drift (ADR-124 item 5: MISSED counts against availability only). */
function summarizeOutcomeCounts(
  success: number,
  failure: number,
  missed: number,
) {
  const scheduled = success + failure + missed;
  return {
    availability: scheduled > 0 ? success / scheduled : null,
    errorRate: success + failure > 0 ? failure / (success + failure) : null,
    coverageGap: scheduled > 0 ? missed / scheduled : 0,
  };
}

export async function listChecks(
  componentId: string,
): Promise<CheckListResult> {
  const component = await db
    .selectFrom("components")
    .select("id")
    .where("id", "=", componentId)
    .executeTakeFirst();
  if (!component) {
    throw coded("Component not found", 404, "NOT_FOUND");
  }

  const setup = await getSetup(componentId);

  const checks = await db
    .selectFrom("url_checks")
    .innerJoin(
      "component_monitoring_setups",
      "component_monitoring_setups.id",
      "url_checks.setupId",
    )
    .selectAll("url_checks")
    .where("component_monitoring_setups.componentId", "=", componentId)
    .orderBy("url_checks.name")
    .execute();

  const checkIds = checks.map((c) => c.id);

  // Latest observation per check in one query (Postgres DISTINCT ON) —
  // no per-check round trips.
  const latestRows =
    checkIds.length === 0
      ? []
      : await db
          .selectFrom("url_check_observations")
          .selectAll()
          .where("urlCheckId", "in", checkIds)
          .distinctOn("urlCheckId")
          .orderBy("urlCheckId")
          .orderBy("scheduledAt", "desc")
          .execute();
  const latestByCheck = new Map(latestRows.map((r) => [r.urlCheckId, r]));

  // Compact 24h summary per check in one GROUP BY (spec 053 US1/US2):
  // same formulas as getMetrics — MISSED counts as unsuccessful, and
  // percentiles cover SUCCESS durations only (the CASE evaluates to null
  // for other outcomes and percentile_cont ignores nulls).
  const cutoff = new Date(Date.now() - SUMMARY_WINDOW_MS).toISOString();
  const summaryRows =
    checkIds.length === 0
      ? []
      : await db
          .selectFrom("url_check_observations")
          .select((eb) => [
            "urlCheckId",
            eb.fn
              .countAll()
              .filterWhere("outcome", "=", "SUCCESS")
              .as("success"),
            eb.fn
              .countAll()
              .filterWhere("outcome", "=", "FAILURE")
              .as("failure"),
            eb.fn.countAll().filterWhere("outcome", "=", "MISSED").as("missed"),
            sql<
              number | null
            >`percentile_cont(0.95) within group (order by case when outcome = 'SUCCESS' then "durationMs" end)`.as(
              "p95",
            ),
          ])
          .where("urlCheckId", "in", checkIds)
          .where("scheduledAt", ">=", cutoff)
          .groupBy("urlCheckId")
          .execute();
  const summaryByCheck = new Map(summaryRows.map((r) => [r.urlCheckId, r]));

  // Last N observations per check in one windowed query — the payload
  // the table's outcome-dot strip renders without per-row requests.
  const recentRows =
    checkIds.length === 0
      ? []
      : await db
          .selectFrom((qb) =>
            qb
              .selectFrom("url_check_observations")
              .selectAll()
              .select(
                sql<number>`row_number() over (partition by "urlCheckId" order by "scheduledAt" desc)`.as(
                  "rn",
                ),
              )
              .where("urlCheckId", "in", checkIds)
              .as("ranked"),
          )
          .selectAll()
          .where("rn", "<=", RECENT_OBSERVATIONS_PER_CHECK)
          .orderBy("urlCheckId")
          .orderBy("scheduledAt", "desc")
          .execute();
  const recentByCheck = new Map<string, typeof recentRows>();
  for (const row of recentRows) {
    const list = recentByCheck.get(row.urlCheckId) ?? [];
    list.push(row);
    recentByCheck.set(row.urlCheckId, list);
  }

  // Owning ImporterConfig for managed checks (spec 058): the config bound
  // to the Source that declares the check — the only edit surface.
  const ownerByCheck = await ownerConfigIdByCheck(checkIds);

  const items: UrlCheckListItem[] = [];
  for (const row of checks) {
    const latest = latestByCheck.get(row.id);
    const agg = summaryByCheck.get(row.id);
    const success = Number(agg?.success ?? 0);
    const failure = Number(agg?.failure ?? 0);
    const missed = Number(agg?.missed ?? 0);
    const rollup = summarizeOutcomeCounts(success, failure, missed);
    items.push({
      ...toApi(row),
      latest: latest
        ? {
            scheduledAt: latest.scheduledAt,
            outcome: latest.outcome as UrlCheckObservation["outcome"],
            httpStatus: latest.httpStatus,
            durationMs: latest.durationMs,
            errorType: latest.errorType as UrlCheckObservation["errorType"],
            vantage: latest.vantage as UrlCheckObservation["vantage"],
          }
        : null,
      summary: {
        window: "24h",
        availability: rollup.availability,
        p95:
          agg?.p95 === null || agg?.p95 === undefined ? null : Number(agg.p95),
        coverageGap: rollup.coverageGap,
        counts: { success, failure, missed },
      },
      recent: (recentByCheck.get(row.id) ?? []).map(observationToApi),
      managedByConfigId: row.managedKey ? (ownerByCheck.get(row.id) ?? null) : null,
    });
  }
  return { setup, checks: items };
}

/** Owning ImporterConfig per managed check — the only edit surface
 * (spec 058): active Source memberships → their bound config. */
async function ownerConfigIdByCheck(
  checkIds: string[],
  executor: DbOrTrx = db,
): Promise<Map<string, string | null>> {
  if (checkIds.length === 0) return new Map();
  const rows = await executor
    .selectFrom("source_url_check_memberships")
    .innerJoin(
      "importer_sources",
      "importer_sources.id",
      "source_url_check_memberships.sourceId",
    )
    .select([
      "source_url_check_memberships.urlCheckId",
      "importer_sources.boundConfigId",
    ])
    .where("source_url_check_memberships.urlCheckId", "in", checkIds)
    .where("source_url_check_memberships.active", "=", true)
    .execute();
  return new Map(rows.map((r) => [r.urlCheckId, r.boundConfigId]));
}

export async function getCheck(id: string): Promise<UrlCheck> {
  const row = await getCheckRow(id);
  return toApi(row);
}

/** Check detail + resolved setup cadence/vantage (contracts/http-api.md). */
export async function getCheckDetail(id: string) {
  const check = await getCheck(id);
  const setup = await db
    .selectFrom("component_monitoring_setups")
    .leftJoin(
      "import_agents",
      "import_agents.id",
      "component_monitoring_setups.agentId",
    )
    .select([
      "component_monitoring_setups.cadenceSeconds as setupCadenceSeconds",
      "component_monitoring_setups.vantage",
      "import_agents.name as agentName",
    ])
    .where("component_monitoring_setups.id", "=", check.setupId)
    .executeTakeFirstOrThrow();
  // Owning ImporterConfig for managed checks (spec 058) — the only edit
  // surface; legacy checks stay null.
  const owners = check.managedKey
    ? await ownerConfigIdByCheck([check.id])
    : new Map<string, string | null>();
  return {
    ...check,
    managedByConfigId: owners.get(check.id) ?? null,
    effectiveCadenceSeconds: check.cadenceSeconds ?? setup.setupCadenceSeconds,
    vantage: setup.vantage,
    agentName: setup.agentName ?? null,
  };
}

// --- Metrics + history (US3) ---------------------------------------------

export async function getMetrics(
  checkId: string,
  window: "24h" | "7d" | "30d",
) {
  const check = await getCheckRow(checkId);
  const setup = await db
    .selectFrom("component_monitoring_setups")
    .leftJoin(
      "import_agents",
      "import_agents.id",
      "component_monitoring_setups.agentId",
    )
    .select([
      "component_monitoring_setups.vantage",
      "import_agents.name as agentName",
    ])
    .where("component_monitoring_setups.id", "=", check.setupId)
    .executeTakeFirstOrThrow();

  const windowMs = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5 }[window];
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const counts = await db
    .selectFrom("url_check_observations")
    .select((eb) => [
      eb.fn.countAll().filterWhere("outcome", "=", "SUCCESS").as("success"),
      eb.fn.countAll().filterWhere("outcome", "=", "FAILURE").as("failure"),
      eb.fn.countAll().filterWhere("outcome", "=", "MISSED").as("missed"),
    ])
    .where("urlCheckId", "=", checkId)
    .where("scheduledAt", ">=", cutoff)
    .executeTakeFirstOrThrow();

  const percentiles = await db
    .selectFrom("url_check_observations")
    .select([
      sql<
        number | null
      >`percentile_cont(0.5) within group (order by "durationMs")`.as("p50"),
      sql<
        number | null
      >`percentile_cont(0.95) within group (order by "durationMs")`.as("p95"),
      sql<
        number | null
      >`percentile_cont(0.99) within group (order by "durationMs")`.as("p99"),
    ])
    .where("urlCheckId", "=", checkId)
    .where("outcome", "=", "SUCCESS")
    .where("durationMs", "is not", null)
    .where("scheduledAt", ">=", cutoff)
    .executeTakeFirstOrThrow();

  const latest = await db
    .selectFrom("url_check_observations")
    .selectAll()
    .where("urlCheckId", "=", checkId)
    .orderBy("scheduledAt", "desc")
    .limit(1)
    .executeTakeFirst();

  const success = Number(counts.success);
  const failure = Number(counts.failure);
  const missed = Number(counts.missed);

  return {
    window,
    ...summarizeOutcomeCounts(success, failure, missed),
    p50: percentiles.p50 === null ? null : Number(percentiles.p50),
    p95: percentiles.p95 === null ? null : Number(percentiles.p95),
    p99: percentiles.p99 === null ? null : Number(percentiles.p99),
    counts: { success, failure, missed },
    latest: latest
      ? {
          scheduledAt: latest.scheduledAt,
          outcome: latest.outcome as UrlCheckObservation["outcome"],
          httpStatus: latest.httpStatus,
          durationMs: latest.durationMs,
          errorType: latest.errorType as UrlCheckObservation["errorType"],
          vantage: latest.vantage as UrlCheckObservation["vantage"],
        }
      : null,
    vantage: setup.vantage as UrlCheckObservation["vantage"],
    agentName: setup.agentName ?? null,
    target:
      check.availabilityTarget !== null && check.targetWindow !== null
        ? {
            availability: Number(check.availabilityTarget),
            window: check.targetWindow,
          }
        : null,
  };
}

export async function listObservations(
  checkId: string,
  query: { limit: number; before?: string },
) {
  await getCheckRow(checkId);
  let q = db
    .selectFrom("url_check_observations")
    .selectAll()
    .where("urlCheckId", "=", checkId)
    .orderBy("scheduledAt", "desc")
    .limit(query.limit + 1);
  if (query.before) {
    q = q.where("scheduledAt", "<", query.before);
  }
  const rows = await q.execute();
  const page = rows.slice(0, query.limit);
  return {
    observations: page.map(observationToApi),
    nextBefore:
      rows.length > query.limit && page.length > 0
        ? page[page.length - 1]!.scheduledAt
        : null,
  };
}

// --- Importer-managed checks (spec 058, ADR-126) ---------------------------



/** The stored definition fields compared during sync — a shared check
 *  never changes because another Source reported different settings. */
function checkDefinitionOf(row: Selectable<UrlCheckRow>) {
  return {
    name: row.name,
    url: row.url,
    method: row.method,
    successPolicy: row.successPolicy,
    cadenceSeconds: row.cadenceSeconds,
    authMode: row.authMode,
    credentialId: row.credentialId,
    authConfig: row.authConfig ?? null,
    availabilityTarget: row.availabilityTarget,
    targetWindow: row.targetWindow,
    autoDisableAfter: row.autoDisableAfter,
  };
}

function definitionsEqual(
  stored: ReturnType<typeof checkDefinitionOf>,
  def: ManagedCheckDefinition,
  effectiveUrl: string,
): boolean {
  return (
    stored.name === def.name &&
    stored.url === effectiveUrl &&
    stored.method === def.method &&
    isDeepStrictEqual(stored.successPolicy, def.successPolicy) &&
    (stored.cadenceSeconds ?? null) === (def.cadenceSeconds ?? null) &&
    stored.authMode === def.authMode &&
    (stored.authMode === "NONE" ? true : stored.credentialId === (def.credentialId ?? null)) &&
    isDeepStrictEqual(
      stored.authMode === "NONE" ? null : stored.authConfig,
      def.authMode === "NONE" ? null : (def.authConfig ?? null),
    ) &&
    String(stored.availabilityTarget ?? "") === String(def.availabilityTarget ?? "") &&
    (stored.targetWindow ?? null) === (def.targetWindow ?? null) &&
    (stored.autoDisableAfter ?? null) === (def.autoDisableAfter ?? null)
  );
}

/** Whether an effective, enabled Source membership schedules this check:
 *  active membership + ACTIVE Source + enabled bound config +
 *  configuredEnabled intent. */
async function hasEffectiveEnabledOwner(
  trx: DbOrTrx,
  checkId: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom("source_url_check_memberships")
    .innerJoin(
      "importer_sources",
      "importer_sources.id",
      "source_url_check_memberships.sourceId",
    )
    .innerJoin(
      "importer_configs",
      "importer_configs.id",
      "importer_sources.boundConfigId",
    )
    .select("source_url_check_memberships.id")
    .where("source_url_check_memberships.urlCheckId", "=", checkId)
    .where("source_url_check_memberships.active", "=", true)
    .where("source_url_check_memberships.configuredEnabled", "=", true)
    .where("importer_sources.status", "=", "ACTIVE")
    .where("importer_configs.enabled", "=", true)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Recompute a managed check's runtime `enabled` from its owner union.
 * An auto-disabled check stays off until an explicit config re-enable
 * clears the marker — ordinary runs never resurrect it (spec 056/058).
 */
export async function recomputeManagedCheckEnabled(
  trx: DbOrTrx,
  checkId: string,
): Promise<void> {
  const check = await trx
    .selectFrom("url_checks")
    .select(["id", "enabled", "autoDisabledAt", "managedKey"])
    .where("id", "=", checkId)
    .executeTakeFirst();
  if (!check || check.managedKey === null) return;
  const now = new Date().toISOString();
  if (check.autoDisabledAt !== null) {
    if (check.enabled) {
      await trx
        .updateTable("url_checks")
        .set({ enabled: false, nextProbeAt: null, updatedAt: now })
        .where("id", "=", checkId)
        .execute();
    }
    return;
  }
  const schedulable = await hasEffectiveEnabledOwner(trx, checkId);
  if (schedulable === check.enabled) return;
  await trx
    .updateTable("url_checks")
    .set({
      enabled: schedulable,
      nextProbeAt: schedulable ? now : null,
      updatedAt: now,
    })
    .where("id", "=", checkId)
    .execute();
}

/**
 * Sync one managed check definition for an imported ComponentInstance —
 * called inside the per-asset run transaction (spec 058). The ImporterConfig
 * scope is canonical; `url_checks` rows materialize scheduler state.
 */
export async function syncManagedCheck(
  trx: DbOrTrx,
  opts: {
    sourceId: string;
    componentId: string;
    componentInstanceId: string;
    instanceUrl: string;
    def: ManagedCheckDefinition;
    runId: string;
    actor: Actor;
  },
): Promise<{ checkId: string; conflict: string | null }> {
  const { sourceId, componentId, componentInstanceId, def, runId, actor } = opts;
  const now = new Date().toISOString();
  const effectiveUrl = def.url ?? opts.instanceUrl;

  let check = await trx
    .selectFrom("url_checks")
    .selectAll()
    .where("componentInstanceId", "=", componentInstanceId)
    .where("managedKey", "=", def.checkKey)
    .executeTakeFirst();

  if (check) {
    if (!definitionsEqual(checkDefinitionOf(check), def, effectiveUrl)) {
      // A shared definition may only change when this Source is the sole
      // owner — another owner's conflicting settings are a controlled
      // conflict, never last-writer-wins (contract managed-url-check-sync).
      const foreign = await trx
        .selectFrom("source_url_check_memberships")
        .select("id")
        .where("urlCheckId", "=", check.id)
        .where("sourceId", "!=", sourceId)
        .where("active", "=", true)
        .executeTakeFirst();
      if (foreign) {
        return { checkId: check.id, conflict: `managed check "${def.name}" (${def.checkKey}) has a conflicting definition from another Source` };
      }
      const setup = await trx
        .selectFrom("component_monitoring_setups")
        .select("vantage")
        .where("id", "=", check.setupId)
        .executeTakeFirstOrThrow();
      await validateCheck(trx, componentId, {
        url: effectiveUrl,
        authMode: def.authMode,
        credentialId: def.credentialId ?? null,
        authConfig: def.authConfig ?? null,
        vantage: setup.vantage,
      });
      await trx
        .updateTable("url_checks")
        .set({
          name: def.name,
          url: effectiveUrl,
          method: def.method,
          successPolicy: def.successPolicy,
          cadenceSeconds: def.cadenceSeconds ?? null,
          authMode: def.authMode,
          credentialId: def.authMode === "NONE" ? null : (def.credentialId ?? null),
          authConfig: def.authMode === "NONE" ? null : (def.authConfig ?? null),
          availabilityTarget: def.availabilityTarget?.toString() ?? null,
          targetWindow: def.targetWindow ?? null,
          autoDisableAfter: def.autoDisableAfter ?? null,
          updatedAt: now,
        })
        .where("id", "=", check.id)
        .execute();
      await writeEntityChange(
        {
          entityType: "url_check",
          entityId: check.id,
          action: "updated",
          importRunId: runId,
          changes: {
            name: def.name,
            url: effectiveUrl,
            method: def.method,
            authMode: def.authMode,
            credentialId: def.authMode === "NONE" ? null : (def.credentialId ?? null),
          },
          actor,
        },
        trx,
      );
      check = { ...check, url: effectiveUrl };
    }
  } else {
    const setupId = await ensureSetup(componentId, trx);
    const setup = await trx
      .selectFrom("component_monitoring_setups")
      .select("vantage")
      .where("id", "=", setupId)
      .executeTakeFirstOrThrow();
    await validateCheck(trx, componentId, {
      url: effectiveUrl,
      componentInstanceId,
      authMode: def.authMode,
      credentialId: def.credentialId ?? null,
      authConfig: def.authConfig ?? null,
      vantage: setup.vantage,
    });
    const checkId = uuidv7();
    await trx
      .insertInto("url_checks")
      .values({
        id: checkId,
        setupId,
        componentInstanceId,
        credentialId: def.authMode === "NONE" ? null : (def.credentialId ?? null),
        name: def.name,
        url: effectiveUrl,
        method: def.method,
        enabled: false,
        cadenceSeconds: def.cadenceSeconds ?? null,
        successPolicy: def.successPolicy,
        authMode: def.authMode,
        authConfig: def.authMode === "NONE" ? null : (def.authConfig ?? null),
        availabilityTarget: def.availabilityTarget?.toString() ?? null,
        targetWindow: def.targetWindow ?? null,
        autoDisableAfter: def.autoDisableAfter ?? null,
        managedKey: def.checkKey,
        nextProbeAt: null,
        createdBy: actor.id,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await writeEntityChange(
      {
        entityType: "url_check",
        entityId: checkId,
        action: "created",
        changes: { componentId, name: def.name, url: effectiveUrl, managedKey: def.checkKey },
        importRunId: runId,
        actor,
      },
      trx,
    );
    check = await trx
      .selectFrom("url_checks")
      .selectAll()
      .where("id", "=", checkId)
      .executeTakeFirstOrThrow();
  }

  // Source ownership upsert: this Source declares the check with its
  // configured enabled intent (UNIQUE(sourceId, checkKey)).
  await trx
    .insertInto("source_url_check_memberships")
    .values({
      id: uuidv7(),
      sourceId,
      urlCheckId: check.id,
      checkKey: def.checkKey,
      active: true,
      configuredEnabled: def.enabled,
      firstSeenInRunId: runId,
      lastSeenInRunId: runId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflict((oc) =>
      oc.columns(["sourceId", "checkKey"]).doUpdateSet({
        urlCheckId: check.id,
        active: true,
        configuredEnabled: def.enabled,
        lastSeenInRunId: runId,
        updatedAt: now,
      }),
    )
    .execute();

  await recomputeManagedCheckEnabled(trx, check.id);
  return { checkId: check.id, conflict: null };
}

/** Phase-2 check reconciliation for a completed Source run: memberships the
 *  Source did not refresh deactivate; affected checks recompute their
 *  runtime enabled state. */
export async function reconcileSourceCheckMemberships(
  trx: DbOrTrx,
  sourceId: string,
  runId: string,
): Promise<void> {
  const stale = await trx
    .updateTable("source_url_check_memberships")
    .set({ active: false, updatedAt: new Date().toISOString() })
    .where("sourceId", "=", sourceId)
    .where("active", "=", true)
    .where((eb) =>
      eb.or([
        eb("lastSeenInRunId", "!=", runId),
        eb("lastSeenInRunId", "is", null),
      ]),
    )
    .returning("urlCheckId")
    .execute();
  for (const row of stale) {
    await recomputeManagedCheckEnabled(trx, row.urlCheckId);
  }
}

/** Delete the managed checks (and, by cascade, observations + memberships)
 *  of ComponentInstances that became GONE with no effective Source
 *  membership (spec 058 FR-019). Legacy/manual rows are retained. */
export async function cleanupManagedChecksForGoneInstances(
  trx: DbOrTrx,
  componentInstanceIds: string[],
): Promise<number> {
  if (componentInstanceIds.length === 0) return 0;
  const gone = await trx
    .selectFrom("component_instances")
    .select("id")
    .where("id", "in", componentInstanceIds)
    .where("status", "=", "GONE")
    .execute();
  let deleted = 0;
  for (const row of gone) {
    const res = await trx
      .deleteFrom("url_checks")
      .where("componentInstanceId", "=", row.id)
      .where("managedKey", "is not", null)
      .execute();
    deleted += Number(res[0]?.numDeletedRows ?? 0);
  }
  return deleted;
}

/** Config disabled or deleted → the bound Source's check memberships are no
 *  longer effective; shared checks stay up only via other effective owners. */
export async function pauseManagedChecksForConfig(
  trx: DbOrTrx,
  configId: string,
): Promise<void> {
  const checkIds = await trx
    .selectFrom("source_url_check_memberships")
    .innerJoin(
      "importer_sources",
      "importer_sources.id",
      "source_url_check_memberships.sourceId",
    )
    .select("source_url_check_memberships.urlCheckId")
    .where("importer_sources.boundConfigId", "=", configId)
    .where("source_url_check_memberships.active", "=", true)
    .execute();
  for (const row of checkIds) {
    await recomputeManagedCheckEnabled(trx, row.urlCheckId);
  }
}

/** Explicit disabled→enabled transition (spec 058 FR-017): checks this
 *  Source configures enabled resume and reset their streak/auto-disable
 *  marker; configured-disabled checks remain off. */
export async function resumeManagedChecksForConfig(
  trx: DbOrTrx,
  configId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const memberships = await trx
    .selectFrom("source_url_check_memberships")
    .innerJoin(
      "importer_sources",
      "importer_sources.id",
      "source_url_check_memberships.sourceId",
    )
    .select([
      "source_url_check_memberships.urlCheckId",
      "source_url_check_memberships.configuredEnabled",
    ])
    .where("importer_sources.boundConfigId", "=", configId)
    .where("source_url_check_memberships.active", "=", true)
    .execute();
  for (const m of memberships) {
    if (!m.configuredEnabled) continue;
    await trx
      .updateTable("url_checks")
      .set({
        enabled: true,
        nextProbeAt: now,
        consecutiveFailures: 0,
        autoDisabledAt: null,
        updatedAt: now,
      })
      .where("id", "=", m.urlCheckId)
      .where("managedKey", "is not", null)
      .execute();
  }
}
