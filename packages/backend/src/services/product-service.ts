import { sql, type SqlBool } from "kysely";
import { uuidv7 } from "uuidv7";
import {
  createProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
  type ListProductsQuery,
  type Link,
  type DepSource,
} from "@componode/core";
import { db } from "../db/connection.js";
import { writeEntityChange, writeEdgeChange, type Actor } from "./audit-service.js";
import { computeHealthForProducts } from "./product-health-service.js";
import {
  computeDependencySurfaces,
  productCompleteness,
} from "./catalog-coverage-service.js";
import { runSuggestionPass } from "./edge-suggestion-service.js";
import { tagsDiffer } from "./suggestion-signals.js";
import { supersedeSuggestionPairs } from "./product-edge-service.js";

const PRODUCT_SELECT = [
  "digital_products.id",
  "digital_products.name",
  "digital_products.slug",
  "digital_products.description",
  "digital_products.type",
  "digital_products.lifecycle",
  "digital_products.lobOwnerId",
  "digital_products.teamOwnerId",
  "digital_products.links",
  "digital_products.tags",
  "digital_products.criticality",
  "digital_products.sunsetAt",
  "line_of_businesses.name as lobOwnerName",
  "teams.name as teamOwnerName",
  "digital_products.createdAt",
  "digital_products.updatedAt",
] as const;

function productQuery() {
  return db
    .selectFrom("digital_products")
    .leftJoin(
      "line_of_businesses",
      "digital_products.lobOwnerId",
      "line_of_businesses.id",
    )
    .leftJoin("teams", "digital_products.teamOwnerId", "teams.id")
    .select(PRODUCT_SELECT);
}

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

async function assertUniqueSlug(slug: string, excludeId?: string) {
  const existing = await db
    .selectFrom("digital_products")
    .select("id")
    .where("slug", "=", slug)
    .executeTakeFirst();
  if (existing && existing.id !== excludeId) {
    throw Object.assign(new Error(`Slug "${slug}" is already in use`), {
      statusCode: 409,
      code: "SLUG_TAKEN",
    });
  }
}

/** FR-001: flat product list + COMPOSES edges; tree built client-side. */
export async function listProducts(parsed: ListProductsQuery) {

  let query = productQuery().orderBy("digital_products.name");
  if (parsed.includeRetired !== true && !parsed.lifecycle) {
    query = query.where("digital_products.lifecycle", "!=", "RETIRED");
  }
  if (parsed.lifecycle) {
    query = query.where("digital_products.lifecycle", "=", parsed.lifecycle);
  }
  if (parsed.type) {
    query = query.where("digital_products.type", "=", parsed.type);
  }
  if (parsed.tag) {
    query = query.where(
      sql<SqlBool>`digital_products.tags @> ARRAY[${parsed.tag}]::text[]`,
    );
  }
  if (parsed.criticality) {
    query = query.where("digital_products.criticality", "=", parsed.criticality);
  }
  if (parsed.q) {
    const like = `${parsed.q}%`;
    query = query.where((eb) =>
      eb.or([
        eb("digital_products.name", "ilike", like),
        eb("digital_products.slug", "ilike", like),
      ]),
    );
  }

  const products = await query.execute();

  // Spec 023: the dependency surface feeds both the `missing=dependencies`
  // facet and every row's completeness.dependencies — compute once.
  const surfaces = await computeDependencySurfaces();

  // Schema-validated + CSV-split values; a gap facet matches when the
  // corresponding completeness facet is false (shared derivation).
  const missingValues = parsed.missing ?? [];
  const rows = missingValues.length
    ? products.filter((p) =>
        missingValues.some((m) => !productCompleteness(p, surfaces)[m]),
      )
    : products;

  const ids = rows.map((p) => p.id);
  const [edges, healthByProduct, consumedByRows] = await Promise.all([
    ids.length
      ? db
          .selectFrom("product_composes")
          .select(["parentId", "childId"])
          .where("parentId", "in", ids)
          .where("childId", "in", ids)
          .execute()
      : Promise.resolve([]),
    computeHealthForProducts(ids),
    // Spec 023 US5: CONSUMES_FROM in-degree for the listed products.
    ids.length
      ? db
          .selectFrom("product_consumes_from")
          .select((eb) => [
            "platformId",
            eb.fn.count("consumerId").as("n"),
          ])
          .where("platformId", "in", ids)
          .groupBy("platformId")
          .execute()
      : Promise.resolve([]),
  ]);
  const consumedByCount = new Map(
    consumedByRows.map((r) => [r.platformId, Number(r.n)]),
  );

  return {
    products: rows.map((p) => ({
      ...p,
      status: healthByProduct.get(p.id)?.status ?? null,
      consumedByCount: consumedByCount.get(p.id) ?? 0,
      completeness: productCompleteness(p, surfaces),
    })),
    edges,
  };
}

export async function getProductById(id: string) {
  return productQuery().where("digital_products.id", "=", id).executeTakeFirst();
}

export async function getProductBySlug(slug: string) {
  return productQuery()
    .where("digital_products.slug", "=", slug)
    .executeTakeFirst();
}

const REF_SELECT = ["id", "name", "slug", "type", "lifecycle"] as const;

/** FR-003: full detail — composition edges, declared+inherited deps, instances. */
export async function getProductDetail(slug: string) {
  const product = await getProductBySlug(slug);
  if (!product) return null;

  const [composedBy, composes, consumesFrom, consumedBy, surfaces] = await Promise.all([
    db
      .selectFrom("product_composes")
      .innerJoin("digital_products", "product_composes.parentId", "digital_products.id")
      .select(REF_SELECT)
      .where("product_composes.childId", "=", product.id)
      .execute(),
    db
      .selectFrom("product_composes")
      .innerJoin("digital_products", "product_composes.childId", "digital_products.id")
      .select(REF_SELECT)
      .where("product_composes.parentId", "=", product.id)
      .execute(),
    db
      .selectFrom("product_consumes_from")
      .innerJoin("digital_products", "product_consumes_from.platformId", "digital_products.id")
      .select(REF_SELECT)
      .where("product_consumes_from.consumerId", "=", product.id)
      .execute(),
    db
      .selectFrom("product_consumes_from")
      .innerJoin("digital_products", "product_consumes_from.consumerId", "digital_products.id")
      .select(REF_SELECT)
      .where("product_consumes_from.platformId", "=", product.id)
      .execute(),
    computeDependencySurfaces(),
  ]);

  // Descendant products reachable via COMPOSES (inherited dependency scope).
  const descendants = await db
    .withRecursive("descendants(id)", (qb) =>
      qb
        .selectFrom("product_composes")
        .select("childId as id")
        .where("parentId", "=", product.id)
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

  const descendantIds = descendants.map((d) => d.id);
  const allProductIds = [product.id, ...descendantIds];

  const depRows = allProductIds.length
    ? await db
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
        .execute()
    : [];

  // Group edges expand to current members at read time (ADR-110 §2).
  const groupDepRows = allProductIds.length
    ? await db
        .selectFrom("product_depends_on_component_group")
        .innerJoin(
          "component_groups",
          "product_depends_on_component_group.componentGroupId",
          "component_groups.id",
        )
        .innerJoin(
          "components",
          "components.componentGroupId",
          "component_groups.id",
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
        .execute()
    : [];

  // Raw group edges of this product — surfaces empty groups too (spec 019).
  const dependsOnGroups = await db
    .selectFrom("product_depends_on_component_group")
    .innerJoin(
      "component_groups",
      "product_depends_on_component_group.componentGroupId",
      "component_groups.id",
    )
    .select((eb) => [
      "component_groups.id",
      "component_groups.name",
      "component_groups.slug",
      eb
        .selectFrom("components")
        .whereRef("components.componentGroupId", "=", "component_groups.id")
        .select((eb2) => eb2.fn.countAll().as("c"))
        .as("memberCount"),
    ])
    .where("product_depends_on_component_group.productId", "=", product.id)
    .execute();

  type DepEntry = {
    id: string;
    name: string;
    slug: string;
    category: string;
    lifecycle: string;
    sources: DepSource[];
  };
  const depMap = new Map<string, DepEntry>();

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
      r.viaId === product.id
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
      r.viaId === product.id
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

  // declared = reachable via the product's own edges (direct or group);
  // inherited = only reachable through COMPOSES descendants.
  const declared: DepEntry[] = [];
  const inherited: DepEntry[] = [];
  for (const entry of depMap.values()) {
    if (entry.sources.some((s) => s.kind !== "INHERITED")) {
      declared.push(entry);
    } else {
      inherited.push(entry);
    }
  }

  const componentIds = [...depMap.keys()];
  const declaredComponentIds = new Set(declared.map((c) => c.id));
  const viaByComponent = new Map<string, { id: string; name: string; slug: string }>();
  for (const entry of inherited) {
    const inheritedSource = entry.sources.find(
      (s): s is Extract<DepSource, { kind: "INHERITED" }> => s.kind === "INHERITED",
    );
    if (inheritedSource) viaByComponent.set(entry.id, inheritedSource.product);
  }

  const instanceRows = componentIds.length
    ? await db
        .selectFrom("component_instances")
        .innerJoin("components", "component_instances.componentId", "components.id")
        .select([
          "component_instances.id",
          "component_instances.componentId",
          "components.name as componentName",
          "component_instances.environment",
          "component_instances.status",
          "component_instances.region",
        ])
        .where("component_instances.componentId", "in", componentIds)
        .where("component_instances.status", "!=", "GONE")
        .execute()
    : [];

  const declaredInstances: typeof instanceRows = [];
  const inheritedInstances: Array<
    (typeof instanceRows)[number] & {
      via: { id: string; name: string; slug: string };
    }
  > = [];
  for (const inst of instanceRows) {
    if (declaredComponentIds.has(inst.componentId)) {
      declaredInstances.push(inst);
    } else {
      const via = viaByComponent.get(inst.componentId);
      if (via) inheritedInstances.push({ ...inst, via });
    }
  }

  return {
    product: {
      ...product,
      completeness: productCompleteness(product, surfaces),
    },
    composedBy,
    composes,
    consumesFrom,
    consumedBy,
    components: { declared, inherited },
    dependsOnGroups: dependsOnGroups.map((g) => ({
      ...g,
      memberCount: Number(g.memberCount),
    })),
    health: (await computeHealthForProducts([product.id])).get(product.id) ?? null,
    instances: { declared: declaredInstances, inherited: inheritedInstances },
    counts: {
      composedBy: composedBy.length,
      composes: composes.length,
      components: declared.length + inherited.length,
      instances: declaredInstances.length + inheritedInstances.length,
    },
  };
}

/** Count every edge touching a product (delete guard, FR-004). */
export async function countProductEdges(productId: string) {
  const [composesAsParent, composesAsChild, consumesAsConsumer, consumesAsPlatform, dependsOn, dependsOnGroups] =
    await Promise.all([
      db.selectFrom("product_composes").where("parentId", "=", productId).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
      db.selectFrom("product_composes").where("childId", "=", productId).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
      db.selectFrom("product_consumes_from").where("consumerId", "=", productId).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
      db.selectFrom("product_consumes_from").where("platformId", "=", productId).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
      db.selectFrom("product_depends_on_component").where("productId", "=", productId).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
      db.selectFrom("product_depends_on_component_group").where("productId", "=", productId).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
    ]);
  return {
    composes: Number(composesAsParent.n),
    composedBy: Number(composesAsChild.n),
    consumesFrom: Number(consumesAsConsumer.n),
    consumedBy: Number(consumesAsPlatform.n),
    dependsOn: Number(dependsOn.n),
    dependsOnGroups: Number(dependsOnGroups.n),
  };
}

export async function createProduct(input: CreateProductInput, actor: Actor) {
  const parsed = createProductSchema.parse(input);
  const slug = parsed.slug ?? toSlug(parsed.name);
  if (!slug) {
    throw Object.assign(new Error("Could not derive a slug from the name"), {
      statusCode: 400,
      code: "VALIDATION_FAILED",
    });
  }
  await assertUniqueSlug(slug);

  // Spec 021 US2: the fast path verifies every component id up front so a
  // bad id fails before the product insert — existence-only, same rule as
  // the bulk depends-on path (ADR-110).
  const componentIds = parsed.componentIds ? [...new Set(parsed.componentIds)] : [];
  if (componentIds.length > 0) {
    const found = await db
      .selectFrom("components")
      .select("id")
      .where("id", "in", componentIds)
      .execute();
    const foundIds = new Set(found.map((r) => r.id));
    const missingIds = componentIds.filter((cid) => !foundIds.has(cid));
    if (missingIds.length > 0) {
      throw Object.assign(new Error("Components not found"), {
        statusCode: 404,
        code: "NOT_FOUND",
        details: { missingIds },
      });
    }
  }

  const id = uuidv7();
  const now = new Date().toISOString();
  const product = await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("digital_products")
      .values({
        id,
        name: parsed.name,
        slug,
        description: parsed.description ?? null,
        type: parsed.type,
        lifecycle: "ACTIVE",
        lobOwnerId: parsed.lobOwnerId ?? null,
        teamOwnerId: parsed.teamOwnerId ?? null,
        links: JSON.stringify(parsed.links ?? []) as unknown as Link[],
        tags: parsed.tags ?? [],
        criticality: parsed.criticality ?? null,
        sunsetAt: parsed.sunsetAt ?? null,
        createdBy: actor.id,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await writeEntityChange({
      entityType: "digital_product",
      entityId: id,
      action: "created",
      changes: parsed as Record<string, unknown>,
      actor,
    }, trx);
    if (componentIds.length > 0) {
      const inserted = await trx
        .insertInto("product_depends_on_component")
        .values(componentIds.map((componentId) => ({ productId: id, componentId })))
        .onConflict((oc) => oc.doNothing())
        .returning("componentId")
        .execute();
      const wiredIds = inserted
        .map((r) => r.componentId)
        .filter((cid): cid is string => typeof cid === "string");
      for (const componentId of wiredIds) {
        await writeEdgeChange(
          "DEPENDS_ON_COMPONENT",
          { entityType: "digital_product", entityId: id },
          { entityType: "component", entityId: componentId },
          "added",
          actor,
          "created from components",
          trx,
        );
      }
      // ADR-113: these edges bypass addDependsOnEdge — tombstone the pairs
      // inline so decidedBy records the wiring actor, not NULL.
      await supersedeSuggestionPairs(trx, id, wiredIds, actor);
    }
    return trx
      .selectFrom("digital_products")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  });
  // ADR-113: stage suggestions for the new product — post-commit and
  // failure-isolated so a suggestion bug can't reject the write.
  await runSuggestionPass({ productId: id }, { productId: id });
  return product;
}

/**
 * Products that consume a platform via CONSUMES_FROM — shared by
 * updateProduct's type-change guard and the catalog bootstrap planner.
 */
export async function findConsumesFromConsumers(
  platformIds: string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  const byPlatform = new Map<string, { id: string; name: string }[]>();
  if (!platformIds.length) return byPlatform;
  const rows = await db
    .selectFrom("product_consumes_from")
    .innerJoin("digital_products", "product_consumes_from.consumerId", "digital_products.id")
    .select(["product_consumes_from.platformId", "digital_products.id", "digital_products.name"])
    .where("product_consumes_from.platformId", "in", platformIds)
    .execute();
  for (const r of rows) {
    if (!r.platformId || !r.id || !r.name) continue;
    const list = byPlatform.get(r.platformId) ?? [];
    list.push({ id: r.id, name: r.name });
    byPlatform.set(r.platformId, list);
  }
  return byPlatform;
}

/**
 * Type changes are guarded: a new type must not invalidate existing edges —
 * non-PLATFORM can't be a CONSUMES_FROM target. Any type may be a COMPOSES
 * parent (ADR-109), so retyping to PLATFORM is never blocked by children.
 */
export async function updateProduct(id: string, input: UpdateProductInput, actor: Actor) {
  const existing = await getProductById(id);
  if (!existing) return null;
  const parsed = updateProductSchema.parse(input);

  if (parsed.slug) await assertUniqueSlug(parsed.slug, id);

  if (parsed.type && parsed.type !== existing.type) {
    const offenders: Array<{ edgeType: string; otherId: string; otherName: string }> = [];
    if (parsed.type !== "PLATFORM") {
      const consumers = (await findConsumesFromConsumers([id])).get(id) ?? [];
      offenders.push(
        ...consumers.map((c) => ({
          edgeType: "CONSUMES_FROM",
          otherId: c.id,
          otherName: c.name,
        })),
      );
    }
    if (offenders.length) {
      throw Object.assign(
        new Error(`Type change to ${parsed.type} would invalidate existing edges`),
        { statusCode: 409, code: "TYPE_CHANGE_BLOCKED", details: { edges: offenders } },
      );
    }
  }

  const updates: Record<string, unknown> = {};
  for (const k of ["name", "slug", "type", "lifecycle"] as const) {
    if (parsed[k] !== undefined) updates[k] = parsed[k];
  }
  if (parsed.description !== undefined) updates.description = parsed.description;
  if (parsed.lobOwnerId !== undefined) updates.lobOwnerId = parsed.lobOwnerId;
  if (parsed.teamOwnerId !== undefined) updates.teamOwnerId = parsed.teamOwnerId;
  if (parsed.links !== undefined)
    updates.links = JSON.stringify(parsed.links) as unknown as Link[];
  if (parsed.tags !== undefined) updates.tags = parsed.tags;
  if (parsed.criticality !== undefined) updates.criticality = parsed.criticality;
  if (parsed.sunsetAt !== undefined) updates.sunsetAt = parsed.sunsetAt;
  if (Object.keys(updates).length === 0) return existing;

  const prevLifecycle = existing.lifecycle;
  updates.updatedBy = actor.id;
  updates.updatedAt = new Date().toISOString();

  const updated = await db.transaction().execute(async (trx) => {
    await trx.updateTable("digital_products").set(updates).where("id", "=", id).execute();
    const action =
      parsed.lifecycle === "RETIRED" && prevLifecycle !== "RETIRED"
        ? "retired"
        : parsed.lifecycle === "ACTIVE" && prevLifecycle === "RETIRED"
          ? "unretired"
          : "updated";
    await writeEntityChange({
      entityType: "digital_product",
      entityId: id,
      action,
      changes: updates,
      actor,
    }, trx);
    return trx
      .selectFrom("digital_products")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  });

  // ADR-113: signal-affecting fields (the product name/tag side of every
  // signal — slug is not a signal input, so slug-only changes are dead
  // work) re-stage this product's pairs — post-commit, failure-isolated.
  // Guard on real changes, not mere presence in the PATCH body (FR-002).
  if (
    (parsed.name !== undefined && parsed.name !== existing.name) ||
    (parsed.tags !== undefined && tagsDiffer(parsed.tags, existing.tags))
  ) {
    await runSuggestionPass({ productId: id }, { productId: id });
  }
  return updated;
}

export async function deleteProduct(id: string, actor: Actor) {
  const existing = await getProductById(id);
  if (!existing) return null;

  const counts = await countProductEdges(id);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total > 0) {
    throw Object.assign(
      new Error(`Product still has ${total} edge(s) — retire it or remove its edges first`),
      { statusCode: 409, code: "REFERENCED", details: { counts } },
    );
  }

  return db.transaction().execute(async (trx) => {
    await trx.deleteFrom("digital_products").where("id", "=", id).execute();
    await writeEntityChange({
      entityType: "digital_product",
      entityId: id,
      action: "deleted",
      changes: { name: existing.name, slug: existing.slug },
      actor,
    }, trx);
    return existing;
  });
}
