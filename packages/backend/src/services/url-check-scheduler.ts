import { uuidv7 } from "uuidv7";
import {
  URL_CHECK_RETENTION_DAYS,
  URL_CHECK_SWEEP_INTERVAL_MS_DEFAULT,
} from "@componode/core";
import { db } from "../db/connection.js";
import { envInt } from "../utils/env.js";
import { logger } from "../plugins/logging.js";
import { dispatchProbe, type DispatchProbeDeps } from "./probe-dispatcher.js";

// URL Check scheduler (spec 051 US2, research R2/R3): a setInterval sweep
// selects checks whose nextProbeAt is due, writes one MISSED observation
// per skipped slot (hub downtime, dispatch backlog), and dispatches the
// current slot. Checks on RETIRED components do not probe but keep their
// history (R5). Observations are purged once a day past the retention
// window.

// A backlog drains at MAX_MISSED_PER_SWEEP slots per check per sweep so a
// long outage cannot flood the observation table in one pass — every
// missed slot still lands as a MISSED row, just across consecutive sweeps.
const MAX_MISSED_PER_SWEEP = 50;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let sweeping = false;
let lastPurgeAt = 0;

export type SweepDeps = DispatchProbeDeps;

/**
 * Record skipped slots as MISSED observations, oldest first, up to
 * MAX_MISSED_PER_SWEEP per call. Returns the newest covered slot and
 * whether unrecorded slots remain for the next sweep.
 */
async function writeMissedSlots(
  checkId: string,
  slots: number[],
  vantage: string,
  agentId: string | null,
): Promise<{ lastCovered: number | null; remaining: boolean }> {
  if (slots.length === 0) return { lastCovered: null, remaining: false };
  // Dedupe: a slot already observed (e.g. a previous partial sweep) must
  // not gain a second MISSED row.
  const existing = await db
    .selectFrom("url_check_observations")
    .select("scheduledAt")
    .where("urlCheckId", "=", checkId)
    .where(
      "scheduledAt",
      "in",
      slots.map((t) => new Date(t).toISOString()),
    )
    .execute();
  const taken = new Set(
    existing.map((e) => new Date(e.scheduledAt).getTime()),
  );
  const pending = slots.filter((t) => !taken.has(t));
  // Oldest-first: everything at or before the last written slot is covered,
  // so nextProbeAt can safely advance past it.
  const missed = pending.slice(0, MAX_MISSED_PER_SWEEP);
  if (missed.length > 0) {
    await db
      .insertInto("url_check_observations")
      .values(
        missed.map((t) => ({
          id: uuidv7(),
          urlCheckId: checkId,
          scheduledAt: new Date(t).toISOString(),
          outcome: "MISSED",
          httpStatus: null,
          durationMs: null,
          // Monitor-side gap (hub downtime/backlog) — not attributable to the
          // checked endpoint or the agent.
          errorType: "OTHER",
          vantage,
          agentId,
        })),
      )
      .execute();
  }
  return {
    lastCovered: missed.length > 0 ? missed[missed.length - 1]! : null,
    remaining: pending.length > missed.length,
  };
}

/** One sweep pass — also used as the startup reconcile. Exported for tests. */
export async function sweepOnce(deps: SweepDeps = {}): Promise<void> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const due = await db
    .selectFrom("url_checks")
    .innerJoin(
      "component_monitoring_setups",
      "component_monitoring_setups.id",
      "url_checks.setupId",
    )
    .innerJoin(
      "components",
      "components.id",
      "component_monitoring_setups.componentId",
    )
    .select([
      "url_checks.id",
      "url_checks.nextProbeAt",
      "url_checks.cadenceSeconds",
      "component_monitoring_setups.cadenceSeconds as setupCadenceSeconds",
      "component_monitoring_setups.vantage",
      "component_monitoring_setups.agentId",
    ])
    .where("url_checks.enabled", "=", true)
    .where("url_checks.nextProbeAt", "<=", nowIso)
    .where("components.lifecycle", "!=", "RETIRED")
    .execute();

  const dispatches: Promise<unknown>[] = [];
  for (const row of due) {
    const cadenceSeconds = row.cadenceSeconds ?? row.setupCadenceSeconds;
    // Slots due up to now: the latest is the current slot (probed for
    // real once the check is caught up); every earlier slot was skipped
    // and lands as MISSED.
    const slots: number[] = [];
    for (
      let t = new Date(row.nextProbeAt!).getTime();
      t <= nowMs;
      t += cadenceSeconds * 1000
    ) {
      slots.push(t);
    }
    if (slots.length === 0) continue;
    const { lastCovered, remaining } = await writeMissedSlots(
      row.id,
      slots.slice(0, -1),
      row.vantage,
      row.agentId,
    );
    if (remaining) {
      // Backlog beyond the per-sweep cap: advance nextProbeAt only past
      // covered slots — the rest lands as MISSED on subsequent sweeps,
      // and the live probe waits until the check is caught up.
      await db
        .updateTable("url_checks")
        .set({
          nextProbeAt: new Date(
            lastCovered! + cadenceSeconds * 1000,
          ).toISOString(),
          updatedAt: nowIso,
        })
        .where("id", "=", row.id)
        .execute();
      continue;
    }
    dispatches.push(
      dispatchProbe(
        row.id,
        new Date(slots[slots.length - 1]!).toISOString(),
        deps,
      ).catch((err) =>
        logger.warn({ err, checkId: row.id }, "url check dispatch failed"),
      ),
    );
  }
  await Promise.allSettled(dispatches);

  if (nowMs - lastPurgeAt >= PURGE_INTERVAL_MS) {
    lastPurgeAt = nowMs;
    await purgeExpiredObservations();
  }
}

/** Delete observations past the retention window. Returns rows removed. */
export async function purgeExpiredObservations(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - URL_CHECK_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = await db
    .deleteFrom("url_check_observations")
    .where("scheduledAt", "<", cutoff)
    .execute();
  return Number(result[0]?.numDeletedRows ?? 0);
}

async function safeSweep(): Promise<void> {
  if (sweeping) return; // a slow sweep must not stack on itself
  sweeping = true;
  try {
    await sweepOnce();
  } catch (err) {
    logger.warn({ err }, "url check sweep failed");
  } finally {
    sweeping = false;
  }
}

/**
 * Start the periodic sweep. The first pass runs immediately — it doubles
 * as the startup reconcile, writing MISSED rows for slots that fell due
 * while the hub was down.
 */
export function startUrlCheckScheduler(): void {
  if (timer) return;
  const sweepMs = envInt(
    "URL_CHECK_SWEEP_INTERVAL_MS",
    URL_CHECK_SWEEP_INTERVAL_MS_DEFAULT,
  );
  void safeSweep();
  timer = setInterval(() => void safeSweep(), sweepMs);
  timer.unref?.();
}

export function stopUrlCheckScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
