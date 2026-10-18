import {
  computeProductHealth,
  type ComponentLifecycle,
  type Environment,
  type InstanceStatus,
  type ProductHealth,
} from "@componode/core";
import { db } from "../db/connection.js";

/**
 * Batch-compute derived product health (ADR-112) for a set of products.
 *
 * Sources are each product's own DEPENDS_ON edges only — direct
 * `product_depends_on_component` plus `product_depends_on_component_group`
 * expanded to current members (ADR-110). COMPOSES-inherited and
 * CONSUMES_FROM components never contribute (spec 019, FR-012).
 *
 * Constant query count (4) regardless of product count — used by product
 * detail, product list, and the dashboard attention feed.
 */
export async function computeHealthForProducts(
  productIds: string[],
): Promise<Map<string, ProductHealth>> {
  const result = new Map<string, ProductHealth>();
  const uniqueIds = [...new Set(productIds)];
  if (uniqueIds.length === 0) return result;

  const [direct, grouped] = await Promise.all([
    db
      .selectFrom("product_depends_on_component")
      .select(["productId", "componentId"])
      .where("productId", "in", uniqueIds)
      .execute(),
    db
      .selectFrom("product_depends_on_component_group")
      .innerJoin(
        "components",
        "components.componentGroupId",
        "product_depends_on_component_group.componentGroupId",
      )
      .select([
        "product_depends_on_component_group.productId",
        "components.id as componentId",
      ])
      .where(
        "product_depends_on_component_group.productId",
        "in",
        uniqueIds,
      )
      .execute(),
  ]);

  const sourcesByProduct = new Map<string, Set<string>>();
  const componentIds = new Set<string>();
  for (const row of [...direct, ...grouped]) {
    const productId = row.productId!;
    let set = sourcesByProduct.get(productId);
    if (!set) sourcesByProduct.set(productId, (set = new Set()));
    set.add(row.componentId!);
    componentIds.add(row.componentId!);
  }
  if (componentIds.size === 0) return result;

  const idList = [...componentIds];
  const [lifecycleRows, instanceRows] = await Promise.all([
    db
      .selectFrom("components")
      .select(["id", "lifecycle"])
      .where("id", "in", idList)
      .execute(),
    db
      .selectFrom("component_instances")
      .select(["componentId", "environment", "status"])
      .where("componentId", "in", idList)
      .execute(),
  ]);

  const componentLifecycle: Record<string, ComponentLifecycle> =
    Object.fromEntries(
      lifecycleRows.map((r) => [r.id, r.lifecycle as ComponentLifecycle]),
    );
  const instancesByComponent = new Map<string, typeof instanceRows>();
  for (const i of instanceRows) {
    let arr = instancesByComponent.get(i.componentId);
    if (!arr) instancesByComponent.set(i.componentId, (arr = []));
    arr.push(i);
  }

  for (const [productId, sources] of sourcesByProduct) {
    const health = computeProductHealth({
      instances: [...sources].flatMap((cid) =>
        (instancesByComponent.get(cid) ?? []).map((i) => ({
          componentId: i.componentId,
          environment: i.environment as Environment,
          status: i.status as InstanceStatus,
        })),
      ),
      componentLifecycle,
    });
    if (health) result.set(productId, health);
  }
  return result;
}
