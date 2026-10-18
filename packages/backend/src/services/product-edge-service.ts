import {
  addComposesEdgeSchema,
  addConsumesFromEdgeSchema,
  addDependsOnEdgeSchema,
} from "@componode/core";
import { db } from "../db/connection.js";
import { writeEdgeChange, type Actor } from "./audit-service.js";

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
    await trx
      .insertInto("product_composes")
      .values({ parentId, childId })
      .onConflict((oc) => oc.doNothing())
      .execute();
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
    await trx
      .insertInto("product_consumes_from")
      .values({ consumerId, platformId })
      .onConflict((oc) => oc.doNothing())
      .execute();
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

export async function addDependsOnEdge(productId: string, rawInput: unknown, actor: Actor) {
  const { componentId } = addDependsOnEdgeSchema.parse(rawInput);
  await getProductType(productId);
  const component = await db
    .selectFrom("components")
    .select("id")
    .where("id", "=", componentId)
    .executeTakeFirst();
  if (!component) throw notFound("Component");

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("product_depends_on_component")
      .values({ productId, componentId })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await writeEdgeChange(
      "DEPENDS_ON_COMPONENT",
      { entityType: "digital_product", entityId: productId },
      { entityType: "component", entityId: componentId },
      "added",
      actor,
      null,
      trx,
    );
  });
}

export async function removeDependsOnEdge(
  productId: string,
  componentId: string,
  actor: Actor,
) {
  const removed = await db
    .deleteFrom("product_depends_on_component")
    .where("productId", "=", productId)
    .where("componentId", "=", componentId)
    .executeTakeFirst();
  if (!Number(removed.numDeletedRows)) throw notFound("Edge");
  await writeEdgeChange(
    "DEPENDS_ON_COMPONENT",
    { entityType: "digital_product", entityId: productId },
    { entityType: "component", entityId: componentId },
    "removed",
    actor,
  );
}
