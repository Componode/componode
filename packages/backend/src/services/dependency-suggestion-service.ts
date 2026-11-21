import { sql, type SqlBool, type Transaction } from "kysely";
import type { DB } from "../db/types.js";
import { db } from "../db/connection.js";
import type {
  DependencyBulkResult,
  DependencySuggestionGroup,
  DependencySuggestion,
  DependencySuggestionGroupListResult,
  DependencySuggestionListResult,
  DependencySuggestionQueueItem,
  DependencyGroupsQuery,
  ListSuggestionsQuery,
} from "@componode/core";
import { paginateQuery, paginationMeta, sortTarget, type OrderTarget } from "../utils/pagination.js";
import { toIsoTimestamp } from "../db/timestamps.js";
import { writeEdgeChange, type Actor } from "./audit-service.js";

// Spec 075 / ADR-132 — the dependency suggestion queue service. ADR-113
// parity with the product-edge queue: PENDING actionable, everything else
// terminal; accept writes the edge inside the same transaction and lands
// SUPERSEDED (not ACCEPTED) when the pair was already wired.

const notFound = (entity: string) =>
  Object.assign(new Error(`${entity} not found`), {
    statusCode: 404,
    code: "NOT_FOUND",
  });
const conflict = (message: string) =>
  Object.assign(new Error(message), { statusCode: 409, code: "CONFLICT" });

const SORT_COLUMNS: Record<string, OrderTarget> = {
  createdAt: "bom_component_suggestions.createdAt",
  decidedAt: "bom_component_suggestions.decidedAt",
  status: "bom_component_suggestions.status",
  score: "score",
};

interface QueueRow {
  id: string;
  parentComponentId: string;
  childComponentId: string;
  bomEntryId: string | null;
  reason: string | null;
  score: number | null;
  status: string;
  createdAt: unknown;
  decidedAt: unknown;
  decidedBy: string | null;
  parentSlug: string;
  parentName: string;
  parentCategory: string;
  childSlug: string;
  childName: string;
  childCategory: string;
  decidedByName: string | null;
}

function toQueueItem(row: QueueRow): DependencySuggestionQueueItem {
  return {
    id: row.id,
    parentComponentId: row.parentComponentId,
    childComponentId: row.childComponentId,
    bomEntryId: row.bomEntryId,
    reason: row.reason as DependencySuggestionQueueItem["reason"],
    score: row.score === null ? null : row.score / 100, // centi-score → decimal
    status: row.status as DependencySuggestionQueueItem["status"],
    createdAt: toIsoTimestamp(row.createdAt),
    decidedAt: row.decidedAt ? toIsoTimestamp(row.decidedAt) : null,
    decidedBy: row.decidedBy,
    parentComponent: {
      id: row.parentComponentId,
      slug: row.parentSlug,
      name: row.parentName,
      category: row.parentCategory as DependencySuggestionQueueItem["parentComponent"]["category"],
    },
    childComponent: {
      id: row.childComponentId,
      slug: row.childSlug,
      name: row.childName,
      category: row.childCategory as DependencySuggestionQueueItem["childComponent"]["category"],
    },
    decidedByName: row.decidedByName ?? null,
  };
}

/** GET /suggestions?kind=dependency — same envelope + sort views as edges. */
export async function listDependencySuggestions(
  query: ListSuggestionsQuery,
): Promise<DependencySuggestionListResult> {
  const { page, pageSize, sort, order } = query;
  const offset = (page - 1) * pageSize;
  const base = () =>
    db
      .selectFrom("bom_component_suggestions")
      .innerJoin("components as parent", (join) =>
        join.onRef(
          "parent.id",
          "=",
          "bom_component_suggestions.parentComponentId",
        ),
      )
      .innerJoin("components as child", (join) =>
        join.onRef(
          "child.id",
          "=",
          "bom_component_suggestions.childComponentId",
        ),
      )
      .leftJoin("persons", "persons.id", "bom_component_suggestions.decidedBy")
      .where((eb) =>
        query.status === "DECIDED"
          ? eb("bom_component_suggestions.status", "!=", "PENDING")
          : eb("bom_component_suggestions.status", "=", query.status),
      );

  const filtered = () => {
    let q = base();
    if (query.childComponentId) {
      q = q.where(
        "bom_component_suggestions.childComponentId",
        "=",
        query.childComponentId,
      );
    }
    if (query.status === "PENDING") {
      // RETIRED endpoints hidden, not deleted (read-side, reversible).
      q = q
        .where("parent.lifecycle", "!=", "RETIRED")
        .where("child.lifecycle", "!=", "RETIRED");
    }
    return q;
  };

  const countRow = await filtered()
    .select((eb) => eb.fn.countAll().as("total"))
    .executeTakeFirstOrThrow();
  const total = Number(countRow.total);

  let rowsQuery = filtered().select((eb) => [
    "bom_component_suggestions.id",
    "bom_component_suggestions.parentComponentId",
    "bom_component_suggestions.childComponentId",
    "bom_component_suggestions.bomEntryId",
    "bom_component_suggestions.reason",
    "bom_component_suggestions.score",
    "bom_component_suggestions.status",
    "bom_component_suggestions.createdAt",
    "bom_component_suggestions.decidedAt",
    "bom_component_suggestions.decidedBy",
    "parent.slug as parentSlug",
    "parent.name as parentName",
    "parent.category as parentCategory",
    "child.slug as childSlug",
    "child.name as childName",
    "child.category as childCategory",
    eb.fn
      .coalesce("persons.displayName", "persons.username")
      .as("decidedByName"),
  ]);

  // Edge-queue parity: decided views sort by decidedAt (score is NULL on
  // tombstones); on PENDING, decidedAt is always NULL → map to createdAt.
  const effectiveSort =
    query.status !== "PENDING" && sort === "score"
      ? "decidedAt"
      : query.status === "PENDING" && sort === "decidedAt"
        ? "createdAt"
        : sort;
  if (effectiveSort === "score") {
    rowsQuery = rowsQuery
      .orderBy("bom_component_suggestions.score", order)
      .orderBy("bom_component_suggestions.createdAt", "asc")
      .orderBy("bom_component_suggestions.id", "asc");
  } else {
    rowsQuery = rowsQuery
      .orderBy(
        sortTarget(SORT_COLUMNS, effectiveSort, "createdAt"),
        order,
      )
      .orderBy("bom_component_suggestions.id", order);
  }
  const rows = await rowsQuery.limit(pageSize).offset(offset).execute();
  return {
    data: rows.map(toQueueItem),
    pagination: paginationMeta(total, page, pageSize),
  };
}

/**
 * GET /suggestions/dependencies/groups — one row per candidate component
 * over PENDING rows. `versions` counts distinct entry versions via
 * `bomEntryId`; `bulkAcceptable` = every pending reason is PURL_EXACT.
 */
export async function listDependencyGroups(
  query: DependencyGroupsQuery,
): Promise<DependencySuggestionGroupListResult> {
  const inner = db
    .selectFrom("bom_component_suggestions")
    .innerJoin("components as child", (join) =>
      join.onRef(
        "child.id",
        "=",
        "bom_component_suggestions.childComponentId",
      ),
    )
    .innerJoin("components as parent", (join) =>
      join.onRef(
        "parent.id",
        "=",
        "bom_component_suggestions.parentComponentId",
      ),
    )
    // LEFT — a suggestion outlives its representative entry (bomEntryId is
    // SET NULL when BOM pruning removes it; the decided pair must stay
    // terminal, T082).
    .leftJoin("bom_entries as rep", (join) =>
      join.onRef("rep.id", "=", "bom_component_suggestions.bomEntryId"),
    )
    // Every entry of the same (consumer, identity) pair — the suggestion's
    // bomEntryId is only a representative; `versions` spans all of them
    // (T077).
    .leftJoin("bom_entries as be2", (join) =>
      join
        .onRef(
          "be2.componentId",
          "=",
          "bom_component_suggestions.parentComponentId",
        )
        // NULL-rep rows (entry pruned → SET NULL) fall back to the child's
        // verbatim-normalized externalId for the identity key (T089).
        .on(
          sql<SqlBool>`"be2"."purlIdentity" = coalesce("rep"."purlIdentity", "child"."externalId")`,
        ),
    )
    .where("bom_component_suggestions.status", "=", "PENDING")
    .where("parent.lifecycle", "!=", "RETIRED")
    .where("child.lifecycle", "!=", "RETIRED")
    .$if(query.childComponentId != null, (qb) =>
      qb.where(
        "bom_component_suggestions.childComponentId",
        "=",
        query.childComponentId!,
      ),
    )
    .groupBy([
      "bom_component_suggestions.childComponentId",
      "child.id",
      "child.slug",
      "child.name",
      "child.category",
      "child.externalId",
    ])
    .select((eb) => [
      "child.id as childId",
      "child.slug as childSlug",
      "child.name as childName",
      "child.category as childCategory",
      "child.externalId as purl",
      eb.fn
        .count("bom_component_suggestions.id")
        .distinct()
        .as("pendingCount"),
      eb.fn.count("be2.version").distinct().as("versions"),
      sql<
        string[]
      >`array_agg(DISTINCT bom_component_suggestions.reason)`.as("reasons"),
      eb.fn.max("bom_component_suggestions.score").as("topScore"),
      sql<boolean>`bool_and(bom_component_suggestions.reason = 'PURL_EXACT')`.as(
        "bulkAcceptable",
      ),
    ]);

  const grouped = db.selectFrom(inner.as("g")).selectAll();
  const page = await paginateQuery(
    grouped,
    { page: query.page, pageSize: query.pageSize },
    {
      orderBy: (qb) => {
        const key =
          query.sort === "components"
            ? "pendingCount"
            : query.sort === "name"
              ? "childName"
              : "topScore";
        return qb.orderBy(key, query.order).orderBy("childId", "asc");
      },
    },
  );

  type Row = {
    childId: string;
    childSlug: string;
    childName: string;
    childCategory: string;
    purl: string | null;
    pendingCount: string | number;
    versions: string | number;
    reasons: string[] | null;
    topScore: number | null;
    bulkAcceptable: boolean;
  };
  return {
    pagination: page.pagination,
    data: (page.data as Row[]).map((r) => ({
      childComponent: {
        id: r.childId,
        slug: r.childSlug,
        name: r.childName,
        category: r.childCategory as DependencySuggestionQueueItem["childComponent"]["category"],
      },
      purl: r.purl,
      pendingCount: Number(r.pendingCount),
      versions: Number(r.versions),
      reasons: (r.reasons ?? []).filter((x): x is NonNullable<typeof x> => Boolean(x)) as DependencySuggestionGroup["reasons"],
      topScore: r.topScore === null ? null : r.topScore / 100,
      bulkAcceptable: r.bulkAcceptable,
    })),
  };
}

async function decideOne(
  trx: Transaction<DB>,
  suggestionId: string,
  action: "accept" | "dismiss",
  actor: Actor,
): Promise<{ suggestion: DependencySuggestion; edgeCreated: boolean }> {
  const row = await trx
    .selectFrom("bom_component_suggestions")
    .selectAll()
    .where("id", "=", suggestionId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw notFound("Suggestion");
  if (row.status !== "PENDING") throw conflict("Suggestion is already decided");

  const now = new Date().toISOString();
  let edgeCreated = false;
  if (action === "dismiss") {
    await trx
      .updateTable("bom_component_suggestions")
      .set({ status: "DISMISSED", decidedAt: now, decidedBy: actor.id })
      .where("id", "=", suggestionId)
      .execute();
  } else {
    // Pending reads hide RETIRED endpoints (UX-SUG-04); a component retired
    // after staging must not produce an edge — accept is undecidable
    // (dismiss stays decidable so stale rows can be cleared).
    const endpoints = await trx
      .selectFrom("components")
      .select(["id", "lifecycle"])
      .where("id", "in", [row.parentComponentId, row.childComponentId])
      .execute();
    if (endpoints.some((e) => e.lifecycle === "RETIRED")) {
      throw conflict("A suggestion endpoint is retired");
    }
    // Mark ACCEPTED first (queue parity); land SUPERSEDED when the pair was
    // already wired.
    await trx
      .updateTable("bom_component_suggestions")
      .set({ status: "ACCEPTED", decidedAt: now, decidedBy: actor.id })
      .where("id", "=", suggestionId)
      .where("status", "=", "PENDING")
      .execute();
    const res = await trx
      .insertInto("component_depends_on_component")
      .values({
        parentId: row.parentComponentId,
        childId: row.childComponentId,
        createdAt: now,
      })
      .onConflict((oc) => oc.columns(["parentId", "childId"]).doNothing())
      .executeTakeFirst();
    edgeCreated = Number(res.numInsertedOrUpdatedRows ?? 0) > 0;
    if (edgeCreated) {
      await writeEdgeChange(
        "component_depends_on_component",
        { entityType: "component", entityId: row.parentComponentId },
        { entityType: "component", entityId: row.childComponentId },
        "added",
        actor,
        "dependency-suggestion:accept",
        trx,
      );
    } else {
      await trx
        .updateTable("bom_component_suggestions")
        .set({ status: "SUPERSEDED", reason: null, score: null })
        .where("id", "=", suggestionId)
        .execute();
    }
  }
  const final = await trx
    .selectFrom("bom_component_suggestions")
    .selectAll()
    .where("id", "=", suggestionId)
    .executeTakeFirstOrThrow();
  return {
    suggestion: {
      id: final.id,
      parentComponentId: final.parentComponentId,
      childComponentId: final.childComponentId,
      bomEntryId: final.bomEntryId,
      reason: final.reason as DependencySuggestion["reason"],
      score: final.score === null ? null : final.score / 100,
      status: final.status as DependencySuggestion["status"],
      createdAt: toIsoTimestamp(final.createdAt),
      decidedAt: final.decidedAt ? toIsoTimestamp(final.decidedAt) : null,
      decidedBy: final.decidedBy,
    },
    edgeCreated,
  };
}

export async function acceptDependencySuggestion(
  id: string,
  actor: Actor,
): Promise<DependencySuggestion> {
  const { suggestion } = await db
    .transaction()
    .execute((trx) => decideOne(trx, id, "accept", actor));
  return suggestion;
}

export async function dismissDependencySuggestion(
  id: string,
  actor: Actor,
): Promise<DependencySuggestion> {
  const { suggestion } = await db
    .transaction()
    .execute((trx) => decideOne(trx, id, "dismiss", actor));
  return suggestion;
}

/**
 * POST /suggestions/dependencies/bulk — every PENDING row for one library.
 * `accept` is exact-match only server-side (UX-SUG-06); `dismiss` takes any
 * reason. Per-pair edge failures isolate into `failedIds` without rolling
 * back siblings.
 */
export async function bulkDecideDependencies(
  input: { childComponentId: string; action: "accept" | "dismiss" },
  actor: Actor,
): Promise<DependencyBulkResult> {
  const target = await db
    .selectFrom("components")
    .select("id")
    .where("id", "=", input.childComponentId)
    .executeTakeFirst();
  if (!target) throw notFound("Component");

  const pendingRows = await db
    .selectFrom("bom_component_suggestions as s")
    .innerJoin("components as p", (join) =>
      join.onRef("p.id", "=", "s.parentComponentId"),
    )
    .innerJoin("components as c", (join) =>
      join.onRef("c.id", "=", "s.childComponentId"),
    )
    .select([
      "s.id",
      "s.reason",
      "p.lifecycle as parentLifecycle",
      "c.lifecycle as childLifecycle",
    ])
    .where("s.childComponentId", "=", input.childComponentId)
    .where("s.status", "=", "PENDING")
    .execute();

  const result: DependencyBulkResult = {
    decided: 0,
    failed: 0,
    edges: 0,
    failedIds: [],
  };
  // Retired-endpoint rows are unreachable by accept — count them as failed
  // so the caller sees the partial outcome (dismiss stays decidable).
  const actionable = pendingRows.filter((r) => {
    if (
      input.action === "accept" &&
      (r.parentLifecycle === "RETIRED" || r.childLifecycle === "RETIRED")
    ) {
      result.failed++;
      result.failedIds.push(r.id);
      return false;
    }
    return true;
  });
  if (actionable.length === 0) return result;

  if (
    input.action === "accept" &&
    actionable.some((p) => p.reason !== "PURL_EXACT")
  ) {
    throw conflict(
      "Bulk accept requires every pending suggestion to be an exact package match",
    );
  }

  for (const row of actionable) {
    try {
      const { suggestion, edgeCreated } = await db
        .transaction()
        .execute((trx) => decideOne(trx, row.id, input.action, actor));
      result.decided++;
      if (edgeCreated) result.edges++;
      void suggestion;
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode === 409) continue; // raced terminal row — skip
      result.failed++;
      result.failedIds.push(row.id);
    }
  }
  return result;
}
