import type { Kysely, Transaction } from "kysely";
import { uuidv7 } from "uuidv7";
import { db } from "../db/connection.js";
import type { DB } from "../db/types.js";
import {
  normalizePurlIdentity,
  packageSlugToken,
  type BomSuggestionReason,
} from "@componode/core";
import { slugify, generateUniqueSlug } from "../utils/slug.js";
import type { Actor } from "./audit-service.js";

/**
 * Spec 075 / ADR-132 — shared write primitives for
 * `bom_component_suggestions`, used by the curation endpoints, the
 * matching pass, and the dependency queue service. Lifecycle is ADR-113
 * parity with `edge_suggestions`: PENDING is the only live state,
 * terminal rows are never resurrected, SUPERSEDED tombstones carry NULL
 * reason/score.
 */

type DbOrTrx = Kysely<DB> | Transaction<DB>;

export interface BomSuggestionPair {
  bomEntryId: string;
  parentComponentId: string;
  childComponentId: string;
  reason: BomSuggestionReason;
  /** 0..1 confidence — persisted as centi-score (score×100), edge-queue convention. */
  score: number;
}

export interface BomCoveredPair {
  parentComponentId: string;
  childComponentId: string;
  /** Representative entry for tombstone inserts (nullable provenance —
      migration 037 SET NULLs it on BOM-entry pruning). */
  bomEntryId: string;
}

const now = () => new Date().toISOString();

/**
 * Stage PENDING suggestion rows for candidate pairs. Idempotent: the
 * ON CONFLICT clause refreshes reason/score only where the row is still
 * PENDING *and* the signals actually changed — decided pairs never
 * resurrect, unchanged rescans report 0. Chunked to stay under the
 * Postgres bind-parameter limit.
 */
export async function stageBomSuggestions(
  pairs: BomSuggestionPair[],
  trx: DbOrTrx = db,
): Promise<number> {
  if (pairs.length === 0) return 0;
  const stamped = now();
  // One value per (parent,child) per batch — a single INSERT..ON CONFLICT
  // can't touch the same row twice, and callers emit one pair per entry
  // (several entries share a pair).
  const unique = [...new Map(pairs.map((p) => [
    `${p.parentComponentId}|${p.childComponentId}`,
    p,
  ])).values()];
  let staged = 0;
  for (let i = 0; i < unique.length; i += 500) {
    const res = await trx
      .insertInto("bom_component_suggestions")
      .values(
        unique.slice(i, i + 500).map((hit) => ({
          id: uuidv7(),
          bomEntryId: hit.bomEntryId,
          parentComponentId: hit.parentComponentId,
          childComponentId: hit.childComponentId,
          reason: hit.reason,
          score: Math.round(hit.score * 100),
          status: "PENDING",
          createdAt: stamped,
          decidedAt: null,
          decidedBy: null,
        })),
      )
      .onConflict((oc) =>
        oc
          .columns(["parentComponentId", "childComponentId"])
          .doUpdateSet((eb) => ({
            reason: eb.ref("excluded.reason"),
            score: eb.ref("excluded.score"),
            // Heal a NULL representative (BOM pruning SET NULL'd it) —
            // PENDING rows get their provenance back on re-stage (T085).
            bomEntryId: eb.fn.coalesce(
              "bom_component_suggestions.bomEntryId",
              eb.ref("excluded.bomEntryId"),
            ),
          }))
          .where("bom_component_suggestions.status", "=", "PENDING")
          .where((eb) =>
            eb.or([
              eb("bom_component_suggestions.bomEntryId", "is", null),
              eb(
                "bom_component_suggestions.reason",
                "is distinct from",
                eb.ref("excluded.reason"),
              ),
              eb(
                "bom_component_suggestions.score",
                "is distinct from",
                eb.ref("excluded.score"),
              ),
            ]),
          ),
      )
      .executeTakeFirst();
    staged += Number(res.numInsertedOrUpdatedRows ?? 0);
  }
  return staged;
}

/**
 * ADR-113 coverage tombstones for dependency pairs: once a pair is wired
 * (accept, link-all, or a match-pass edge check), it is SUPERSEDED
 * forever. Flips existing PENDING rows and inserts reason/score-NULL
 * tombstones for pairs that were never suggested — each caller supplies
 * the representative `bomEntryId` (nullable provenance — SET NULL on
 * BOM-entry pruning, migration 037).
 */
export async function supersedeBomPairs(
  trx: DbOrTrx,
  pairs: BomCoveredPair[],
  actor?: Actor,
): Promise<{ flipped: number; inserted: number }> {
  if (pairs.length === 0) return { flipped: 0, inserted: 0 };
  const stamped = now();
  const decidedBy = actor?.id ?? null;
  let flipped = 0;
  let inserted = 0;
  for (let i = 0; i < pairs.length; i += 500) {
    const chunk = pairs.slice(i, i + 500);
    const flip = await trx
      .updateTable("bom_component_suggestions")
      .set({
        status: "SUPERSEDED",
        reason: null,
        score: null,
        decidedAt: stamped,
        decidedBy,
      })
      .where("status", "=", "PENDING")
      .where((eb) =>
        eb.or(
          chunk.map((p) =>
            eb.and([
              eb("parentComponentId", "=", p.parentComponentId),
              eb("childComponentId", "=", p.childComponentId),
            ]),
          ),
        ),
      )
      .executeTakeFirst();
    flipped += Number(flip.numUpdatedRows);

    const ins = await trx
      .insertInto("bom_component_suggestions")
      .values(
        chunk.map((p) => ({
          id: uuidv7(),
          bomEntryId: p.bomEntryId,
          parentComponentId: p.parentComponentId,
          childComponentId: p.childComponentId,
          reason: null,
          score: null,
          status: "SUPERSEDED",
          createdAt: stamped,
          decidedAt: stamped,
          decidedBy,
        })),
      )
      .onConflict((oc) =>
        oc.columns(["parentComponentId", "childComponentId"]).doNothing(),
      )
      .executeTakeFirst();
    inserted += Number(ins.numInsertedOrUpdatedRows ?? 0);
  }
  return { flipped, inserted };
}

/**
 * Human accept: PENDING rows land ACCEPTED with `decidedAt`/`decidedBy`.
 * Terminal rows are untouched — callers treat a 0-count id as skipped,
 * not failed (queue parity). Returns the ids that flipped.
 */
export async function acceptBomSuggestions(
  trx: DbOrTrx,
  ids: string[],
  actor: Actor,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const stamped = now();
  const res = await trx
    .updateTable("bom_component_suggestions")
    .set({ status: "ACCEPTED", decidedAt: stamped, decidedBy: actor.id })
    .where("id", "in", ids)
    .where("status", "=", "PENDING")
    .returning("id")
    .execute();
  return res.map((r) => r.id);
}

/** PENDING ids for one consumer→library pair (read-side helper). */
export async function findPendingSuggestionId(
  trx: DbOrTrx,
  parentComponentId: string,
  childComponentId: string,
): Promise<string | null> {
  const row = await trx
    .selectFrom("bom_component_suggestions")
    .select("id")
    .where("parentComponentId", "=", parentComponentId)
    .where("childComponentId", "=", childComponentId)
    .where("status", "=", "PENDING")
    .executeTakeFirst();
  return row?.id ?? null;
}

/**
 * Package-identity → catalog component lookup (research D2). First a
 * verbatim `externalId = identity` hit (Libraries store the normalized
 * version-free purl verbatim, and manually curated components may carry
 * it too); otherwise normalizes every `pkg:`-shaped externalId candidate
 * and compares — the normalized compare catches curated components that
 * recorded a *versioned* purl or casing variant. Matching ignores
 * provider and category entirely.
 */
export async function findComponentByPackageIdentity(
  identity: string,
  trx: DbOrTrx = db,
  opts: { includeRetired?: boolean } = {},
): Promise<{
  id: string;
  slug: string;
  name: string;
  category: string;
  provider: string;
} | null> {
  const columns = ["id", "slug", "name", "category", "provider"] as const;
  let verbatimQ = trx
    .selectFrom("components")
    .select(columns)
    .where("externalId", "=", identity)
    .limit(1);
  if (!opts.includeRetired) {
    verbatimQ = verbatimQ.where("lifecycle", "!=", "RETIRED");
  }
  const verbatim = await verbatimQ.executeTakeFirst();
  if (verbatim) return verbatim;

  let candidatesQ = trx
    .selectFrom("components")
    .select([...columns, "externalId"] as const)
    .where("externalId", "ilike", "pkg:%");
  if (!opts.includeRetired) {
    candidatesQ = candidatesQ.where("lifecycle", "!=", "RETIRED");
  }
  const candidates = await candidatesQ.execute();
  for (const candidate of candidates) {
    if (
      candidate.externalId &&
      normalizePurlIdentity(candidate.externalId) === identity
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * Library slug allocator — `pkg-{type}-{name}` slugified, numeric `-N`
 * suffix on collision (ADR-046). Runs inside the caller's transaction so
 * a concurrent insert blocks on the unique index rather than racing.
 */
export async function allocateLibrarySlug(
  purlType: string,
  packageName: string,
  trx: DbOrTrx = db,
): Promise<string> {
  const base = slugify(`pkg-${slugify(purlType)}-${packageSlugToken(packageName)}`);
  return generateUniqueSlug(base || "pkg-unknown", async (slug) => {
    const row = await trx
      .selectFrom("components")
      .select("id")
      .where("slug", "=", slug)
      .executeTakeFirst();
    return row !== undefined;
  });
}
