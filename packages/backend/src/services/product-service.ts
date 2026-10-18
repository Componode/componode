import { sql, type SqlBool } from "kysely";
import { uuidv7 } from "uuidv7";
import {
  createProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
  type ListProductsQuery,
  type Link,
} from "@componode/core";
import { db } from "../db/connection.js";
import { writeEntityChange, type Actor } from "./audit-service.js";

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
  const ids = products.map((p) => p.id);
  const edges = ids.length
    ? await db
        .selectFrom("product_composes")
        .select(["parentId", "childId"])
        .where("parentId", "in", ids)
        .where("childId", "in", ids)
        .execute()
    : [];

  return { products, edges };
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

  const [composedBy, composes, consumesFrom, consumedBy] = await Promise.all([
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

  const declared = depRows
    .filter((r) => r.viaId === product.id)
    .map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      category: r.category,
      lifecycle: r.lifecycle,
    }));
  const inherited = depRows
    .filter((r) => r.viaId !== product.id)
    .map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      category: r.category,
      lifecycle: r.lifecycle,
      via: { id: r.viaId, name: r.viaName, slug: r.viaSlug },
    }));

  const componentIds = [...new Set(depRows.map((r) => r.id))];
  const viaByComponent = new Map<string, { id: string; name: string; slug: string }>();
  const declaredComponentIds = new Set(declared.map((c) => c.id));
  for (const r of depRows) {
    if (!viaByComponent.has(r.id)) {
      viaByComponent.set(r.id, { id: r.viaId, name: r.viaName, slug: r.viaSlug });
    }
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
    product,
    composedBy,
    composes,
    consumesFrom,
    consumedBy,
    components: { declared, inherited },
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
  const [composesAsParent, composesAsChild, consumesAsConsumer, consumesAsPlatform, dependsOn] =
    await Promise.all([
      db.selectFrom("product_composes").where("parentId", "=", productId).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
      db.selectFrom("product_composes").where("childId", "=", productId).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
      db.selectFrom("product_consumes_from").where("consumerId", "=", productId).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
      db.selectFrom("product_consumes_from").where("platformId", "=", productId).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
      db.selectFrom("product_depends_on_component").where("productId", "=", productId).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
    ]);
  return {
    composes: Number(composesAsParent.n),
    composedBy: Number(composesAsChild.n),
    consumesFrom: Number(consumesAsConsumer.n),
    consumedBy: Number(consumesAsPlatform.n),
    dependsOn: Number(dependsOn.n),
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

  const id = uuidv7();
  const now = new Date().toISOString();
  return db.transaction().execute(async (trx) => {
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
    return trx
      .selectFrom("digital_products")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  });
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
      const consumers = await db
        .selectFrom("product_consumes_from")
        .innerJoin("digital_products", "product_consumes_from.consumerId", "digital_products.id")
        .select(["digital_products.id", "digital_products.name"])
        .where("product_consumes_from.platformId", "=", id)
        .execute();
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

  return db.transaction().execute(async (trx) => {
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
