import { db } from "../db/connection.js";
import type { DepSource } from "@componode/core";

/**
 * Spec 080 extraction — the product's reachable component set, shared
 * between `getProductDetail` (Components tab) and the product package
 * roll-up. Moved verbatim from `product-service.ts` so both reads compute
 * reachability the same way: a product's own direct + group-expanded
 * DEPENDS_ON edges plus every COMPOSES descendant's, deduplicated, with
 * per-source attribution (DepSource: DIRECT / GROUP / INHERITED).
 */
export interface ScopedComponent {
  id: string;
  name: string;
  slug: string;
  category: string;
  lifecycle: string;
  sources: DepSource[];
}

/**
 * `productComponentScope(productId)` → `Map<componentId, ScopedComponent>`.
 * Components reachable through several paths keep every DepSource; a
 * component only reachable through COMPOSES descendants carries only
 * INHERITED sources. Group edges expand to current members at read time
 * (ADR-110 §2).
 */
export async function productComponentScope(
  productId: string,
): Promise<Map<string, ScopedComponent>> {
  // Descendant products reachable via COMPOSES (inherited dependency scope).
  const descendants = await db
    .withRecursive("descendants(id)", (qb) =>
      qb
        .selectFrom("product_composes")
        .select("childId as id")
        .where("parentId", "=", productId)
        .unionAll((eb) =>
          eb
            .selectFrom("product_composes")
            .innerJoin("descendants", "product_composes.parentId", "descendants.id")
            .select("product_composes.childId as id"),
        ),
    )
    .selectFrom("descendants")
    .select("id")
    .execute();

  const allProductIds = [productId, ...descendants.map((d) => d.id)];

  const depRows = await db
    .selectFrom("product_depends_on_component")
    .innerJoin(
      "components",
      "product_depends_on_component.componentId",
      "components.id",
    )
    .innerJoin(
      "digital_products",
      "product_depends_on_component.productId",
      "digital_products.id",
    )
    .select([
      "components.id",
      "components.name",
      "components.slug",
      "components.category",
      "components.lifecycle",
      "digital_products.id as viaId",
      "digital_products.name as viaName",
      "digital_products.slug as viaSlug",
    ])
    .where("product_depends_on_component.productId", "in", allProductIds)
    .execute();

  // Group edges expand to current members at read time (ADR-110 §2).
  const groupDepRows = await db
    .selectFrom("product_depends_on_component_group")
    .innerJoin(
      "component_groups",
      "product_depends_on_component_group.componentGroupId",
      "component_groups.id",
    )
    .innerJoin(
      "component_group_members",
      "component_group_members.groupId",
      "component_groups.id",
    )
    .innerJoin(
      "components",
      "components.id",
      "component_group_members.componentId",
    )
    .innerJoin(
      "digital_products",
      "product_depends_on_component_group.productId",
      "digital_products.id",
    )
    .select([
      "components.id",
      "components.name",
      "components.slug",
      "components.category",
      "components.lifecycle",
      "component_groups.id as groupId",
      "component_groups.name as groupName",
      "component_groups.slug as groupSlug",
      "digital_products.id as viaId",
      "digital_products.name as viaName",
      "digital_products.slug as viaSlug",
    ])
    .where("product_depends_on_component_group.productId", "in", allProductIds)
    .execute();

  const depMap = new Map<string, ScopedComponent>();

  const sourceKey = (s: DepSource) =>
    s.kind === "DIRECT"
      ? "DIRECT"
      : s.kind === "GROUP"
        ? `GROUP:${s.group.id}`
        : `INHERITED:${s.product.id}`;

  function addDep(
    c: { id: string; name: string; slug: string; category: string; lifecycle: string },
    source: DepSource,
  ) {
    const entry =
      depMap.get(c.id) ??
      depMap
        .set(c.id, { ...c, sources: [] })
        .get(c.id)!;
    const key = sourceKey(source);
    if (!entry.sources.some((s) => sourceKey(s) === key)) {
      entry.sources.push(source);
    }
  }

  for (const r of depRows) {
    addDep(
      r,
      r.viaId === productId
        ? { kind: "DIRECT" }
        : {
            kind: "INHERITED",
            product: { id: r.viaId, name: r.viaName, slug: r.viaSlug },
          },
    );
  }
  for (const r of groupDepRows) {
    addDep(
      r,
      r.viaId === productId
        ? {
            kind: "GROUP",
            group: { id: r.groupId, name: r.groupName, slug: r.groupSlug },
          }
        : {
            kind: "INHERITED",
            product: { id: r.viaId, name: r.viaName, slug: r.viaSlug },
          },
    );
  }

  return depMap;
}
