import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import type { Kysely, Selectable, Transaction } from "kysely";
import {
  createUrlCheckSchema,
  updateUrlCheckSchema,
  urlSafetyError,
  type CreateUrlCheckInput,
  type MonitoringSetup,
  type SuccessPolicy,
  type UpdateUrlCheckInput,
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
    });
  }
  return { setup, checks: items };
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
  return {
    ...check,
    effectiveCadenceSeconds: check.cadenceSeconds ?? setup.setupCadenceSeconds,
    vantage: setup.vantage,
    agentName: setup.agentName ?? null,
  };
}

/**
 * Transaction-scoped check insert — shared by single-check create and the
 * composite component create (spec 051 US5). Caller owns the transaction
 * and the setup row; `parsed` is already schema-validated.
 */
export async function insertCheck(
  trx: DbOrTrx,
  componentId: string,
  setupId: string,
  setupVantage: string,
  parsed: CreateUrlCheckInput,
  actor: Actor,
): Promise<UrlCheck> {
  await validateCheck(trx, componentId, {
    url: parsed.url,
    componentInstanceId: parsed.componentInstanceId,
    authMode: parsed.authMode,
    credentialId: parsed.credentialId ?? null,
    authConfig: parsed.authConfig ?? null,
    vantage: setupVantage,
  });

  const id = uuidv7();
  const now = new Date().toISOString();
  await trx
    .insertInto("url_checks")
    .values({
      id,
      setupId,
      componentInstanceId: parsed.componentInstanceId,
      credentialId:
        parsed.authMode === "NONE" ? null : (parsed.credentialId ?? null),
      name: parsed.name,
      url: parsed.url,
      method: parsed.method,
      enabled: parsed.enabled,
      cadenceSeconds: parsed.cadenceSeconds ?? null,
      successPolicy: parsed.successPolicy ?? DEFAULT_POLICY,
      authMode: parsed.authMode,
      authConfig: parsed.authConfig ?? null,
      availabilityTarget: parsed.availabilityTarget?.toString() ?? null,
      targetWindow: parsed.targetWindow ?? null,
      nextProbeAt: parsed.enabled ? now : null,
      createdBy: actor.id,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await writeEntityChange(
    {
      entityType: "url_check",
      entityId: id,
      action: "created",
      changes: {
        componentId,
        name: parsed.name,
        url: parsed.url,
        method: parsed.method,
        authMode: parsed.authMode,
        credentialId: parsed.authMode === "NONE" ? null : parsed.credentialId,
      },
      actor,
    },
    trx,
  );
  return toApi(await getCheckRow(id, trx));
}

export async function createCheck(
  componentId: string,
  input: CreateUrlCheckInput,
  actor: Actor,
): Promise<UrlCheck> {
  const parsed = createUrlCheckSchema.parse(input);

  const component = await db
    .selectFrom("components")
    .select(["id", "lifecycle"])
    .where("id", "=", componentId)
    .executeTakeFirst();
  if (!component) {
    throw coded("Component not found", 404, "NOT_FOUND");
  }

  return db.transaction().execute(async (trx) => {
    const setupId = await ensureSetup(componentId, trx);
    const setup = await trx
      .selectFrom("component_monitoring_setups")
      .select("vantage")
      .where("id", "=", setupId)
      .executeTakeFirstOrThrow();
    return insertCheck(trx, componentId, setupId, setup.vantage, parsed, actor);
  });
}

export async function updateCheck(
  id: string,
  input: UpdateUrlCheckInput,
  actor: Actor,
): Promise<UrlCheck> {
  const parsed = updateUrlCheckSchema.parse(input);
  const existing = await getCheckRow(id);

  return db.transaction().execute(async (trx) => {
    const component = await trx
      .selectFrom("component_instances")
      .innerJoin(
        "components",
        "components.id",
        "component_instances.componentId",
      )
      .select(["components.id", "components.category"])
      .where("component_instances.id", "=", existing.componentInstanceId)
      .executeTakeFirstOrThrow();

    const setup = await trx
      .selectFrom("component_monitoring_setups")
      .select("vantage")
      .where("id", "=", existing.setupId)
      .executeTakeFirstOrThrow();

    const effectiveAuthMode = parsed.authMode ?? existing.authMode;
    const effectiveCredentialId =
      parsed.credentialId !== undefined
        ? parsed.credentialId
        : existing.credentialId;
    const effectiveAuthConfig =
      parsed.authConfig !== undefined
        ? (parsed.authConfig as UrlCheckAuthConfig | null)
        : (existing.authConfig as UrlCheckAuthConfig | null);

    await validateCheck(trx, component.id, {
      url: parsed.url,
      componentInstanceId:
        parsed.componentInstanceId !== undefined
          ? parsed.componentInstanceId
          : undefined,
      authMode: effectiveAuthMode,
      credentialId: effectiveAuthMode === "NONE" ? null : effectiveCredentialId,
      authConfig: effectiveAuthMode === "NONE" ? null : effectiveAuthConfig,
      vantage: setup.vantage,
    });

    const now = new Date().toISOString();
    const fields: Record<string, unknown> = {
      updatedAt: now,
      updatedBy: actor.id,
    };
    const changes: Record<string, unknown> = {};
    const set = (col: string, val: unknown) => {
      fields[col] = val;
      changes[col] = val;
    };

    if (parsed.name !== undefined) set("name", parsed.name);
    if (parsed.url !== undefined) set("url", parsed.url);
    if (parsed.componentInstanceId !== undefined)
      set("componentInstanceId", parsed.componentInstanceId);
    if (parsed.method !== undefined) set("method", parsed.method);
    if (parsed.cadenceSeconds !== undefined)
      set("cadenceSeconds", parsed.cadenceSeconds);
    if (parsed.successPolicy !== undefined)
      set("successPolicy", parsed.successPolicy ?? DEFAULT_POLICY);
    if (parsed.availabilityTarget !== undefined)
      set("availabilityTarget", parsed.availabilityTarget?.toString() ?? null);
    if (parsed.targetWindow !== undefined)
      set("targetWindow", parsed.targetWindow);
    if (parsed.authMode !== undefined) {
      set("authMode", parsed.authMode);
      if (parsed.authMode === "NONE") {
        set("credentialId", null);
        set("authConfig", null);
      }
    }
    if (parsed.credentialId !== undefined && effectiveAuthMode !== "NONE")
      set("credentialId", parsed.credentialId);
    if (parsed.authConfig !== undefined && effectiveAuthMode !== "NONE")
      set("authConfig", parsed.authConfig);
    if (parsed.enabled !== undefined && parsed.enabled !== existing.enabled) {
      set("enabled", parsed.enabled);
      set("nextProbeAt", parsed.enabled ? now : null);
    }
    // Schedule changes take effect on the next slot.
    if (parsed.cadenceSeconds !== undefined && existing.enabled) {
      fields.nextProbeAt = now;
      changes.nextProbeAt = now;
    }

    await trx
      .updateTable("url_checks")
      .set(fields)
      .where("id", "=", id)
      .execute();

    const action =
      parsed.enabled !== undefined && parsed.enabled !== existing.enabled
        ? parsed.enabled
          ? "enabled"
          : "disabled"
        : "updated";
    await writeEntityChange(
      {
        entityType: "url_check",
        entityId: id,
        action,
        changes,
        actor,
      },
      trx,
    );
    return toApi(await getCheckRow(id, trx));
  });
}

export async function deleteCheck(id: string, actor: Actor): Promise<void> {
  const existing = await getCheckRow(id);
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("url_checks").where("id", "=", id).execute();
    await writeEntityChange(
      {
        entityType: "url_check",
        entityId: id,
        action: "deleted",
        changes: { name: existing.name, url: existing.url },
        actor,
      },
      trx,
    );
  });
}

export { observationToApi };

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
