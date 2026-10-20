import type {
  ComponentCategory,
  ComponentDependent,
  ComponentProvider,
  DigitalProduct,
  Link,
  PlatformCandidate,
  PromoteToPlatformResult,
} from "@componode/core";
import { promoteToPlatformSchema } from "@componode/core";
import { uuidv7 } from "uuidv7";
import { db } from "../db/connection.js";
import { writeEdgeChange, writeEntityChange, type Actor } from "./audit-service.js";
import { toSlug } from "./product-service.js";
import { supersedeSuggestionPairs } from "./product-edge-service.js";
import { runSuggestionPass } from "./edge-suggestion-service.js";

function notFound(entity: string) {
  return Object.assign(new Error(`${entity} not found`), {
    statusCode: 404,
    code: "NOT_FOUND",
  });
}

function conflict(message: string, details?: unknown) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: "CONFLICT",
    ...(details ? { details } : {}),
  });
}

const DEPENDENT_SELECT = [
  "digital_products.id",
  "digital_products.name",
  "digital_products.slug",
  "digital_products.type",
] as const;

/**
 * Non-RETIRED products holding a direct `DEPENDS_ON` edge on the component
 * (spec 020 / ADR-017). Group-expanded reach is deliberately excluded — only
 * direct edges are candidates for the promotion rewrite.
 */
export async function listComponentDependents(
  componentId: string,
): Promise<ComponentDependent[]> {
  return db
    .selectFrom("product_depends_on_component")
    .innerJoin(
      "digital_products",
      "product_depends_on_component.productId",
      "digital_products.id",
    )
    .select(DEPENDENT_SELECT)
    .where("product_depends_on_component.componentId", "=", componentId)
    .where("digital_products.lifecycle", "!=", "RETIRED")
    .orderBy("digital_products.name")
    .$castTo<ComponentDependent>()
    .execute();
}

/**
 * ADR-017 detection: ACTIVE components with direct `DEPENDS_ON` edges from
 * ≥2 distinct non-RETIRED products. Group-expanded reach never counts —
 * only rows in `product_depends_on_component`. Derived per read.
 */
export async function listPlatformCandidates(): Promise<PlatformCandidate[]> {
  const groups = await db
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
    .where("components.lifecycle", "!=", "RETIRED")
    .where("digital_products.lifecycle", "!=", "RETIRED")
    .groupBy([
      "components.id",
      "components.name",
      "components.slug",
      "components.category",
      "components.provider",
    ])
    .select([
      "components.id",
      "components.name",
      "components.slug",
      "components.category",
      "components.provider",
      (eb) =>
        eb.fn
          .count("product_depends_on_component.productId")
          .distinct()
          .as("dependerCount"),
    ])
    .having((eb) =>
      eb(
        eb.fn
          .count("product_depends_on_component.productId")
          .distinct(),
        ">=",
        2,
      ),
    )
    .orderBy("dependerCount", "desc")
    .orderBy("components.name")
    .$castTo<{
      id: string;
      name: string;
      slug: string;
      category: ComponentCategory;
      provider: ComponentProvider;
      dependerCount: number;
    }>()
    .execute();

  if (!groups.length) return [];

  const depRows = await db
    .selectFrom("product_depends_on_component")
    .innerJoin(
      "digital_products",
      "product_depends_on_component.productId",
      "digital_products.id",
    )
    .select([
      "product_depends_on_component.componentId",
      ...DEPENDENT_SELECT,
    ])
    .where(
      "product_depends_on_component.componentId",
      "in",
      groups.map((g) => g.id),
    )
    .where("digital_products.lifecycle", "!=", "RETIRED")
    .orderBy("digital_products.name")
    .$castTo<{ componentId: string } & ComponentDependent>()
    .execute();

  const byComponent = new Map<string, ComponentDependent[]>();
  for (const d of depRows) {
    const list = byComponent.get(d.componentId) ?? [];
    list.push({ id: d.id, name: d.name, slug: d.slug, type: d.type });
    byComponent.set(d.componentId, list);
  }

  return groups.map((g) => ({
    component: {
      id: g.id,
      name: g.name,
      slug: g.slug,
      category: g.category,
      provider: g.provider,
    },
    dependerCount: Number(g.dependerCount),
    dependents: byComponent.get(g.id) ?? [],
  }));
}

const PROMOTION_REASON = "component promoted to platform product";

/**
 * ADR-017 promotion: atomically create a PLATFORM product from a component,
 * wire platform→component DEPENDS_ON, and rewrite each selected consumer's
 * direct edge into a consumer→platform CONSUMES_FROM edge (FR-004..FR-009).
 * Everything happens in one transaction — any failure leaves the catalog
 * unchanged.
 */
export async function promoteComponentToPlatform(
  componentId: string,
  rawInput: unknown,
  actor: Actor,
): Promise<PromoteToPlatformResult> {
  const parsed = promoteToPlatformSchema.parse(rawInput);

  const result = await db.transaction().execute(async (trx) => {
    const component = await trx
      .selectFrom("components")
      .select(["id", "name", "slug", "lifecycle"])
      .where("id", "=", componentId)
      .executeTakeFirst();
    if (!component) throw notFound("Component");
    if (component.lifecycle === "RETIRED") {
      throw conflict(`Component "${component.name}" is retired`);
    }

    // Resolve the consumer set: all active direct consumers by default;
    // every supplied id must belong to that set or the request fails
    // before any write (stale-checklist guard, data-model.md §Invariants).
    const dependents = await trx
      .selectFrom("product_depends_on_component")
      .innerJoin(
        "digital_products",
        "product_depends_on_component.productId",
        "digital_products.id",
      )
      .select(DEPENDENT_SELECT)
      .where("product_depends_on_component.componentId", "=", componentId)
      .where("digital_products.lifecycle", "!=", "RETIRED")
      .orderBy("digital_products.name")
      .$castTo<ComponentDependent>()
      .execute();

    let consumers = dependents;
    if (parsed.consumerIds !== undefined) {
      const valid = new Set(dependents.map((d) => d.id));
      const offendingIds = parsed.consumerIds.filter((id) => !valid.has(id));
      if (offendingIds.length) {
        throw Object.assign(
          new Error("Some consumerIds are not direct consumers of this component"),
          {
            statusCode: 400,
            code: "VALIDATION_FAILED",
            details: { offendingIds },
          },
        );
      }
      const wanted = new Set(parsed.consumerIds);
      consumers = dependents.filter((d) => wanted.has(d.id));
    }

    const name = parsed.name ?? component.name;
    let slug: string;
    if (parsed.slug) {
      const taken = await trx
        .selectFrom("digital_products")
        .select("id")
        .where("slug", "=", parsed.slug)
        .executeTakeFirst();
      if (taken) {
        throw Object.assign(
          new Error(`Slug "${parsed.slug}" is already in use`),
          { statusCode: 409, code: "SLUG_TAKEN" },
        );
      }
      slug = parsed.slug;
    } else {
      const base = toSlug(name);
      if (!base) {
        throw Object.assign(
          new Error("Could not derive a slug from the name"),
          { statusCode: 400, code: "VALIDATION_FAILED" },
        );
      }
      const taken = new Set(
        (
          await trx
            .selectFrom("digital_products")
            .select("slug")
            .where("slug", "like", `${base}%`)
            .execute()
        ).map((r) => r.slug),
      );
      slug = base;
      for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
    }

    const id = uuidv7();
    const now = new Date().toISOString();
    await trx
      .insertInto("digital_products")
      .values({
        id,
        name,
        slug,
        description: parsed.description ?? null,
        type: "PLATFORM",
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
    await writeEntityChange(
      {
        entityType: "digital_product",
        entityId: id,
        action: "created",
        changes: { ...parsed, name, slug, type: "PLATFORM" },
        actor,
      },
      trx,
    );

    await trx
      .insertInto("product_depends_on_component")
      .values({ productId: id, componentId })
      .execute();
    await writeEdgeChange(
      "DEPENDS_ON_COMPONENT",
      { entityType: "digital_product", entityId: id },
      { entityType: "component", entityId: componentId },
      "added",
      actor,
      PROMOTION_REASON,
      trx,
    );
    // ADR-113: this edge bypasses addDependsOnEdge — tombstone the pair
    // inline so decidedBy records the wiring actor, not NULL.
    await supersedeSuggestionPairs(trx, id, [componentId], actor);

    for (const consumer of consumers) {
      await trx
        .deleteFrom("product_depends_on_component")
        .where("productId", "=", consumer.id)
        .where("componentId", "=", componentId)
        .execute();
      await writeEdgeChange(
        "DEPENDS_ON_COMPONENT",
        { entityType: "digital_product", entityId: consumer.id },
        { entityType: "component", entityId: componentId },
        "removed",
        actor,
        PROMOTION_REASON,
        trx,
      );
      // The consumer still reaches the component through the platform —
      // tombstone the pair so a pre-feature edge can't regenerate (ADR-113).
      await supersedeSuggestionPairs(trx, consumer.id, [componentId], actor);
      await trx
        .insertInto("product_consumes_from")
        .values({ consumerId: consumer.id, platformId: id })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await writeEdgeChange(
        "CONSUMES_FROM",
        { entityType: "digital_product", entityId: consumer.id },
        { entityType: "digital_product", entityId: id },
        "added",
        actor,
        PROMOTION_REASON,
        trx,
      );
    }

    const product = await trx
      .selectFrom("digital_products")
      .leftJoin(
        "line_of_businesses",
        "digital_products.lobOwnerId",
        "line_of_businesses.id",
      )
      .leftJoin("teams", "digital_products.teamOwnerId", "teams.id")
      .select([
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
      ])
      .where("digital_products.id", "=", id)
      .$castTo<DigitalProduct>()
      .executeTakeFirstOrThrow();

    return { product, consumers };
  });

  // ADR-113: the promotion writes its DEPENDS_ON edge directly (no
  // tombstone) and the new PLATFORM product never saw a createProduct
  // trigger — a scoped pass covers both; failure-isolated, post-commit.
  await runSuggestionPass(
    { productId: result.product.id },
    { productId: result.product.id },
  );
  return result;
}
