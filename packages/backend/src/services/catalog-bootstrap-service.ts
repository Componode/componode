import YAML from "yaml";
import { uuidv7 } from "uuidv7";
import {
  bootstrapDocumentSchema,
  type BootstrapDocument,
  type BootstrapProductItem,
  type BootstrapReport,
  type BootstrapSkippedItem,
} from "@componode/core";
import { db } from "../db/connection.js";
import { logger as appLogger } from "../plugins/logging.js";
import {
  writeEntityChange,
  writeEdgeChange,
  type Actor,
} from "./audit-service.js";
import { findConsumesFromConsumers, toSlug } from "./product-service.js";
import { runSuggestionPass } from "./edge-suggestion-service.js";
import { supersedeSuggestionPairs } from "./product-edge-service.js";
import type { Link } from "@componode/core";

export const BOOTSTRAP_REASON = "catalog bootstrap import";

type EdgeKey = `${string}:${string}`;
const edgeKey = (productId: string, componentId: string): EdgeKey =>
  `${productId}:${componentId}`;

function validationFailed(details: unknown): Error {
  return Object.assign(new Error("Invalid bootstrap document"), {
    statusCode: 400,
    code: "VALIDATION_FAILED",
    details,
  });
}

/**
 * Whole-document phase (ADR-114 §2a): parse YAML text (or accept an
 * already-parsed JSON body), strict-validate, and reject duplicate derived
 * slugs. Any failure throws 400 VALIDATION_FAILED — nothing is applied.
 */
export function resolveDocument(document: unknown): BootstrapDocument {
  let parsed: unknown = document;
  if (typeof document === "string") {
    try {
      parsed = YAML.parse(document);
    } catch {
      throw validationFailed([
        { path: [], message: "Document is not valid YAML/JSON" },
      ]);
    }
  }
  const result = bootstrapDocumentSchema.safeParse(parsed);
  if (!result.success) throw validationFailed(result.error.issues);

  const seen = new Map<string, number[]>();
  result.data.products.forEach((p, i) => {
    const slug = toSlug(p.name);
    seen.set(slug, [...(seen.get(slug) ?? []), i]);
  });
  const duplicateSlugs = [...seen.entries()]
    .filter(([, idx]) => idx.length > 1)
    .map(([slug, idx]) => ({
      slug,
      items: idx.map((i) => `products.${i}`),
    }));
  if (duplicateSlugs.length) {
    throw validationFailed([
      { path: ["products"], message: "Duplicate product slugs", duplicates: duplicateSlugs },
    ]);
  }
  const emptySlugIssues = result.data.products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => toSlug(p.name) === "")
    .map(({ i }) => ({
      path: ["products", i, "name"],
      message: "name derives to an empty slug",
    }));
  if (emptySlugIssues.length) throw validationFailed(emptySlugIssues);
  return result.data;
}

/** Resolution result for a single ref string. */
type RefResolution =
  | { status: "resolved"; id: string }
  | { status: "not_found" }
  | { status: "ambiguous" };

export interface ResolvedRefs {
  /** Product slug → existing row (any lifecycle), for the upsert key. */
  existingBySlug: Map<
    string,
    {
      id: string;
      name: string;
      type: string;
      lifecycle: string;
      description: string | null;
      lobOwnerId: string | null;
      teamOwnerId: string | null;
      tags: string[];
      criticality: string | null;
      sunsetAt: string | null;
    }
  >;
  /** "productId:componentId" edges already present. */
  existingEdges: Set<EdgeKey>;
  resolveLob(ref: string): RefResolution;
  resolveTeam(ref: string): RefResolution;
  /** Component refs match slug → name → externalId (ADR-114 §2b). */
  resolveComponent(ref: string): RefResolution;
}

function toLookup(rows: { id: string; key: string | null }[]) {
  const byKey = new Map<string, string[]>();
  for (const r of rows) {
    if (r.key === null) continue;
    byKey.set(r.key, [...(byKey.get(r.key) ?? []), r.id]);
  }
  return (ref: string): RefResolution => {
    const ids = byKey.get(ref);
    if (!ids || ids.length === 0) return { status: "not_found" };
    if (ids.length > 1) return { status: "ambiguous" };
    return { status: "resolved", id: ids[0]! };
  };
}

/**
 * Batch ref resolution (research.md D3): every owner/dependency ref in the
 * document is resolved with O(1) IN-list queries before any write — LOB and
 * Team by slug; components by slug → name → externalId with ambiguity
 * detection at the first matching stage.
 */
export async function resolveRefs(
  items: BootstrapProductItem[],
): Promise<ResolvedRefs> {
  const lobRefs = new Set<string>();
  const teamRefs = new Set<string>();
  const depRefs = new Set<string>();
  const slugs = new Map<BootstrapProductItem, string>();
  for (const item of items) {
    slugs.set(item, toSlug(item.name));
    if (item.owner?.lob) lobRefs.add(item.owner.lob);
    if (item.owner?.team) teamRefs.add(item.owner.team);
    for (const ref of item.dependsOn ?? []) depRefs.add(ref);
  }

  const [lobs, teams, components, existing] = await Promise.all([
    lobRefs.size
      ? db
          .selectFrom("line_of_businesses")
          .select(["id", "slug as key"])
          .where("slug", "in", [...lobRefs])
          .execute()
      : Promise.resolve([] as { id: string; key: string }[]),
    teamRefs.size
      ? db
          .selectFrom("teams")
          .select(["id", "slug as key"])
          .where("slug", "in", [...teamRefs])
          .execute()
      : Promise.resolve([] as { id: string; key: string }[]),
    depRefs.size
      ? db
          .selectFrom("components")
          .select(["id", "slug", "name", "externalId"])
          .where((eb) =>
            eb.or([
              eb("slug", "in", [...depRefs]),
              eb("name", "in", [...depRefs]),
              eb("externalId", "in", [...depRefs]),
            ]),
          )
          .execute()
      : Promise.resolve(
          [] as { id: string; slug: string; name: string; externalId: string | null }[],
        ),
    slugs.size
      ? db
          .selectFrom("digital_products")
          .select([
            "id",
            "name",
            "type",
            "lifecycle",
            "description",
            "lobOwnerId",
            "teamOwnerId",
            "tags",
            "criticality",
            "sunsetAt",
            "slug",
          ])
          .where("slug", "in", [...new Set(slugs.values())])
          .execute()
      : Promise.resolve([] as never[]),
  ]);

  const existingBySlug = new Map(existing.map((r) => [r.slug, r]));

  const componentIds = new Set(components.map((c) => c.id));
  const existingEdges =
    existing.length && componentIds.size
      ? new Set(
          (
            await db
              .selectFrom("product_depends_on_component")
              .select(["productId", "componentId"])
              .where("productId", "in", existing.map((r) => r.id))
              .where("componentId", "in", [...componentIds])
              .execute()
          ).flatMap((e) =>
            e.productId && e.componentId
              ? [edgeKey(e.productId, e.componentId)]
              : [],
          ),
        )
      : new Set<EdgeKey>();

  const bySlug = toLookup(components.map((c) => ({ id: c.id, key: c.slug })));
  const byName = toLookup(components.map((c) => ({ id: c.id, key: c.name })));
  const byExternalId = toLookup(
    components.map((c) => ({ id: c.id, key: c.externalId })),
  );

  return {
    existingBySlug,
    existingEdges,
    resolveLob: toLookup(lobs),
    resolveTeam: toLookup(teams),
    resolveComponent: (ref: string): RefResolution => {
      for (const lookup of [bySlug, byName, byExternalId]) {
        const hit = lookup(ref);
        if (hit.status !== "not_found") return hit;
      }
      return { status: "not_found" };
    },
  };
}

interface ItemPlan {
  /** products.<i> (name) — used in skipped entries. */
  label: string;
  slug: string;
  /** Whole-item failure (e.g. TYPE_CHANGE_BLOCKED) — no writes for this item. */
  skipReason: string | null;
  /** Ref-level skips recorded regardless of outcome. */
  skipped: BootstrapSkippedItem[];
  /** Resolved owner column values; undefined = field absent → preserve. */
  lobOwnerId: string | null | undefined;
  teamOwnerId: string | null | undefined;
  /** Existing product id when the item updates a row. */
  existingId: string | null;
  /** Fields that actually differ — empty means no product write. */
  updates: Record<string, unknown> | null;
  /** Whether `updates` contains any field — drives update vs no-op counting. */
  hasChanges: boolean;
  /** Component ids of edges that are not already wired. */
  edgeComponentIds: string[];
}

function normalizeDate(v: string | Date | null): string | null {
  return v === null ? null : new Date(v).toISOString();
}

function sameTags(a: string[], b: string[]) {
  const sorted = [...b].sort();
  return a.length === b.length && [...a].sort().every((t, i) => t === sorted[i]);
}

/**
 * Plan one item (ADR-114 §2c): resolve owner/dep refs (failures → skipped,
 * never fabricated), then diff against the existing row — omitted fields are
 * preserved, present fields applied, `null`/`[]` clears. Field-equal items
 * plan as a no-op: no write, no audit row.
 */
function planItem(
  item: BootstrapProductItem,
  index: number,
  refs: ResolvedRefs,
  consumersByPlatform: Map<string, { id: string; name: string }[]>,
): ItemPlan {
  const label = `products.${index} (${item.name})`;
  const slug = toSlug(item.name);
  const existing = refs.existingBySlug.get(slug);
  const skipped: BootstrapSkippedItem[] = [];

  const resolveOwner = (
    kind: "lob" | "team",
    lookup: (ref: string) => RefResolution,
  ): string | null | undefined => {
    const ref = item.owner?.[kind];
    if (ref === undefined) return undefined;
    if (ref === null) return null;
    const hit = lookup(ref);
    if (hit.status === "resolved") return hit.id;
    skipped.push({
      item: label,
      reason: `owner ${kind === "lob" ? "LOB" : "Team"} "${ref}" ${hit.status === "ambiguous" ? "is ambiguous" : "not found"}`,
    });
    return undefined;
  };
  const lobOwnerId = resolveOwner("lob", refs.resolveLob);
  const teamOwnerId = resolveOwner("team", refs.resolveTeam);

  const edgeComponentIds: string[] = [];
  const seenComponents = new Set<string>();
  for (const ref of item.dependsOn ?? []) {
    const hit = refs.resolveComponent(ref);
    if (hit.status !== "resolved") {
      skipped.push({
        item: label,
        reason: `component "${ref}" ${hit.status === "ambiguous" ? "is ambiguous" : "not found"}`,
      });
      continue;
    }
    if (seenComponents.has(hit.id)) continue;
    seenComponents.add(hit.id);
    if (existing && refs.existingEdges.has(edgeKey(existing.id, hit.id))) continue;
    edgeComponentIds.push(hit.id);
  }

  if (!existing) {
    return {
      label,
      slug,
      skipReason: null,
      skipped,
      lobOwnerId,
      teamOwnerId,
      existingId: null,
      updates: null,
      hasChanges: false,
      edgeComponentIds,
    };
  }

  // Same guard as updateProduct (findConsumesFromConsumers): retyping to
  // non-PLATFORM is blocked when the product is a CONSUMES_FROM target.
  if (item.type !== existing.type && item.type !== "PLATFORM") {
    const consumers = consumersByPlatform.get(existing.id) ?? [];
    if (consumers.length) {
      return {
        label,
        slug,
        skipReason: `type change to ${item.type} would invalidate CONSUMES_FROM consumers: ${consumers
          .map((c) => c.name)
          .join(", ")}`,
        skipped,
        lobOwnerId,
        teamOwnerId,
        existingId: existing.id,
        updates: null,
        hasChanges: false,
        edgeComponentIds,
      };
    }
  }

  const updates: Record<string, unknown> = {};
  if (item.name !== existing.name) updates.name = item.name;
  if (item.type !== existing.type) updates.type = item.type;
  if (item.description !== undefined && item.description !== existing.description)
    updates.description = item.description;
  if (lobOwnerId !== undefined && lobOwnerId !== existing.lobOwnerId)
    updates.lobOwnerId = lobOwnerId;
  if (teamOwnerId !== undefined && teamOwnerId !== existing.teamOwnerId)
    updates.teamOwnerId = teamOwnerId;
  if (item.tags !== undefined && !sameTags(item.tags, existing.tags))
    updates.tags = item.tags;
  if (item.criticality !== undefined && item.criticality !== existing.criticality)
    updates.criticality = item.criticality;
  if (
    item.sunsetAt !== undefined &&
    normalizeDate(item.sunsetAt) !== normalizeDate(existing.sunsetAt)
  )
    updates.sunsetAt = item.sunsetAt;

  return {
    label,
    slug,
    skipReason: null,
    skipped,
    lobOwnerId,
    teamOwnerId,
    existingId: existing.id,
    updates,
    hasChanges: Object.keys(updates).length > 0,
    edgeComponentIds,
  };
}

/**
 * Commit one planned item: product insert/update + edge inserts + audit rows
 * in a single transaction, so a failed item never leaves a half-applied
 * product (ADR-114 per-item atomicity).
 */
async function applyItem(
  plan: ItemPlan,
  item: BootstrapProductItem,
  actor: Actor,
): Promise<{ outcome: "created" | "updated" | "unchanged"; edgesAdded: number }> {
  const now = new Date().toISOString();
  return db.transaction().execute(async (trx) => {
    let productId = plan.existingId;
    let outcome: "created" | "updated" | "unchanged" = "unchanged";
    let edgesAdded = 0;

    if (!productId) {
      productId = uuidv7();
      await trx
        .insertInto("digital_products")
        .values({
          id: productId,
          name: item.name,
          slug: plan.slug,
          description: item.description ?? null,
          type: item.type,
          lifecycle: "ACTIVE",
          lobOwnerId: plan.lobOwnerId ?? null,
          teamOwnerId: plan.teamOwnerId ?? null,
          links: JSON.stringify([]) as unknown as Link[],
          tags: item.tags ?? [],
          criticality: item.criticality ?? null,
          sunsetAt: item.sunsetAt ?? null,
          createdBy: actor.id,
          updatedBy: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      await writeEntityChange(
        {
          entityType: "digital_product",
          entityId: productId,
          action: "created",
          changes: { ...item, slug: plan.slug },
          actor,
        },
        trx,
      );
      outcome = "created";
    } else if (plan.hasChanges) {
      await trx
        .updateTable("digital_products")
        .set({ ...plan.updates, updatedBy: actor.id, updatedAt: now } as never)
        .where("id", "=", productId)
        .execute();
      await writeEntityChange(
        {
          entityType: "digital_product",
          entityId: productId,
          action: "updated",
          changes: plan.updates,
          actor,
        },
        trx,
      );
      outcome = "updated";
    }

    const wiredIds: string[] = [];
    for (const componentId of plan.edgeComponentIds) {
      const inserted = await trx
        .insertInto("product_depends_on_component")
        .values({ productId, componentId })
        .onConflict((oc) => oc.doNothing())
        .returning("componentId")
        .executeTakeFirst();
      // onConflict no-op means the edge already exists — no audit row.
      if (!inserted) continue;
      edgesAdded++;
      wiredIds.push(componentId);
      await writeEdgeChange(
        "DEPENDS_ON_COMPONENT",
        { entityType: "digital_product", entityId: productId },
        { entityType: "component", entityId: componentId },
        "added",
        actor,
        BOOTSTRAP_REASON,
        trx,
      );
    }
    // ADR-113: bootstrap edges bypass addDependsOnEdge — tombstone the wired
    // pairs inline so decidedBy records the wiring actor, not NULL.
    if (productId) {
      await supersedeSuggestionPairs(trx, productId, wiredIds, actor);
    }
    return { outcome, edgesAdded };
  });
}

/**
 * ADR-114 apply: strict document phase, then per-item atomic upsert + edge
 * wiring returning the BootstrapReport. `dryRun` performs identical
 * validation and resolution with zero writes.
 */
export async function bootstrapCatalog(
  document: unknown,
  opts: { dryRun: boolean },
  actor: Actor,
): Promise<BootstrapReport> {
  const doc = resolveDocument(document);
  const refs = await resolveRefs(doc.products);
  // One IN query for every type-flip check the planner will need — retyping
  // to non-PLATFORM is blocked when the product is a CONSUMES_FROM target.
  const typeFlipIds = new Set<string>();
  for (const item of doc.products) {
    const existing = refs.existingBySlug.get(toSlug(item.name));
    if (existing && item.type !== existing.type && item.type !== "PLATFORM") {
      typeFlipIds.add(existing.id);
    }
  }
  const consumersByPlatform = await findConsumesFromConsumers([...typeFlipIds]);
  const report: BootstrapReport = {
    created: 0,
    updated: 0,
    edgesAdded: 0,
    skipped: [],
  };

  for (const [index, item] of doc.products.entries()) {
    const plan = planItem(item, index, refs, consumersByPlatform);
    report.skipped.push(...plan.skipped);
    if (plan.skipReason) {
      report.skipped.push({ item: plan.label, reason: plan.skipReason });
      continue;
    }
    if (!opts.dryRun) {
      try {
        const { outcome, edgesAdded } = await applyItem(plan, item, actor);
        if (outcome === "created") report.created++;
        else if (outcome === "updated") report.updated++;
        report.edgesAdded += edgesAdded;
      } catch (err) {
        // ADR-096: never echo internals into the client-facing report.
        appLogger.warn({ err, item: plan.label }, "catalog bootstrap item failed");
        report.skipped.push({ item: plan.label, reason: "failed to apply item" });
        continue;
      }
    } else {
      // Dry-run counts mirror the real apply: a create for absent slugs,
      // an update only when fields actually differ.
      if (!plan.existingId) report.created++;
      else if (plan.hasChanges) report.updated++;
      report.edgesAdded += plan.edgeComponentIds.length;
    }
  }

  // ADR-113: a post-apply pass tombstones pairs this document wired (they
  // bypassed addDependsOnEdge) and stages candidates for created/renamed
  // products — failure-isolated so a suggestion bug can't fail a bootstrap.
  if (!opts.dryRun && report.created + report.updated + report.edgesAdded > 0) {
    await runSuggestionPass({ all: true }, { source: "catalog-bootstrap" });
  }
  return report;
}
