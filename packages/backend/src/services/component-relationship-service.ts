import type {
  ComponentInstance,
  ComponentLifecycle,
  ComponentProductDependent,
  ComponentRelationKind,
  ComponentRelationships,
  GroupMediatedDependent,
  ProductType,
  RelatedComponent,
} from "@componode/core";
import { db } from "../db/connection.js";
import { logger as appLogger } from "../plugins/logging.js";
import { readRelationFamily } from "./product-service.js";

/**
 * Spec 060 / ADR-128 — read-only one-hop Component relationship read.
 * Every lane reads stored typed junction rows; nothing is inferred, and a
 * failed relation group degrades into `unavailableKinds` instead of failing
 * the whole read.
 */

const RELATED_COMPONENT_SELECT = [
  "components.id",
  "components.name",
  "components.slug",
  "components.category",
  "components.provider",
  "components.resourceType",
  "components.lifecycle",
] as const;

const PRODUCT_DEPENDENT_SELECT = [
  "digital_products.id",
  "digital_products.name",
  "digital_products.slug",
  "digital_products.type",
  "digital_products.lifecycle",
] as const;

export async function getComponentRelationships(
  componentId: string,
  options: { includeGone?: boolean } = {},
): Promise<ComponentRelationships | null> {
  const component = await db
    .selectFrom("components")
    .select([...RELATED_COMPONENT_SELECT, "components.componentGroupId"])
    .where("components.id", "=", componentId)
    .$castTo<RelatedComponent & { componentGroupId: string | null }>()
    .executeTakeFirst();

  if (!component) return null;

  const unavailableKinds: ComponentRelationKind[] = [];
  const family = <T>(key: ComponentRelationKind, p: Promise<T[]>) =>
    readRelationFamily(key, p, unavailableKinds);

  // Outgoing lanes join the junction's target side; inbound lanes join the
  // source side. Direction stays explicit per ADR-016/ADR-048.
  const dependsOn = family(
    "dependsOn",
    db
      .selectFrom("component_depends_on_component")
      .innerJoin("components", "components.id", "component_depends_on_component.childId")
      .select(RELATED_COMPONENT_SELECT)
      .where("component_depends_on_component.parentId", "=", componentId)
      .orderBy("components.name")
      .$castTo<RelatedComponent>()
      .execute(),
  );

  const dependedOnBy = family(
    "dependedOnBy",
    db
      .selectFrom("component_depends_on_component")
      .innerJoin("components", "components.id", "component_depends_on_component.parentId")
      .select(RELATED_COMPONENT_SELECT)
      .where("component_depends_on_component.childId", "=", componentId)
      .orderBy("components.name")
      .$castTo<RelatedComponent>()
      .execute(),
  );

  const sourcesFrom = family(
    "sourcesFrom",
    db
      .selectFrom("component_sources_from")
      .innerJoin("components", "components.id", "component_sources_from.repositoryId")
      .select(RELATED_COMPONENT_SELECT)
      .where("component_sources_from.serviceId", "=", componentId)
      .orderBy("components.name")
      .$castTo<RelatedComponent>()
      .execute(),
  );

  const sourcedBy = family(
    "sourcedBy",
    db
      .selectFrom("component_sources_from")
      .innerJoin("components", "components.id", "component_sources_from.serviceId")
      .select(RELATED_COMPONENT_SELECT)
      .where("component_sources_from.repositoryId", "=", componentId)
      .orderBy("components.name")
      .$castTo<RelatedComponent>()
      .execute(),
  );

  const exposes = family(
    "exposes",
    db
      .selectFrom("component_exposes")
      .innerJoin("components", "components.id", "component_exposes.apiId")
      .select(RELATED_COMPONENT_SELECT)
      .where("component_exposes.serviceId", "=", componentId)
      .orderBy("components.name")
      .$castTo<RelatedComponent>()
      .execute(),
  );

  const exposedBy = family(
    "exposedBy",
    db
      .selectFrom("component_exposes")
      .innerJoin("components", "components.id", "component_exposes.serviceId")
      .select(RELATED_COMPONENT_SELECT)
      .where("component_exposes.apiId", "=", componentId)
      .orderBy("components.name")
      .$castTo<RelatedComponent>()
      .execute(),
  );

  const directDependents = db
    .selectFrom("product_depends_on_component")
    .innerJoin(
      "digital_products",
      "product_depends_on_component.productId",
      "digital_products.id",
    )
    .select(PRODUCT_DEPENDENT_SELECT)
    .where("product_depends_on_component.componentId", "=", componentId)
    .where("digital_products.lifecycle", "!=", "RETIRED")
    .orderBy("digital_products.name")
    .$castTo<ComponentProductDependent>()
    .execute();

  // Group-mediated reach: only through the focused component's own group —
  // empty groups and unrelated groups never surface (spec 060 US2).
  const viaGroupDependents: Promise<GroupMediatedDependent[]> =
    component.componentGroupId === null
      ? Promise.resolve([])
      : db
          .selectFrom("product_depends_on_component_group")
          .innerJoin(
            "digital_products",
            "product_depends_on_component_group.productId",
            "digital_products.id",
          )
          .innerJoin(
            "component_groups",
            "product_depends_on_component_group.componentGroupId",
            "component_groups.id",
          )
          .select([
            ...PRODUCT_DEPENDENT_SELECT,
            "component_groups.id as viaGroupId",
            "component_groups.name as viaGroupName",
            "component_groups.slug as viaGroupSlug",
            "component_groups.lifecycle as viaGroupLifecycle",
          ])
          .where(
            "product_depends_on_component_group.componentGroupId",
            "=",
            component.componentGroupId,
          )
          .where("digital_products.lifecycle", "!=", "RETIRED")
          .orderBy("digital_products.name")
          .execute()
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              name: r.name,
              slug: r.slug,
              type: r.type as ProductType,
              lifecycle: r.lifecycle as ComponentLifecycle,
              viaGroup: {
                id: r.viaGroupId,
                name: r.viaGroupName,
                slug: r.viaGroupSlug,
                lifecycle: r.viaGroupLifecycle as ComponentLifecycle,
              },
            })),
          );

  // One family covers both provenance paths: a failure degrades the pair.
  const productDependents = (async () => {
    try {
      const [direct, viaGroups] = await Promise.all([
        directDependents,
        viaGroupDependents,
      ]);
      return { direct, viaGroups };
    } catch (err) {
      unavailableKinds.push("productDependents");
      appLogger.warn(
        { err, family: "productDependents" },
        "relation family read degraded",
      );
      return { direct: [] as ComponentProductDependent[], viaGroups: [] as GroupMediatedDependent[] };
    }
  })();

  const instances = family(
    "instances",
    db
      .selectFrom("component_instances")
      .selectAll()
      .where("componentId", "=", componentId)
      .$if(!options.includeGone, (qb) => qb.where("status", "!=", "GONE"))
      .orderBy("environment")
      .$castTo<ComponentInstance>()
      .execute(),
  );

  const [
    dependsOnRows,
    dependedOnByRows,
    sourcesFromRows,
    sourcedByRows,
    exposesRows,
    exposedByRows,
    dependents,
    instanceRows,
  ] = await Promise.all([

    dependsOn,
    dependedOnBy,
    sourcesFrom,
    sourcedBy,
    exposes,
    exposedBy,
    productDependents,
    instances,
  ]);
  const { direct, viaGroups } = dependents;

  const focused: RelatedComponent = {
    id: component.id,
    name: component.name,
    slug: component.slug,
    category: component.category,
    provider: component.provider,
    resourceType: component.resourceType,
    lifecycle: component.lifecycle,
  };

  return {
    component: focused,
    relationships: {
      dependsOn: dependsOnRows,
      dependedOnBy: dependedOnByRows,
      sourcesFrom: sourcesFromRows,
      sourcedBy: sourcedByRows,
      exposes: exposesRows,
      exposedBy: exposedByRows,
      productDependents: { direct, viaGroups },
      instances: instanceRows,
    },
    unavailableKinds,
  };
}
