import { uuidv7 } from "uuidv7";
import { db } from "../db/connection.js";
import { logger as appLogger } from "../plugins/logging.js";
import { metrics } from "../plugins/metrics.js";
import { addDependsOnEdge, supersedeSuggestionPairs } from "./product-edge-service.js";
import { scorePair } from "./suggestion-signals.js";
import type { Actor } from "./audit-service.js";
import type {
  EdgeSuggestion,
  EdgeSuggestionReason,
  ListSuggestionsQuery,
  SuggestionListResult,
  SuggestionQueueItem,
  SuggestionRescanReport,
} from "@componode/core";

function notFound(entity: string) {
  return Object.assign(new Error(`${entity} not found`), {
    statusCode: 404,
    code: "NOT_FOUND",
  });
}

function conflict(message: string) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: "CONFLICT",
  });
}

// ---------------------------------------------------------------------------
// Row ↔ contract mapping
// ---------------------------------------------------------------------------

interface JoinedRow {
  id: string;
  productId: string;
  componentId: string;
  reason: string | null;
  score: number | null;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  productName: string;
  productSlug: string;
  componentName: string;
  componentSlug: string;
  componentCategory: string;
  decidedByName: string | null;
}

function toQueueItem(row: JoinedRow): SuggestionQueueItem {
  return {
    id: row.id,
    productId: row.productId,
    componentId: row.componentId,
    reason: (row.reason as EdgeSuggestionReason | null) ?? null,
    score: row.score === null ? null : row.score / 100,
    status: row.status as EdgeSuggestion["status"],
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy,
    decidedByName: row.decidedByName,
    product: {
      id: row.productId,
      name: row.productName,
      slug: row.productSlug,
    },
    component: {
      id: row.componentId,
      name: row.componentName,
      slug: row.componentSlug,
      category: row.componentCategory,
    },
  };
}

function toContract(row: {
  id: string;
  productId: string;
  componentId: string;
  reason: string | null;
  score: number | null;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}): EdgeSuggestion {
  return {
    id: row.id,
    productId: row.productId,
    componentId: row.componentId,
    reason: (row.reason as EdgeSuggestionReason | null) ?? null,
    score: row.score === null ? null : row.score / 100,
    status: row.status as EdgeSuggestion["status"],
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy,
  };
}

// ---------------------------------------------------------------------------
// Queue read (research.md D6)
// ---------------------------------------------------------------------------

export async function listSuggestions(
  query: ListSuggestionsQuery,
): Promise<SuggestionListResult> {
  const base = () =>
    db
      .selectFrom("edge_suggestions")
      .innerJoin(
        "digital_products",
        "digital_products.id",
        "edge_suggestions.productId",
      )
      .innerJoin(
        "components",
        "components.id",
        "edge_suggestions.componentId",
      )
      .leftJoin("persons", "persons.id", "edge_suggestions.decidedBy")
      .where("edge_suggestions.status", "=", query.status);

  const filtered = () => {
    let q = base();
    if (query.status === "PENDING") {
      // Read-side lifecycle filtering: RETIRED endpoints are hidden, not
      // deleted — retiring is reversible (research.md D4).
      q = q
        .where("digital_products.lifecycle", "!=", "RETIRED")
        .where("components.lifecycle", "!=", "RETIRED");
    }
    return q;
  };

  const countRow = await filtered()
    .select((eb) => eb.fn.countAll().as("total"))
    .executeTakeFirstOrThrow();
  const total = Number(countRow.total);

  let rowsQuery = filtered().select((eb) => [
    "edge_suggestions.id",
    "edge_suggestions.productId",
    "edge_suggestions.componentId",
    "edge_suggestions.reason",
    "edge_suggestions.score",
    "edge_suggestions.status",
    "edge_suggestions.createdAt",
    "edge_suggestions.decidedAt",
    "edge_suggestions.decidedBy",
    "digital_products.name as productName",
    "digital_products.slug as productSlug",
    "components.name as componentName",
    "components.slug as componentSlug",
    "components.category as componentCategory",
    eb.fn
      .coalesce("persons.displayName", "persons.username")
      .as("decidedByName"),
  ]);
  if (query.status === "PENDING") {
    rowsQuery = rowsQuery
      .orderBy("edge_suggestions.score", "desc")
      .orderBy("edge_suggestions.createdAt", "asc")
      .orderBy("edge_suggestions.id", "asc");
  } else {
    rowsQuery = rowsQuery.orderBy("edge_suggestions.decidedAt", "desc");
  }
  const rows = await rowsQuery
    .limit(query.limit)
    .offset(query.offset)
    .execute();

  return {
    items: rows.map((r) => toQueueItem(r as unknown as JoinedRow)),
    total,
  };
}

// ---------------------------------------------------------------------------
// Decide — accept / dismiss (research.md D5)
// ---------------------------------------------------------------------------

export async function acceptSuggestion(
  id: string,
  actor: Actor,
): Promise<EdgeSuggestion> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom("edge_suggestions")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound("Suggestion");
    if (row.status !== "PENDING") {
      throw conflict("Suggestion is already decided");
    }

    // Mark ACCEPTED first: the tombstone upsert inside addDependsOnEdge only
    // flips PENDING rows, so this stays ACCEPTED. If the edge write throws
    // (e.g. component gone → 404) the transaction rolls back and the row
    // stays PENDING.
    const updated = await trx
      .updateTable("edge_suggestions")
      .set({
        status: "ACCEPTED",
        decidedAt: new Date().toISOString(),
        decidedBy: actor.id,
      })
      .where("id", "=", id)
      .where("status", "=", "PENDING")
      .executeTakeFirst();
    if (!Number(updated.numUpdatedRows)) {
      throw conflict("Suggestion is already decided");
    }

    const { created } = await addDependsOnEdge(
      row.productId,
      { componentId: row.componentId },
      actor,
      trx,
    );

    // Nothing was created — the pair was already wired (pre-existing edge or
    // a concurrent wire; ON CONFLICT blocks on the uncommitted insert, so the
    // check is race-safe). Per FR-010 the record is SUPERSEDED, not ACCEPTED,
    // matching the tombstone shape (reason/score NULL).
    if (!created) {
      await trx
        .updateTable("edge_suggestions")
        .set({ status: "SUPERSEDED", reason: null, score: null })
        .where("id", "=", id)
        .execute();
    }

    const final = await trx
      .selectFrom("edge_suggestions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return toContract(final);
  });
}

export async function dismissSuggestion(
  id: string,
  actor: Actor,
): Promise<EdgeSuggestion> {
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom("edge_suggestions")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound("Suggestion");
    if (row.status !== "PENDING") {
      throw conflict("Suggestion is already decided");
    }

    // Permanent — there is no un-dismiss transition (ADR-113). The row is
    // locked FOR UPDATE, so this update always applies.
    const decidedAt = new Date().toISOString();
    await trx
      .updateTable("edge_suggestions")
      .set({ status: "DISMISSED", decidedAt, decidedBy: actor.id })
      .where("id", "=", id)
      .execute();
    return toContract({ ...row, status: "DISMISSED", decidedAt, decidedBy: actor.id });
  });
}

// ---------------------------------------------------------------------------
// Generation pass (research.md D2/D4) — batched in-memory signal scoring.
// ---------------------------------------------------------------------------

export type SuggestionScope =
  | { all: true }
  | { productId: string }
  | { componentIds: string[] };

export async function generateSuggestions(
  scope: SuggestionScope,
): Promise<SuggestionRescanReport> {
  const startedAt = Date.now();
  const scopeLabel =
    "all" in scope ? "all" : "productId" in scope ? "product" : "components";

  // Scoping: a {productId} pass pairs that product with every active
  // component; a {componentIds} pass pairs every active product with the
  // given components (research.md D2).
  let productsQuery = db
    .selectFrom("digital_products")
    .select(["id", "name", "slug", "tags"])
    .where("lifecycle", "!=", "RETIRED");
  if ("productId" in scope) {
    productsQuery = productsQuery.where("id", "=", scope.productId);
  }
  const products = await productsQuery.execute();

  let componentsQuery = db
    .selectFrom("components")
    .select([
      "id",
      "name",
      "slug",
      "tags",
      "details",
      "componentGroupId",
    ])
    .where("lifecycle", "!=", "RETIRED");
  if ("componentIds" in scope) {
    componentsQuery = componentsQuery.where("id", "in", scope.componentIds);
  }
  // An empty componentIds scope means nothing to score — skip the query
  // entirely rather than faking an empty result with an impossible id.
  const components =
    "componentIds" in scope && scope.componentIds.length === 0
      ? []
      : await componentsQuery.execute();

  const report: SuggestionRescanReport = {
    productsScanned: products.length,
    componentsScanned: components.length,
    staged: 0,
    superseded: 0,
  };
  if (products.length === 0 || components.length === 0) {
    return finishPass(scopeLabel, startedAt, report);
  }

  const productIds = products.map((p) => p.id);
  const componentIds = components.map((c) => c.id);

  // Coverage sources: direct component edges and group edges expanded
  // through each component's componentGroupId (ADR-110).
  const directEdges = await db
    .selectFrom("product_depends_on_component")
    .select(["productId", "componentId"])
    .where("productId", "in", productIds)
    .where("componentId", "in", componentIds)
    .execute();
  const groupEdges = await db
    .selectFrom("product_depends_on_component_group")
    .select(["productId", "componentGroupId"])
    .where("productId", "in", productIds)
    .execute();

  const groupCoverage = new Map<string, Set<string>>(); // productId → groupIds
  for (const e of groupEdges) {
    if (!e.productId || !e.componentGroupId) continue;
    let set = groupCoverage.get(e.productId);
    if (!set) groupCoverage.set(e.productId, (set = new Set()));
    set.add(e.componentGroupId);
  }
  const directCoverage = new Set(
    directEdges
      .filter((e) => e.productId && e.componentId)
      .map((e) => `${e.productId}:${e.componentId}`),
  );
  const isCovered = (productId: string, componentGroupId: string | null) =>
    componentGroupId !== null &&
    (groupCoverage.get(productId)?.has(componentGroupId) ?? false);

  // Partition candidate pairs: covered → tombstones, signal hits → staged.
  const tombstonePairs: { productId: string; componentId: string }[] = [];
  const stagedPairs: {
    productId: string;
    componentId: string;
    reason: EdgeSuggestionReason;
    score: number;
  }[] = [];
  for (const product of products) {
    for (const component of components) {
      if (
        directCoverage.has(`${product.id}:${component.id}`) ||
        isCovered(product.id, component.componentGroupId)
      ) {
        tombstonePairs.push({
          productId: product.id,
          componentId: component.id,
        });
        continue;
      }
      const hit = scorePair(product, component);
      if (hit) {
        stagedPairs.push({
          productId: product.id,
          componentId: component.id,
          reason: hit.reason,
          score: hit.score,
        });
      }
    }
  }

  const now = new Date().toISOString();
  await db.transaction().execute(async (trx) => {
    // Covered pairs → SUPERSEDED tombstones (idempotent). PENDING rows flip;
    // absent pairs get a reason/score-NULL tombstone so a later edge removal
    // can never regenerate the suggestion (ADR-113). Batched per product —
    // system coverage has no actor, so decidedBy stays NULL.
    const tombstonesByProduct = new Map<string, string[]>();
    for (const { productId, componentId } of tombstonePairs) {
      const list = tombstonesByProduct.get(productId);
      if (list) list.push(componentId);
      else tombstonesByProduct.set(productId, [componentId]);
    }
    for (const [productId, componentIds] of tombstonesByProduct) {
      const { flipped, inserted } = await supersedeSuggestionPairs(
        trx,
        productId,
        componentIds,
      );
      report.superseded += flipped + inserted;
    }

    // Signal hits → INSERT ... ON CONFLICT DO UPDATE only for PENDING rows —
    // terminal rows are never touched (research.md D4). Chunked to stay well
    // under Postgres's bind-parameter limit on large rescans.
    for (let i = 0; i < stagedPairs.length; i += 500) {
      const res = await trx
        .insertInto("edge_suggestions")
        .values(
          stagedPairs.slice(i, i + 500).map((hit) => ({
            id: uuidv7(),
            productId: hit.productId,
            componentId: hit.componentId,
            reason: hit.reason,
            score: Math.round(hit.score * 100),
            status: "PENDING",
            createdAt: now,
            decidedAt: null,
            decidedBy: null,
          })),
        )
        .onConflict((oc) =>
          oc
            .columns(["productId", "componentId"])
            .doUpdateSet((eb) => ({
              reason: eb.ref("excluded.reason"),
              score: eb.ref("excluded.score"),
            }))
            .where("edge_suggestions.status", "=", "PENDING")
            // Only rewrite when the signals actually changed — an unchanged
            // pass must report staged: 0 (idempotent rescan, quickstart).
            .where((eb) =>
              eb.or([
                eb(
                  "edge_suggestions.reason",
                  "is distinct from",
                  eb.ref("excluded.reason"),
                ),
                eb(
                  "edge_suggestions.score",
                  "is distinct from",
                  eb.ref("excluded.score"),
                ),
              ]),
            ),
        )
        .executeTakeFirst();
      report.staged += Number(res.numInsertedOrUpdatedRows ?? 0);
    }
  });

  return finishPass(scopeLabel, startedAt, report);
}

/**
 * Failure-isolated trigger wrapper (ADR-113): every catalog write that
 * re-stages candidates calls this — a suggestion bug is logged and
 * metric-counted, never thrown into the host operation.
 */
export async function runSuggestionPass(
  scope: SuggestionScope,
  context: Record<string, unknown> = {},
): Promise<SuggestionRescanReport | undefined> {
  try {
    return await generateSuggestions(scope);
  } catch (err) {
    metrics.suggestionPassErrorsTotal.inc();
    appLogger.error(
      { ...context, err },
      "edge suggestion generation failed",
    );
    return undefined;
  }
}

function finishPass(
  scopeLabel: string,
  startedAt: number,
  report: SuggestionRescanReport,
): SuggestionRescanReport {
  const durationSeconds = (Date.now() - startedAt) / 1000;
  appLogger.info(
    { scope: scopeLabel, durationSeconds, ...report },
    "edge suggestion generation pass complete",
  );
  metrics.suggestionPassesTotal.inc({ scope: scopeLabel });
  metrics.suggestionPassDurationSeconds.observe(
    { scope: scopeLabel },
    durationSeconds,
  );
  if (report.staged > 0) metrics.suggestionStagedTotal.inc(report.staged);
  if (report.superseded > 0) {
    metrics.suggestionSupersededTotal.inc(report.superseded);
  }
  return report;
}
