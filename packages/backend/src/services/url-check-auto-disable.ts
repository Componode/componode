import type { Kysely, Transaction } from "kysely";
import {
  URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT,
  type UrlCheckVantage,
} from "@componode/core";
import type { DB } from "../db/types.js";
import { envInt } from "../utils/env.js";
import { metrics } from "../plugins/metrics.js";
import { logger } from "../plugins/logging.js";
import { writeEntityChange } from "./audit-service.js";

type DbOrTrx = Kysely<DB> | Transaction<DB>;

// Repeated-failure policy (spec 056, ADR-124 Amendment 3): the streak is a
// maintained `consecutiveFailures` counter on url_checks — +1 per
// non-SUCCESS observation (FAILURE and MISSED both count), reset by
// SUCCESS and by manual re-enable. Both observation write paths fold the
// counter update into their existing url_checks write and then call
// evaluateAutoDisable with the RETURNING values, so the streak and the
// disable decision can never disagree with the recorded outcome.

/** Effective threshold for a check: per-check override, else the env default. 0 = never. */
export function effectiveAutoDisableThreshold(
  autoDisableAfter: number | null,
): number {
  return (
    autoDisableAfter ??
    envInt("URL_CHECK_AUTO_DISABLE_AFTER", URL_CHECK_AUTO_DISABLE_AFTER_DEFAULT)
  );
}

/**
 * Disable a check when its streak reaches the effective threshold. Must be
 * called with values read back (RETURNING) from the same transaction that
 * recorded the outcome. The guarded update makes the transition
 * single-writer: a concurrent or repeat evaluation sees enabled=false and
 * returns before a second audit/log/metric emission. Returns true when the
 * check was disabled by this call.
 */
export async function evaluateAutoDisable(
  trx: DbOrTrx,
  checkId: string,
  consecutiveFailures: number,
  autoDisableAfter: number | null,
  vantage: UrlCheckVantage,
): Promise<boolean> {
  const threshold = effectiveAutoDisableThreshold(autoDisableAfter);
  if (threshold <= 0 || consecutiveFailures < threshold) return false;

  const now = new Date().toISOString();
  const disabled = await trx
    .updateTable("url_checks")
    .set({
      enabled: false,
      nextProbeAt: null,
      autoDisabledAt: now,
      updatedAt: now,
    })
    .where("id", "=", checkId)
    .where("enabled", "=", true)
    .returning("id")
    .executeTakeFirst();
  if (!disabled) return false;

  await writeEntityChange(
    {
      entityType: "url_check",
      entityId: checkId,
      action: "disabled",
      changes: {
        enabled: false,
        reason: "auto_disable",
        consecutiveFailures,
      },
      actor: { id: null, name: null },
    },
    trx,
  );
  metrics.urlCheckAutoDisabledTotal.inc({ vantage });
  logger.info(
    { checkId, consecutiveFailures, threshold, vantage },
    "url check auto-disabled after consecutive failures",
  );
  return true;
}
