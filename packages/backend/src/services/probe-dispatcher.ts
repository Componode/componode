import PQueue from "p-queue";
import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import {
  executeHttpProbe,
  statusAccepted,
  URL_CHECK_AGENT_CONCURRENCY_DEFAULT,
  URL_CHECK_AGENT_QUEUE_MAX_DEFAULT,
  URL_CHECK_AGENT_RATE_LIMIT_DEFAULT,
  URL_CHECK_DEFAULT_TIMEOUT_MS,
  URL_CHECK_MAX_PROBE_TIMEOUT_MS,
  URL_CHECK_PROBE_CONCURRENCY_DEFAULT,
  URL_CHECK_PROBE_RATE_LIMIT_DEFAULT,
  URL_CHECK_SWEEP_INTERVAL_MS_DEFAULT,
  type BasicAuthConfig,
  type BearerAuthConfig,
  type CustomHeadersAuthConfig,
  type SuccessPolicy,
  type UrlCheckAuthConfig,
  type UrlCheckErrorType,
  type UrlCheckMethod,
  type UrlCheckOutcome,
  type UrlCheckProbePayload,
  type UrlCheckProbeResultPayload,
  type UrlCheckVantage,
} from "@componode/core";
import { db } from "../db/connection.js";
import { writeEntityChange } from "./audit-service.js";
import { envInt } from "../utils/env.js";
import { evaluateAutoDisable } from "./url-check-auto-disable.js";
import { metrics } from "../plugins/metrics.js";
import { logger } from "../plugins/logging.js";
import { decryptSecrets, loadKeyring } from "../utils/credential-crypto.js";

// URL Check probe dispatcher (spec 051 US2, research R1/R2). Executes one
// scheduled slot for a check: HUB vantage probes run in-process through a
// shared p-queue, AGENT vantage probes go over the agent stream via the
// dispatch seam below. Every dispatch ends in exactly one observation row
// plus a nextProbeAt advance. Managed checks (spec 058) additionally write
// the monitored ComponentInstance's status on executed outcomes
// (SUCCESS→RUNNING, FAILURE→ERROR); MISSED/disabled preserve the last
// status and GONE stays reconciliation-owned.

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

// Agent dispatch seam: app.ts binds the live AgentSessionService here so
// this module stays importable without a Fastify instance (mirrors the
// setRemoteRunDispatcher pattern). Tests may inject a stub.
export type UrlCheckAgentDispatch = (
  agentId: string,
  payload: UrlCheckProbePayload,
) => Promise<UrlCheckProbeResultPayload>;

let agentDispatch: UrlCheckAgentDispatch | null = null;

export function setUrlCheckAgentDispatch(
  fn: UrlCheckAgentDispatch | null,
): void {
  agentDispatch = fn;
}

// Liveness seam (spec 052): an agent with no live session must NOT be
// admission-controlled — its misses are cheap AGENT_OFFLINE writes, and
// queueing them would delay the miss and misclassify overflow as
// SATURATED. Unset → treat agents as online (stub-dispatch test paths).
let agentOnlineChecker: ((agentId: string) => boolean) | null = null;

export function setUrlCheckAgentOnlineChecker(
  fn: ((agentId: string) => boolean) | null,
): void {
  agentOnlineChecker = fn;
}

const queue = new PQueue({
  concurrency: envInt(
    "URL_CHECK_HUB_CONCURRENCY",
    URL_CHECK_PROBE_CONCURRENCY_DEFAULT,
  ),
  // Rate bound (FR-011): at most URL_CHECK_PROBE_RATE_LIMIT dispatches per
  // sweep window — a drained slot backlog must not burst hundreds of live
  // probes at once.
  intervalCap: envInt(
    "URL_CHECK_PROBE_RATE_LIMIT",
    URL_CHECK_PROBE_RATE_LIMIT_DEFAULT,
  ),
  interval: envInt(
    "URL_CHECK_SWEEP_INTERVAL_MS",
    URL_CHECK_SWEEP_INTERVAL_MS_DEFAULT,
  ),
});

// Agent-vantage admission control (spec 052 US1, FR-001/002/003/005): a
// bounded pool per agent — separate from the hub queue so one saturated
// agent can never consume another agent's or the hub-vantage bound. Pool
// config is read lazily at first dispatch so tests can tune env per case.
const agentPools = new Map<string, PQueue>();

// Checks whose latest slot is still in-flight or deferred on the agent
// path. Admission claims the check and returns without waiting for the
// queued work — a saturated agent can never stall the sweep for other
// agents or Hub-vantage checks (FR-005/FR-013). The slot stays due until
// the task records its observation, then the claim releases.
const agentSlotClaims = new Set<string>();

// Bounds must be whole numbers ≥ 1 — p-queue rejects fractional caps at
// pool creation, so env overrides are clamped for predictable handling.
function boundInt(name: string, fallback: number): number {
  return Math.max(1, Math.floor(envInt(name, fallback)));
}

// scheduledAt + cadence as an expression, never rewinding an already-
// later nextProbeAt (a backlog advance may have moved the schedule
// forward past this slot). Exported for the scheduler's backlog advance.
export function nextSlotSql(scheduledAt: string, cadenceSeconds: number) {
  const slot = new Date(
    new Date(scheduledAt).getTime() + cadenceSeconds * 1000,
  ).toISOString();
  return sql<string>`GREATEST(COALESCE("nextProbeAt", '-infinity'::timestamptz), ${slot}::timestamptz)`;
}

// Label-free aggregates (spec 052 US3): which agent is saturated stays on
// the agent's own ops scrape — the hub only exposes the global signal.
function updateAgentPoolGauges(): void {
  let inFlight = 0;
  let depth = 0;
  for (const q of agentPools.values()) {
    inFlight += q.pending;
    depth += q.size;
  }
  metrics.urlCheckAgentProbesInFlight.set(inFlight);
  metrics.urlCheckAgentProbeQueueDepth.set(depth);
}

function agentPool(agentId: string): PQueue {
  let pool = agentPools.get(agentId);
  if (!pool) {
    pool = new PQueue({
      concurrency: boundInt(
        "URL_CHECK_AGENT_CONCURRENCY",
        URL_CHECK_AGENT_CONCURRENCY_DEFAULT,
      ),
      intervalCap: boundInt(
        "URL_CHECK_AGENT_RATE_LIMIT",
        URL_CHECK_AGENT_RATE_LIMIT_DEFAULT,
      ),
      interval: envInt(
        "URL_CHECK_SWEEP_INTERVAL_MS",
        URL_CHECK_SWEEP_INTERVAL_MS_DEFAULT,
      ),
    });
    for (const ev of ["active", "add", "next", "idle"] as const) {
      pool.addEventListener(ev, updateAgentPoolGauges);
    }
    agentPools.set(agentId, pool);
  }
  return pool;
}

function agentQueueMax(): number {
  return boundInt(
    "URL_CHECK_AGENT_QUEUE_MAX",
    URL_CHECK_AGENT_QUEUE_MAX_DEFAULT,
  );
}

// The scheduler skips claimed checks when writing missed-slot backlog —
// a deferred task's slot is still in-flight, not missed.
export function isAgentSlotClaimed(checkId: string): boolean {
  return agentSlotClaims.has(checkId);
}

// Test seam: agent-path dispatchProbe resolves at admission, so tests
// drain the pools before asserting observations.
export async function waitForAgentProbePoolsIdle(): Promise<void> {
  await Promise.all([...agentPools.values()].map((q) => q.onIdle()));
}

export function resetAgentProbePoolsForTests(): void {
  agentPools.clear();
  agentSlotClaims.clear();
  updateAgentPoolGauges();
}

export interface DispatchProbeDeps {
  fetchImpl?: FetchImpl;
}

interface ObservationInput {
  outcome: UrlCheckOutcome;
  httpStatus?: number | null;
  durationMs?: number | null;
  errorType?: UrlCheckErrorType | null;
  vantage: UrlCheckVantage;
  agentId?: string | null;
}

// One observation + the nextProbeAt advance + the consecutive-failure
// streak step, atomically (spec 056). Metrics and the finalize log follow
// the same finalize-point convention as agent jobs. Spec 058: an executed
// outcome on a managed check is authoritative for the monitored
// ComponentInstance status — SUCCESS→RUNNING, FAILURE→ERROR — while
// MISSED preserves the last status and GONE/RETIRED cannot be overwritten.
async function recordObservation(
  checkId: string,
  scheduledAt: string,
  cadenceSeconds: number,
  obs: ObservationInput,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("url_check_observations")
      .values({
        id: uuidv7(),
        urlCheckId: checkId,
        scheduledAt,
        outcome: obs.outcome,
        httpStatus: obs.httpStatus ?? null,
        durationMs: obs.durationMs ?? null,
        errorType: obs.errorType ?? null,
        vantage: obs.vantage,
        agentId: obs.agentId ?? null,
      })
      .execute();

    if (obs.outcome === "SUCCESS" || obs.outcome === "FAILURE") {
      const targetStatus = obs.outcome === "SUCCESS" ? "RUNNING" : "ERROR";
      const check = await trx
        .selectFrom("url_checks")
        .select(["componentInstanceId", "managedKey"])
        .where("id", "=", checkId)
        .executeTakeFirst();
      if (check?.managedKey) {
        const instance = await trx
          .selectFrom("component_instances")
          .innerJoin(
            "components",
            "components.id",
            "component_instances.componentId",
          )
          .select([
            "component_instances.id",
            "component_instances.status",
            "components.lifecycle",
          ])
          .where("component_instances.id", "=", check.componentInstanceId)
          .executeTakeFirst();
        if (
          instance &&
          instance.status !== targetStatus &&
          instance.status !== "GONE" &&
          instance.lifecycle !== "RETIRED"
        ) {
          await trx
            .updateTable("component_instances")
            .set({ status: targetStatus, updatedAt: new Date().toISOString() })
            .where("id", "=", instance.id)
            .execute();
          await writeEntityChange(
            {
              entityType: "component_instance",
              entityId: instance.id,
              action: "status_change",
              changes: {
                previousStatus: instance.status,
                status: targetStatus,
                via: "url_check",
                outcome: obs.outcome,
              },
              actor: { id: null, name: "url-check-scheduler" },
            },
            trx,
          );
        }
      }
    }

    const updated = await trx
      .updateTable("url_checks")
      .set({
        nextProbeAt: nextSlotSql(scheduledAt, cadenceSeconds),
        updatedAt: new Date().toISOString(),
        // Spec 056: FAILURE and MISSED advance the streak; SUCCESS resets.
        consecutiveFailures:
          obs.outcome === "SUCCESS"
            ? 0
            : sql<number>`"consecutiveFailures" + 1`,
      })
      .where("id", "=", checkId)
      // A check disabled mid-flight keeps its cleared schedule (spec 052
      // US2): the in-flight slot still records its outcome, but nothing
      // new is armed for a disabled check — and a late result never
      // mutates the streak.
      .where("enabled", "=", true)
      .returning(["consecutiveFailures", "autoDisableAfter"])
      .executeTakeFirst();
    if (updated) {
      await evaluateAutoDisable(
        trx,
        checkId,
        updated.consecutiveFailures,
        updated.autoDisableAfter,
        obs.vantage,
      );
    }
  });
  metrics.urlCheckProbesTotal.inc({
    vantage: obs.vantage,
    outcome: obs.outcome,
    errorType: obs.errorType ?? "none",
  });
  if (obs.durationMs != null) {
    metrics.urlCheckProbeDurationSeconds.observe(
      { vantage: obs.vantage },
      obs.durationMs / 1000,
    );
  }
  logger.info(
    { checkId, outcome: obs.outcome, errorType: obs.errorType ?? undefined },
    "url check probe finalized",
  );
}

// lastUsedAt is a usage marker, not a heartbeat — write only when the
// stored value is more than an hour stale (research R6 throttle).
const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

async function touchLastUsedAt(
  credentialId: string,
  lastUsedAt: string | null,
): Promise<void> {
  if (
    lastUsedAt &&
    Date.now() - new Date(lastUsedAt).getTime() < LAST_USED_THROTTLE_MS
  ) {
    return;
  }
  try {
    await db
      .updateTable("credentials")
      .set({ lastUsedAt: new Date().toISOString() })
      .where("id", "=", credentialId)
      .execute();
  } catch (err) {
    logger.warn({ err, credentialId }, "credential lastUsedAt update failed");
  }
}

type CheckContext = {
  credentialId: string | null;
  authMode: string;
  authConfig: UrlCheckAuthConfig | null;
};

// Resolve a STORED credential's key values into request headers for a
// HUB-vantage probe. Returns {errorType} when auth cannot be built — the
// probe does not run and the slot lands as FAILURE (config defects surface
// as probe failures, never silently skipped).
async function resolveHubHeaders(
  check: CheckContext,
): Promise<
  { headers: Record<string, string> } | { errorType: UrlCheckErrorType }
> {
  if (check.authMode === "NONE") return { headers: {} };
  if (!check.credentialId) return { errorType: "OTHER" };

  const credential = await db
    .selectFrom("credentials")
    .select(["id", "status", "kind", "encryptedPayload", "lastUsedAt"])
    .where("id", "=", check.credentialId)
    .executeTakeFirst();
  if (!credential || credential.status !== "ACTIVE") {
    return { errorType: "OTHER" };
  }
  // AGENT_MANAGED values live on the agent host — a HUB probe can never
  // resolve them (ADR-117). Validation prevents this binding; refuse anyway.
  if (credential.kind === "AGENT_MANAGED") {
    return { errorType: "OTHER" };
  }
  const keyring = await loadKeyring();
  if (!keyring || !credential.encryptedPayload) {
    return { errorType: "OTHER" };
  }
  let secrets: Record<string, string>;
  try {
    secrets = decryptSecrets(credential.encryptedPayload, keyring);
  } catch (err) {
    logger.warn(
      { err, credentialId: credential.id },
      "credential decryption failed during url check probe",
    );
    return { errorType: "OTHER" };
  }
  const take = (key: string | undefined): string | null =>
    key && secrets[key] !== undefined ? secrets[key]! : null;

  const config = check.authConfig;
  let headers: Record<string, string> | null = null;
  if (check.authMode === "BASIC") {
    const c = config as BasicAuthConfig | null;
    const user = take(c?.usernameKey);
    const pass = take(c?.passwordKey);
    if (user !== null && pass !== null) {
      headers = {
        Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
      };
    }
  } else if (check.authMode === "BEARER") {
    const c = config as BearerAuthConfig | null;
    const token = take(c?.tokenKey);
    if (token !== null) {
      headers = { Authorization: `Bearer ${token}` };
    }
  } else if (check.authMode === "CUSTOM_HEADERS") {
    const c = config as CustomHeadersAuthConfig | null;
    headers = {};
    for (const h of c?.headers ?? []) {
      const value = take(h.key);
      if (value === null) {
        headers = null;
        break;
      }
      headers[h.name] = value;
    }
  } else {
    return { errorType: "OTHER" };
  }
  if (!headers) return { errorType: "OTHER" };
  await touchLastUsedAt(credential.id, credential.lastUsedAt);
  return { headers };
}

// Policy evaluation shared by both vantages: the agent returns raw probe
// fields, the hub always re-evaluates the success policy on the received
// status (research R6 — the agent never learns the policy).
function outcomeFor(
  responseReceived: boolean,
  httpStatus: number | null,
  policy: SuccessPolicy,
  errorType: UrlCheckErrorType | null,
): Pick<ObservationInput, "outcome" | "errorType"> {
  if (responseReceived && httpStatus !== null) {
    return statusAccepted(httpStatus, policy)
      ? { outcome: "SUCCESS" }
      : { outcome: "FAILURE", errorType: "HTTP_STATUS" };
  }
  return { outcome: "FAILURE", errorType: errorType ?? "OTHER" };
}

async function dispatchAgentProbe(
  row: CheckContext & {
    id: string;
    url: string;
    method: string;
    setupAgentId: string | null;
  },
  scheduledAt: string,
  cadenceSeconds: number,
  timeoutMs: number,
  policy: SuccessPolicy,
): Promise<void> {
  const agentId = row.setupAgentId;
  const missed = (errorType: UrlCheckErrorType) =>
    recordObservation(row.id, scheduledAt, cadenceSeconds, {
      outcome: "MISSED",
      errorType,
      vantage: "AGENT",
      agentId,
    });

  if (!agentId || !agentDispatch) {
    await missed("AGENT_OFFLINE");
    return;
  }

  const failed = (errorType: UrlCheckErrorType) =>
    recordObservation(row.id, scheduledAt, cadenceSeconds, {
      outcome: "FAILURE",
      errorType,
      vantage: "AGENT",
      agentId,
    });

  let secretRefMap: UrlCheckProbePayload["secretRefMap"];
  if (row.authMode !== "NONE") {
    if (!row.credentialId) return failed("OTHER");
    const credential = await db
      .selectFrom("credentials")
      .select(["id", "status", "kind", "secretRefMap", "lastUsedAt"])
      .where("id", "=", row.credentialId)
      .executeTakeFirst();
    // AGENT-vantage checks must reference an AGENT_MANAGED credential —
    // values never leave the agent host (ADR-117). Anything else is a
    // config defect: FAILURE, not MISSED (the monitor itself is healthy).
    if (
      !credential ||
      credential.status !== "ACTIVE" ||
      credential.kind !== "AGENT_MANAGED"
    ) {
      return failed("OTHER");
    }
    secretRefMap =
      (credential.secretRefMap as UrlCheckProbePayload["secretRefMap"]) ??
      undefined;
    await touchLastUsedAt(credential.id, credential.lastUsedAt);
  }

  const payload: UrlCheckProbePayload = {
    probeId: uuidv7(),
    url: row.url,
    method: row.method as UrlCheckMethod,
    timeoutMs,
    authMode: row.authMode as UrlCheckProbePayload["authMode"],
    authKeyNames:
      (row.authConfig as UrlCheckProbePayload["authKeyNames"]) ?? undefined,
    secretRefMap,
  };

  let result: UrlCheckProbeResultPayload;
  try {
    result = await agentDispatch(agentId, payload);
  } catch (err) {
    const code = (err as { code?: string }).code;
    await missed(
      code === "AGENT_PROBE_TIMEOUT"
        ? "TIMEOUT"
        : code === "AGENT_OFFLINE"
          ? "AGENT_OFFLINE"
          : "OTHER",
    );
    return;
  }

  // An agent at-cap refusal (spec 052) means the slot never executed —
  // MISSED/SATURATED, never an endpoint failure.
  if (result.errorType === "SATURATED") {
    await missed("SATURATED");
    return;
  }

  const outcome = outcomeFor(
    result.httpStatus != null,
    result.httpStatus ?? null,
    policy,
    (result.errorType as UrlCheckErrorType | null) ?? null,
  );
  await recordObservation(row.id, scheduledAt, cadenceSeconds, {
    ...outcome,
    httpStatus: result.httpStatus ?? null,
    durationMs: result.durationMs ?? null,
    vantage: "AGENT",
    agentId,
  });
}

/**
 * Execute one scheduled slot for a check. `scheduledAt` is the slot the
 * observation belongs to; nextProbeAt advances to scheduledAt + cadence.
 */
export async function dispatchProbe(
  checkId: string,
  scheduledAt: string,
  deps: DispatchProbeDeps = {},
): Promise<void> {
  const row = await db
    .selectFrom("url_checks")
    .innerJoin(
      "component_monitoring_setups",
      "component_monitoring_setups.id",
      "url_checks.setupId",
    )
    .selectAll("url_checks")
    .select([
      "component_monitoring_setups.vantage as setupVantage",
      "component_monitoring_setups.agentId as setupAgentId",
      "component_monitoring_setups.cadenceSeconds as setupCadenceSeconds",
    ])
    .where("url_checks.id", "=", checkId)
    .executeTakeFirst();
  if (!row || !row.enabled) return;

  const cadenceSeconds = row.cadenceSeconds ?? row.setupCadenceSeconds;
  const vantage = row.setupVantage as UrlCheckVantage;
  // Env override is clamped — a runaway timeout would stall the bounded
  // queue and let one probe exceed a whole cadence slot.
  const timeoutMs = Math.min(
    envInt("URL_CHECK_PROBE_TIMEOUT_MS", URL_CHECK_DEFAULT_TIMEOUT_MS),
    URL_CHECK_MAX_PROBE_TIMEOUT_MS,
  );
  const policy = row.successPolicy as SuccessPolicy;
  const ctx = {
    credentialId: row.credentialId,
    authMode: row.authMode,
    authConfig: (row.authConfig as UrlCheckAuthConfig | null) ?? null,
  };

  // Slot-level dedupe (spec 052): an observation for this slot means the
  // probe already finalized — running again could only ever write a
  // duplicate. The slot is simply re-armed so the schedule keeps moving.
  const alreadyObserved = await db
    .selectFrom("url_check_observations")
    .select("id")
    .where("urlCheckId", "=", checkId)
    .where("scheduledAt", "=", scheduledAt)
    .executeTakeFirst();
  if (alreadyObserved) {
    await db
      .updateTable("url_checks")
      .set({
        // Never rewind the schedule — a backlog advance may already hold
        // a later slot.
        nextProbeAt: nextSlotSql(scheduledAt, cadenceSeconds),
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", checkId)
      .where("enabled", "=", true)
      .execute();
    return;
  }

  if (vantage === "AGENT") {
    const agentId = row.setupAgentId;
    const args = {
      ...ctx,
      id: row.id,
      url: row.url,
      method: row.method,
      setupAgentId: row.setupAgentId,
    };
    // Bounded deferral (clarify 2026-11-01): work beyond the in-flight
    // bound waits inside the per-agent queue; work beyond the deferral
    // bound records MISSED/SATURATED — never a silent drop, never an
    // unbounded wait. Admission claims the check and returns without
    // awaiting the queued task, so a saturated agent cannot stall the
    // sweep for other checks (FR-005/FR-013); the claim releases when
    // the task settles, after which the still-due slot is re-picked or
    // the observation dedupe above ends the slot.
    if (agentId && agentDispatch && (agentOnlineChecker?.(agentId) ?? true)) {
      if (agentSlotClaims.has(row.id)) return;
      const pool = agentPool(agentId);
      if (pool.size >= agentQueueMax()) {
        await recordObservation(row.id, scheduledAt, cadenceSeconds, {
          outcome: "MISSED",
          errorType: "SATURATED",
          vantage: "AGENT",
          agentId,
        });
        return;
      }
      agentSlotClaims.add(row.id);
      try {
        void pool
          .add(() =>
            dispatchAgentProbe(
              args,
              scheduledAt,
              cadenceSeconds,
              timeoutMs,
              policy,
            ),
          )
          .catch((err) =>
            logger.warn(
              { err, checkId: row.id, agentId },
              "deferred url check probe failed",
            ),
          )
          .finally(() => agentSlotClaims.delete(row.id));
      } catch (err) {
        agentSlotClaims.delete(row.id);
        throw err;
      }
      return;
    }
    await dispatchAgentProbe(
      args,
      scheduledAt,
      cadenceSeconds,
      timeoutMs,
      policy,
    );
    return;
  }

  const auth = await resolveHubHeaders(ctx);
  if ("errorType" in auth) {
    await recordObservation(row.id, scheduledAt, cadenceSeconds, {
      outcome: "FAILURE",
      errorType: auth.errorType,
      vantage: "HUB",
    });
    return;
  }

  const result = await queue.add(() =>
    executeHttpProbe(
      {
        url: row.url,
        method: row.method as UrlCheckMethod,
        timeoutMs,
        headers: auth.headers,
      },
      deps.fetchImpl,
    ),
  );
  const outcome = outcomeFor(
    result.responseReceived,
    result.httpStatus,
    policy,
    result.errorType,
  );
  await recordObservation(row.id, scheduledAt, cadenceSeconds, {
    ...outcome,
    httpStatus: result.httpStatus,
    durationMs: result.durationMs,
    vantage: "HUB",
  });
}
