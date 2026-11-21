import { db } from "../db/connection.js";
import {
  BOM_SUGGESTION_REASON_META,
  normalizePurlIdentity,
  type BomSuggestionReason,
} from "@componode/core";
import { metrics } from "../plugins/metrics.js";
import { logger as appLogger } from "../plugins/logging.js";
import { slugify } from "../utils/slug.js";
import {
  stageBomSuggestions,
  supersedeBomPairs,
  type BomSuggestionPair,
  type BomCoveredPair,
} from "./bom-suggestion-store.js";

// Spec 075 / ADR-132 — the BOM matching pass. Runs after every COMPLETED
// import (hub + agent paths), failure-isolated like runSuggestionPass.
// Per bom_entry it resolves the catalog component and stages a PENDING
// dependency suggestion — it NEVER writes an edge (exact matches are
// candidates; only human decisions wire `component_depends_on_component`).
//
// Classification (research D2): PURL_EXACT when normalized-identity
// equality finds a component (`resolvedComponentId` is set — that is the
// catalog linkage, not an edge); otherwise a normalized-name hit is
// PURL_NAME_MATCH and a slug hit is CATALOG_SLUG_MATCH. Pairs that are
// already wired get SUPERSEDED tombstones so they never resurface.

export interface BomMatchScope {
  componentIds: string[];
}

export interface BomMatchReport {
  entriesScanned: number;
  resolved: number;
  staged: number;
  superseded: number;
}

export async function generateBomMatches(
  scope: BomMatchScope,
): Promise<BomMatchReport> {
  const startedAt = Date.now();
  const report: BomMatchReport = {
    entriesScanned: 0,
    resolved: 0,
    staged: 0,
    superseded: 0,
  };
  if (scope.componentIds.length === 0) {
    return finishBomMatchPass("components:0", startedAt, report);
  }

  const entries = await db
    .selectFrom("bom_entries")
    .select([
      "id",
      "componentId",
      "name",
      "purlIdentity",
      "resolvedComponentId",
    ])
    .where("componentId", "in", scope.componentIds)
    .execute();
  report.entriesScanned = entries.length;
  if (entries.length === 0) {
    return finishBomMatchPass("components", startedAt, report);
  }

  // Candidate indexes over non-retired components — one fetch, matched in
  // memory like `generateSuggestions` (plan Performance Goals). Identity
  // lookups cover verbatim externalId and normalized pkg: identities.
  const candidates = await db
    .selectFrom("components")
    .select(["id", "name", "slug", "externalId"])
    .where("lifecycle", "!=", "RETIRED")
    .execute();
  const byLowerName = new Map<string, string>();
  const bySlug = new Map<string, string>();
  const byVerbatimIdentity = new Map<string, string>();
  const byNormalizedIdentity = new Map<string, string>();
  for (const c of candidates) {
    const key = c.name.trim().toLowerCase();
    if (!byLowerName.has(key)) byLowerName.set(key, c.id);
    if (!bySlug.has(c.slug)) bySlug.set(c.slug, c.id);
    if (c.externalId) {
      if (!byVerbatimIdentity.has(c.externalId))
        byVerbatimIdentity.set(c.externalId, c.id);
      if (c.externalId.toLowerCase().startsWith("pkg:")) {
        const normalized = normalizePurlIdentity(c.externalId);
        if (normalized && !byNormalizedIdentity.has(normalized))
          byNormalizedIdentity.set(normalized, c.id);
      }
    }
  }

  // Existing edges for this scope — pairs already wired supersede.
  const edgeRows = await db
    .selectFrom("component_depends_on_component")
    .select(["parentId", "childId"])
    .where("parentId", "in", scope.componentIds)
    .execute();
  const edged = new Set(edgeRows.map((e) => `${e.parentId}|${e.childId}`));

  const staged: BomSuggestionPair[] = [];
  const covered: BomCoveredPair[] = [];
  const resolvedUpdates: { entryId: string; componentId: string }[] = [];

  for (const entry of entries) {
    let candidateId: string | null = null;
    let reason: BomSuggestionReason | null = null;

    const exact =
      byVerbatimIdentity.get(entry.purlIdentity) ??
      byNormalizedIdentity.get(entry.purlIdentity) ??
      null;
    if (exact) {
      candidateId = exact;
      reason = "PURL_EXACT";
      if (!entry.resolvedComponentId) {
        resolvedUpdates.push({ entryId: entry.id, componentId: exact });
      }
    } else {
      const nameHit = byLowerName.get(entry.name.trim().toLowerCase());
      if (nameHit) {
        candidateId = nameHit;
        reason = "PURL_NAME_MATCH";
      } else {
        const slugHit = bySlug.get(slugify(entry.name));
        if (slugHit) {
          candidateId = slugHit;
          reason = "CATALOG_SLUG_MATCH";
        }
      }
    }
    if (!candidateId || !reason) continue;
    if (candidateId === entry.componentId) continue; // never self-suggest

    const pairKey = `${entry.componentId}|${candidateId}`;
    if (edged.has(pairKey)) {
      covered.push({
        parentComponentId: entry.componentId,
        childComponentId: candidateId,
        bomEntryId: entry.id,
      });
    } else {
      staged.push({
        bomEntryId: entry.id,
        parentComponentId: entry.componentId,
        childComponentId: candidateId,
        reason,
        score: BOM_SUGGESTION_REASON_META[reason].score,
      });
    }
  }

  if (resolvedUpdates.length > 0) {
    // Group by target component — entries sharing an identity resolve to
    // the same component, so a handful of IN-list updates cover the scope.
    const byComponent = new Map<string, string[]>();
    for (const u of resolvedUpdates) {
      const list = byComponent.get(u.componentId) ?? [];
      list.push(u.entryId);
      byComponent.set(u.componentId, list);
    }
    for (const [componentId, entryIds] of byComponent) {
      for (let i = 0; i < entryIds.length; i += 500) {
        await db
          .updateTable("bom_entries")
          .set({
            resolvedComponentId: componentId,
            updatedAt: new Date().toISOString(),
          })
          .where("id", "in", entryIds.slice(i, i + 500))
          .where("resolvedComponentId", "is", null)
          .execute();
      }
    }
    report.resolved = resolvedUpdates.length;
  }

  const tombstoned = await supersedeBomPairs(db, covered);
  report.superseded = tombstoned.flipped + tombstoned.inserted;
  report.staged = await stageBomSuggestions(staged, db);

  return finishBomMatchPass("components", startedAt, report);
}

/**
 * Failure-isolated trigger wrapper (ADR-113 parity): a matching bug is
 * logged and metric-counted, never thrown into the run completion.
 */
export async function runBomMatchPass(
  scope: BomMatchScope,
  context: Record<string, unknown> = {},
): Promise<BomMatchReport | undefined> {
  try {
    return await generateBomMatches(scope);
  } catch (err) {
    metrics.suggestionPassErrorsTotal.inc();
    appLogger.error({ ...context, err }, "BOM match pass failed");
    return undefined;
  }
}

function finishBomMatchPass(
  scopeLabel: string,
  startedAt: number,
  report: BomMatchReport,
): BomMatchReport {
  const durationSeconds = (Date.now() - startedAt) / 1000;
  appLogger.info(
    { scope: scopeLabel, durationSeconds, ...report },
    "BOM match pass complete",
  );
  metrics.suggestionPassesTotal.inc({ scope: `bom:${scopeLabel}` });
  metrics.suggestionPassDurationSeconds.observe(
    { scope: `bom:${scopeLabel}` },
    durationSeconds,
  );
  return report;
}
