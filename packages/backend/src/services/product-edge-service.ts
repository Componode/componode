import {
  addComposesEdgeSchema,
  addConsumesFromEdgeSchema,
  addDependsOnEdgeSchema,
} from "@componode/core";
import { uuidv7 } from "uuidv7";
import type { Kysely, Transaction } from "kysely";
import type { DB } from "../db/types.js";
import { db } from "../db/connection.js";
import { writeEdgeChange, type Actor } from "./audit-service.js";

type DbOrTrx = Kysely<DB> | Transaction<DB>;

/**
 * ADR-113 coverage tombstones: once a (product, component) pair becomes a
 * real or group-covered DEPENDS_ON edge, it is SUPERSEDED forever — a later
 * edge removal must not regenerate the suggestion. Flips existing PENDING
 * rows (attributing the wiring actor) and inserts reason/score-NULL
 * tombstones for pairs that were never suggested. Terminal rows
 * (ACCEPTED/DISMISSED/SUPERSEDED) are never touched.
 */
export async function supersedeSuggestionPairs(
  trx: DbOrTrx,
  productId: string,
  componentIds: string[],
  actor?: Actor,
): Promise<{ flipped: number; inserted: number }> {
  if (componentIds.length === 0) return { flipped: 0, inserted: 0 };
  const now = new Date().toISOString();
  const decidedBy = actor?.id ?? null;
  const flipped = await trx
    .updateTable("edge_suggestions")
    .set({
      status: "SUPERSEDED",
      reason: null,
      score: null,
      decidedAt: now,
      decidedBy,
    })
    .where("productId", "=", productId)
    .where("componentId", "in", componentIds)
    .where("status", "=", "PENDING")
    .executeTakeFirst();
  const inserted = await trx
    .insertInto("edge_suggestions")
    .values(
      componentIds.map((componentId) => ({
        id: uuidv7(),
        productId,
        componentId,
        reason: null,
        score: null,
        status: "SUPERSEDED",
        createdAt: now,
        decidedAt: now,
        decidedBy,
      })),
    )
    .onConflict((oc) => oc.columns(["productId", "componentId"]).doNothing())
    .executeTakeFirst();
  return {
    flipped: Number(flipped.numUpdatedRows),
    inserted: Number(inserted.numInsertedOrUpdatedRows ?? 0),
  };
}

function invalidEdge(message: string, rule: string) {
  return Object.assign(new Error(message), {
    statusCode: 422,
    code: "INVALID_EDGE_TYPE",
    details: { rule },
  });
}

function notFound(entity: string) {
  return Object.assign(new Error(`${entity} not found`), {
    statusCode: 404,
    code: "NOT_FOUND",
  });
}

async function getProductType(id: string) {
  const row = await db
    .selectFrom("digital_products")
    .select(["id", "name", "type"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) throw notFound("Product");
  return row;
}

/**
 * Write-time cycle detection (ADR-049/050): reject if `parentId` is reachable
 * from `childId` via COMPOSES descendants.
 */
async function assertNoCycle(parentId: string, childId: string) {
  const reachable = await db
    .withRecursive("reach(id)", (qb) =>
      qb
        .selectFrom("product_composes")
        .select("childId as id")
        .where("parentId", "=", childId)
        .unionAll((eb) =>
          eb
            .selectFrom("product_composes")
            .innerJoin("reach", "product_composes.parentId", "reach.id")
            .select("product_composes.childId as id"),
        ),
    )
    .selectFrom("reach")
    .select("id")
    .where("id", "=", parentId)
    .executeTakeFirst();

  if (reachable) {
    throw Object.assign(
      new Error("This edge would create a cycle in the COMPOSES hierarchy"),
      { statusCode: 409, code: "CYCLE_DETECTED", details: { parentId, childId } },
    );
  }
}

export async function addComposesEdge(parentId: string, rawInput: unknown, actor: Actor) {
  const { childId } = addComposesEdgeSchema.parse(rawInput);
  // Any product type is a legal COMPOSES parent (ADR-109); guards are
  // self-edge rejection and cycle detection only.
  await getProductType(parentId); // existence check → 404
  await getProductType(childId); // existence check → 404

  if (parentId === childId) {
    throw invalidEdge("A product cannot compose itself", "SELF_EDGE");
  }
  await assertNoCycle(parentId, childId);

  await db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto("product_composes")
      .values({ parentId, childId })
      .onConflict((oc) => oc.doNothing())
      .returning("childId")
      .execute();
    if (inserted.length === 0) return;
    await writeEdgeChange(
      "COMPOSES",
      { entityType: "digital_product", entityId: parentId },
      { entityType: "digital_product", entityId: childId },
      "added",
      actor,
      null,
      trx,
    );
  });
}

export async function removeComposesEdge(parentId: string, childId: string, actor: Actor) {
  const removed = await db
    .deleteFrom("product_composes")
    .where("parentId", "=", parentId)
    .where("childId", "=", childId)
    .executeTakeFirst();
  if (!Number(removed.numDeletedRows)) throw notFound("Edge");
  await writeEdgeChange(
    "COMPOSES",
    { entityType: "digital_product", entityId: parentId },
    { entityType: "digital_product", entityId: childId },
    "removed",
    actor,
  );
}

export async function addConsumesFromEdge(consumerId: string, rawInput: unknown, actor: Actor) {
  const { platformId } = addConsumesFromEdgeSchema.parse(rawInput);
  await getProductType(consumerId); // existence check → 404
  const platform = await getProductType(platformId);

  if (platform.type !== "PLATFORM") {
    throw invalidEdge(
      "CONSUMES_FROM targets must be PLATFORM products",
      "CONSUMES_FROM_TARGET_TYPE",
    );
  }

  await db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto("product_consumes_from")
      .values({ consumerId, platformId })
      .onConflict((oc) => oc.doNothing())
      .returning("platformId")
      .execute();
    if (inserted.length === 0) return;
    await writeEdgeChange(
      "CONSUMES_FROM",
      { entityType: "digital_product", entityId: consumerId },
      { entityType: "digital_product", entityId: platformId },
      "added",
      actor,
      null,
      trx,
    );
  });
}

export async function removeConsumesFromEdge(
  consumerId: string,
  platformId: string,
  actor: Actor,
) {
  const removed = await db
    .deleteFrom("product_consumes_from")
    .where("consumerId", "=", consumerId)
    .where("platformId", "=", platformId)
    .executeTakeFirst();
  if (!Number(removed.numDeletedRows)) throw notFound("Edge");
  await writeEdgeChange(
    "CONSUMES_FROM",
    { entityType: "digital_product", entityId: consumerId },
    { entityType: "digital_product", entityId: platformId },
    "removed",
    actor,
  );
}

export async function addDependsOnEdge(
  productId: string,
  rawInput: unknown,
  actor: Actor,
  outerTrx?: DbOrTrx,
): Promise<{ created: boolean }> {
  const input = addDependsOnEdgeSchema.parse(rawInput);
  await getProductType(productId);

  const run = outerTrx
    ? async (fn: (trx: DbOrTrx) => Promise<void>) => fn(outerTrx)
    : async (fn: (trx: DbOrTrx) => Promise<void>) =>
        db.transaction().execute(fn);

  // Group target (ADR-110): the product→group edge is persisted; members
  // expand at read time, so group changes propagate automatically.
  if (input.componentGroupId) {
    const groupId = input.componentGroupId;
    const group = await db
      .selectFrom("component_groups")
      .select("id")
      .where("id", "=", groupId)
      .executeTakeFirst();
    if (!group) throw notFound("Component group");

    let created = false;
    await run(async (trx) => {
      const inserted = await trx
        .insertInto("product_depends_on_component_group")
        .values({ productId, componentGroupId: groupId })
        .onConflict((oc) => oc.doNothing())
        .returning("componentGroupId")
        .execute();
      if (inserted.length === 0) return;
      created = true;
      await writeEdgeChange(
        "DEPENDS_ON_COMPONENT",
        { entityType: "digital_product", entityId: productId },
        { entityType: "component_group", entityId: groupId },
        "added",
        actor,
        null,
        trx,
      );
      // Group coverage tombstones — one per current member (ADR-113).
      const members = await trx
        .selectFrom("components")
        .select("id")
        .where("componentGroupId", "=", groupId)
        .execute();
      await supersedeSuggestionPairs(
        trx,
        productId,
        members.map((m) => m.id),
        actor,
      );
    });
    return { created };
  }

  // Bulk form (ADR-110 §3): dedupe, verify every component exists, then
  // insert all edges and audit rows in a single transaction.
  if (input.componentIds) {
    const componentIds = [...new Set(input.componentIds)];
    const found = await db
      .selectFrom("components")
      .select("id")
      .where("id", "in", componentIds)
      .execute();
    const foundIds = new Set(found.map((r) => r.id));
    const missingIds = componentIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw Object.assign(new Error("Components not found"), {
        statusCode: 404,
        code: "NOT_FOUND",
        details: { missingIds },
      });
    }

    let created = false;
    await run(async (trx) => {
      const inserted = await trx
        .insertInto("product_depends_on_component")
        .values(componentIds.map((componentId) => ({ productId, componentId })))
        .onConflict((oc) => oc.doNothing())
        .returning("componentId")
        .execute();
      const wiredIds = inserted
        .map((r) => r.componentId)
        .filter((id): id is string => typeof id === "string");
      for (const wiredId of wiredIds) {
        await writeEdgeChange(
          "DEPENDS_ON_COMPONENT",
          { entityType: "digital_product", entityId: productId },
          { entityType: "component", entityId: wiredId },
          "added",
          actor,
          null,
          trx,
        );
      }
      created = wiredIds.length > 0;
      await supersedeSuggestionPairs(trx, productId, wiredIds, actor);
    });
    return { created };
  }

  // Unreachable under the exactly-one-of schema refine — narrow explicitly
  // rather than asserting.
  const componentId = input.componentId;
  if (!componentId) throw invalidEdge("A component target is required", "NO_TARGET");
  const component = await db
    .selectFrom("components")
    .select("id")
    .where("id", "=", componentId)
    .executeTakeFirst();
  if (!component) throw notFound("Component");

  let created = false;
  await run(async (trx) => {
    const inserted = await trx
      .insertInto("product_depends_on_component")
      .values({ productId, componentId })
      .onConflict((oc) => oc.doNothing())
      .returning("componentId")
      .execute();
    if (inserted.length === 0) return;
    created = true;
    await writeEdgeChange(
      "DEPENDS_ON_COMPONENT",
      { entityType: "digital_product", entityId: productId },
      { entityType: "component", entityId: componentId },
      "added",
      actor,
      null,
      trx,
    );
    await supersedeSuggestionPairs(trx, productId, [componentId], actor);
  });
  return { created };
}

export async function removeDependsOnEdge(
  productId: string,
  targetId: string,
  kind: "component" | "group",
  actor: Actor,
) {
  const removed =
    kind === "group"
      ? await db
          .deleteFrom("product_depends_on_component_group")
          .where("productId", "=", productId)
          .where("componentGroupId", "=", targetId)
          .executeTakeFirst()
      : await db
          .deleteFrom("product_depends_on_component")
          .where("productId", "=", productId)
          .where("componentId", "=", targetId)
          .executeTakeFirst();
  if (!Number(removed.numDeletedRows)) throw notFound("Edge");
  await writeEdgeChange(
    "DEPENDS_ON_COMPONENT",
    { entityType: "digital_product", entityId: productId },
    {
      entityType: kind === "group" ? "component_group" : "component",
      entityId: targetId,
    },
    "removed",
    actor,
  );
}
