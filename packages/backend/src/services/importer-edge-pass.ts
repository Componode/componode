import { EDGE_JUNCTION, type EdgeKind } from "@componode/core";
import { db } from "../db/connection.js";
import type { DB } from "../db/types.js";
import type { Kysely } from "kysely";
import { logger as appLogger } from "../plugins/logging.js";
import { writeEdgeChange, type Actor } from "./audit-service.js";
import {
  deleteEdge,
  edgePairKey,
  insertImporterEdge,
  listImporterEdgesForSource,
  listSuppressedPairs,
} from "./component-edge-store.js";

/**
 * Spec 076 / ADR-133 — importer-declared edge pass. Runs on the completed
 * path of both run services (hub worker + remote-run dispatcher), only
 * when the run's config opted in via the manifest-declared
 * `declaredEdgesConfigKey` scope key.
 *
 * Same-run scope: `targetExternalId` resolves only against the externalIds
 * of assets this run yielded — cross-run targets drop silently. Suppressed
 * pairs are skipped before insert and never recreated; curated edges are
 * preserved by the conflict-safe write and exempt from retirement. Source-
 * scoped diff retire removes IMPORTER-provenance edges this Source wrote
 * before that the new declared set no longer contains — mirroring the
 * ADR-119 membership contract (completed runs only; callers guarantee).
 */

export interface DeclaredEdge {
  fromComponentId: string;
  type: EdgeKind;
  targetExternalId: string;
}

/**
 * Collect a yielded asset's `relationships[]` into DeclaredEdge rows for
 * the pass. Both run paths call this after their own opt-in flag check —
 * identical collection keeps hub and agent runs in parity.
 */
export function collectDeclaredEdges(
  asset: { relationships?: { type: EdgeKind; targetExternalId: string }[] },
  fromComponentId: string,
): DeclaredEdge[] {
  return (asset.relationships ?? []).map((r) => ({
    fromComponentId,
    type: r.type,
    targetExternalId: r.targetExternalId,
  }));
}

export interface ImporterEdgePassInput {
  /** One row per `relationships[]` entry the run yielded. */
  edges: DeclaredEdge[];
  /** externalId → componentId for every asset this run yielded. */
  externalIdToComponentId: Map<string, string>;
  sourceId: string | null;
  runId: string;
  actor: Actor;
}

export interface ImporterEdgePassReport {
  declared: number;
  resolved: number;
  /** Targets with no same-run asset, or self-edges — dropped silently. */
  dropped: number;
  /** Pairs the suppression table vetoed. */
  suppressed: number;
  /** Repeat declarations of an already-resolved pair — collapsed, not written. */
  duplicates: number;
  /** Junction rows newly inserted. */
  added: number;
  /** Prior importer edges absent from this run's declared set — removed. */
  retired: number;
}

export async function runImporterEdgePass(
  input: ImporterEdgePassInput,
): Promise<ImporterEdgePassReport | null> {
  // Failure-isolated like the suggestion/BOM-match passes — an edge-pass
  // bug must never flip a completed run (spec 076 FR-003).
  try {
    return await applyDeclaredEdges(input);
  } catch (err) {
    appLogger.error({ runId: input.runId, err }, "importer edge pass failed");
    return null;
  }
}

async function applyDeclaredEdges(
  input: ImporterEdgePassInput,
): Promise<ImporterEdgePassReport | null> {
  // Callers invoke the pass only on opted-in completed runs — an empty
  // declared set is still authoritative (it retires the Source's prior
  // importer edges), so no early return on edges.length === 0.

  const report: ImporterEdgePassReport = {
    declared: input.edges.length,
    resolved: 0,
    dropped: 0,
    suppressed: 0,
    duplicates: 0,
    added: 0,
    retired: 0,
  };

  // IMPORTER provenance requires a durable Source — a run path without
  // one (non-adopting importer, report race) cannot attribute edges.
  if (!input.sourceId) {
    report.dropped = report.declared;
    return report;
  }
  const sourceId = input.sourceId;

  await db.transaction().execute(async (trx: Kysely<DB>) => {
    // Resolve + dedup declared pairs against the same-run yield map.
    const wanted = new Map<
      string,
      { kind: EdgeKind; fromId: string; toId: string }
    >();
    for (const edge of input.edges) {
      const toId = input.externalIdToComponentId.get(edge.targetExternalId);
      if (!toId || toId === edge.fromComponentId) {
        report.dropped++;
        continue;
      }
      const candidate = {
        kind: edge.type,
        fromId: edge.fromComponentId,
        toId,
      };
      const key = edgePairKey(candidate);
      if (wanted.has(key)) {
        report.duplicates++;
        continue;
      }
      wanted.set(key, candidate);
      report.resolved++;
    }

    // Suppression vetoes a pair whoever declares it — Hide is durable.
    const suppressedKeys = await listSuppressedPairs(
      [...wanted.values()],
      trx,
    );
    for (const key of suppressedKeys) {
      wanted.delete(key);
      report.suppressed++;
    }

    // Conflict-safe inserts preserve curated rows and prior importer rows.
    for (const edge of wanted.values()) {
      const inserted = await insertImporterEdge(
        edge.kind,
        edge.fromId,
        edge.toId,
        { sourceId, runId: input.runId },
        trx,
      );
      if (inserted) {
        report.added++;
        await writeEdgeChange(
          EDGE_JUNCTION[edge.kind].table,
          { entityType: "component", entityId: edge.fromId },
          { entityType: "component", entityId: edge.toId },
          "added",
          input.actor,
          "importer-edge:declared",
          trx,
        );
      }
    }

    // Source-scoped diff retire: IMPORTER rows this Source wrote that the
    // new declared set no longer contains. Curated rows are never listed.
    const existing = await listImporterEdgesForSource(sourceId, trx);
    for (const edge of existing) {
      if (wanted.has(edgePairKey(edge))) continue;
      if (await deleteEdge(edge.kind, edge.fromId, edge.toId, trx)) {
        report.retired++;
        await writeEdgeChange(
          EDGE_JUNCTION[edge.kind].table,
          { entityType: "component", entityId: edge.fromId },
          { entityType: "component", entityId: edge.toId },
          "removed",
          input.actor,
          "importer-edge:retired",
          trx,
        );
      }
    }
  });

  return report;
}
