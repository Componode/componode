import type { Kysely, Transaction } from "kysely";
import { uuidv7 } from "uuidv7";
import { EDGE_JUNCTION, type EdgeKind, type EdgeProvenance } from "@componode/core";
import { db } from "../db/connection.js";
import type { DB } from "../db/types.js";
import { writeEdgeChange, type Actor } from "./audit-service.js";

/**
 * Spec 076 / ADR-133 — shared write primitives for the three component-edge
 * junctions (`component_depends_on_component`, `component_sources_from`,
 * `component_exposes`) and `component_edge_suppressions`. Used by the
 * importer-edge pass (Phase 3) and the hide-edge endpoint. The three
 * junctions carry different column pairs, so each operation branches on
 * `EdgeKind` rather than smuggling column names into a dynamic query.
 */

type DbOrTrx = Kysely<DB> | Transaction<DB>;

export interface ImporterEdgeRef {
  kind: EdgeKind;
  fromId: string;
  toId: string;
}

/**
 * Insert an IMPORTER-provenance edge. `ON CONFLICT DO NOTHING` — an
 * existing row (curated or importer-written) is preserved untouched,
 * including its provenance. Returns true when a row was inserted.
 */
export async function insertImporterEdge(
  kind: EdgeKind,
  fromId: string,
  toId: string,
  provenance: { sourceId: string; runId: string },
  trx: DbOrTrx = db,
): Promise<boolean> {
  const now = new Date().toISOString();
  const meta = {
    createdAt: now,
    provenance: "IMPORTER",
    importerSourceId: provenance.sourceId,
    importRunId: provenance.runId,
  };
  const res =
    kind === "DEPENDS_ON"
      ? await trx
          .insertInto("component_depends_on_component")
          .values({ parentId: fromId, childId: toId, ...meta })
          .onConflict((oc) => oc.columns(["parentId", "childId"]).doNothing())
          .executeTakeFirst()
      : kind === "SOURCES_FROM"
        ? await trx
            .insertInto("component_sources_from")
            .values({ serviceId: fromId, repositoryId: toId, ...meta })
            .onConflict((oc) =>
              oc.columns(["serviceId", "repositoryId"]).doNothing(),
            )
            .executeTakeFirst()
        : await trx
            .insertInto("component_exposes")
            .values({ serviceId: fromId, apiId: toId, ...meta })
            .onConflict((oc) => oc.columns(["serviceId", "apiId"]).doNothing())
            .executeTakeFirst();
  return Number(res.numInsertedOrUpdatedRows ?? 0) > 0;
}

/** The provenance of the junction row for a pair, or null when no row exists. */
export async function getEdgeProvenance(
  kind: EdgeKind,
  fromId: string,
  toId: string,
  trx: DbOrTrx = db,
): Promise<EdgeProvenance | null> {
  const row =
    kind === "DEPENDS_ON"
      ? await trx
          .selectFrom("component_depends_on_component")
          .select("provenance")
          .where("parentId", "=", fromId)
          .where("childId", "=", toId)
          .executeTakeFirst()
      : kind === "SOURCES_FROM"
        ? await trx
            .selectFrom("component_sources_from")
            .select("provenance")
            .where("serviceId", "=", fromId)
            .where("repositoryId", "=", toId)
            .executeTakeFirst()
        : await trx
            .selectFrom("component_exposes")
            .select("provenance")
            .where("serviceId", "=", fromId)
            .where("apiId", "=", toId)
            .executeTakeFirst();
  return (row?.provenance as EdgeProvenance | undefined) ?? null;
}

/** Delete the junction row for a pair. Returns true when a row was removed. */
export async function deleteEdge(
  kind: EdgeKind,
  fromId: string,
  toId: string,
  trx: DbOrTrx = db,
): Promise<boolean> {
  const res =
    kind === "DEPENDS_ON"
      ? await trx
          .deleteFrom("component_depends_on_component")
          .where("parentId", "=", fromId)
          .where("childId", "=", toId)
          .executeTakeFirst()
      : kind === "SOURCES_FROM"
        ? await trx
            .deleteFrom("component_sources_from")
            .where("serviceId", "=", fromId)
            .where("repositoryId", "=", toId)
            .executeTakeFirst()
        : await trx
            .deleteFrom("component_exposes")
            .where("serviceId", "=", fromId)
            .where("apiId", "=", toId)
            .executeTakeFirst();
  return Number(res.numDeletedRows ?? 0) > 0;
}

/** All IMPORTER-provenance edges attributed to a source, across all three junctions. */
export async function listImporterEdgesForSource(
  sourceId: string,
  trx: DbOrTrx = db,
): Promise<ImporterEdgeRef[]> {
  const [depends, sources, exposes] = await Promise.all([
    trx
      .selectFrom("component_depends_on_component")
      .select(["parentId", "childId"])
      .where("provenance", "=", "IMPORTER")
      .where("importerSourceId", "=", sourceId)
      .execute(),
    trx
      .selectFrom("component_sources_from")
      .select(["serviceId", "repositoryId"])
      .where("provenance", "=", "IMPORTER")
      .where("importerSourceId", "=", sourceId)
      .execute(),
    trx
      .selectFrom("component_exposes")
      .select(["serviceId", "apiId"])
      .where("provenance", "=", "IMPORTER")
      .where("importerSourceId", "=", sourceId)
      .execute(),
  ]);
  return [
    ...depends.map(
      (r): ImporterEdgeRef => ({
        kind: "DEPENDS_ON",
        fromId: r.parentId!,
        toId: r.childId!,
      }),
    ),
    ...sources.map(
      (r): ImporterEdgeRef => ({
        kind: "SOURCES_FROM",
        fromId: r.serviceId!,
        toId: r.repositoryId!,
      }),
    ),
    ...exposes.map(
      (r): ImporterEdgeRef => ({
        kind: "EXPOSES",
        fromId: r.serviceId!,
        toId: r.apiId!,
      }),
    ),
  ];
}

export function edgePairKey(p: ImporterEdgeRef): string {
  return `${p.kind}${p.fromId}${p.toId}`;
}

/** The suppressed pairs among `pairs` — the pass subtracts these before writing. */
export async function listSuppressedPairs(
  pairs: ImporterEdgeRef[],
  trx: DbOrTrx = db,
): Promise<Set<string>> {
  const suppressed = new Set<string>();
  if (pairs.length === 0) return suppressed;
  const rows = await trx
    .selectFrom("component_edge_suppressions")
    .select(["edgeKind", "fromComponentId", "toComponentId"])
    .where((eb) =>
      eb.or(
        pairs.map((p) =>
          eb.and([
            eb("edgeKind", "=", p.kind),
            eb("fromComponentId", "=", p.fromId),
            eb("toComponentId", "=", p.toId),
          ]),
        ),
      ),
    )
    .execute();
  for (const r of rows) {
    suppressed.add(
      edgePairKey({ kind: r.edgeKind as EdgeKind, fromId: r.fromComponentId, toId: r.toComponentId }),
    );
  }
  return suppressed;
}

/** Upsert a suppression record — idempotent per (kind, from, to). */
export async function suppressPair(
  kind: EdgeKind,
  fromId: string,
  toId: string,
  personId: string | null,
  trx: DbOrTrx = db,
): Promise<void> {
  await trx
    .insertInto("component_edge_suppressions")
    .values({
      id: uuidv7(),
      edgeKind: kind,
      fromComponentId: fromId,
      toComponentId: toId,
      suppressedBy: personId,
      createdAt: new Date().toISOString(),
    })
    .onConflict((oc) =>
      oc.columns(["edgeKind", "fromComponentId", "toComponentId"]).doNothing(),
    )
    .execute();
}

/**
 * UX-EDGE-02 "Hide edge" (spec 076): durable, pair-scoped suppression —
 * single transaction. Refuses `CURATED` junction rows (human edges change
 * through human paths, FR-008); records the suppression before deleting
 * the junction row so a race still leaves the veto in place.
 */
export async function suppressComponentEdge(
  input: { edgeKind: EdgeKind; fromComponentId: string; toComponentId: string },
  actor: Actor,
): Promise<{ suppressed: true; edgeRemoved: boolean }> {
  const { edgeKind, fromComponentId, toComponentId } = input;
  return db.transaction().execute(async (trx) => {
    const components = await trx
      .selectFrom("components")
      .select("id")
      .where("id", "in", [fromComponentId, toComponentId])
      .execute();
    if (components.length !== 2) {
      throw Object.assign(new Error("Component not found"), {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }
    const provenance = await getEdgeProvenance(
      edgeKind,
      fromComponentId,
      toComponentId,
      trx,
    );
    if (provenance === "CURATED") {
      throw Object.assign(
        new Error("Only importer-added edges can be hidden"),
        { statusCode: 409, code: "CONFLICT" },
      );
    }
    await suppressPair(edgeKind, fromComponentId, toComponentId, actor.id, trx);
    const edgeRemoved = await deleteEdge(
      edgeKind,
      fromComponentId,
      toComponentId,
      trx,
    );
    if (edgeRemoved) {
      await writeEdgeChange(
        EDGE_JUNCTION[edgeKind].table,
        { entityType: "component", entityId: fromComponentId },
        { entityType: "component", entityId: toComponentId },
        "removed",
        actor,
        "edge-suppressed",
        trx,
      );
    }
    return { suppressed: true, edgeRemoved };
  });
}
