import type { ExpressionBuilder, ExpressionWrapper, SqlBool } from "kysely";
import type { CatalogCoverage, ProductCompleteness } from "@componode/core";
import { db } from "../db/connection.js";
import type { DB } from "../db/types.js";

/**
 * Shared read-only coverage derivations (spec 023). Metric, list filters,
 * and the completeness chip all consume these so the numbers can never
 * drift (research D2). Kysely parameterized only (ADR-084); nothing is
 * persisted — every call recomputes.
 */

/**
 * Coverage population predicate — the default-visible component set
 * (clarification 2026-10-20): `ACTIVE` and not instances-all-`GONE`.
 * Components with zero instances count. Mirrors the components list's
 * default visibility so metric and worklist agree by construction.
 */
/**
 * Instance-visibility half of the population rule — a component counts when
 * it has no instances or at least one non-`GONE` instance. Shared with
 * `component-catalog-service.ts`'s default `includeGone=false` filter so the
 * two can never diverge.
 */
export function hasNonGoneInstanceOrNone(
  eb: ExpressionBuilder<DB, "components">,
): ExpressionWrapper<DB, "components", SqlBool> {
  return eb.or([
    eb.not(
      eb.exists(
        eb
          .selectFrom("component_instances")
          .select("component_instances.id")
          .whereRef("component_instances.componentId", "=", "components.id"),
      ),
    ),
    eb.exists(
      eb
        .selectFrom("component_instances")
        .select("component_instances.id")
        .whereRef("component_instances.componentId", "=", "components.id")
        .where("component_instances.status", "!=", "GONE"),
    ),
  ]);
}

export function coveragePopulationPredicate(
  eb: ExpressionBuilder<DB, "components">,
): ExpressionWrapper<DB, "components", SqlBool> {
  return eb.and([
    eb("components.lifecycle", "=", "ACTIVE"),
    hasNonGoneInstanceOrNone(eb),
  ]);
}

/**
 * Ids reached by a non-retired product's `DEPENDS_ON` path — direct
 * component edges or membership in a depended-on ComponentGroup
 * (ADR-110 expansion, single hop — groups cannot nest). Pending
 * suggestions never wire (ADR-113); edges from RETIRED products never
 * wire. Callers apply the population predicate — RETIRED/gone-only
 * components are excluded at both call sites, so the raw set here
 * deliberately carries no component-lifecycle filter.
 */
export function wiredComponentIdsQuery() {
  return db
    .selectFrom("product_depends_on_component")
    .innerJoin(
      "digital_products",
      "digital_products.id",
      "product_depends_on_component.productId",
    )
    .select("product_depends_on_component.componentId as id")
    .where("digital_products.lifecycle", "!=", "RETIRED")
    .union((eb) =>
      eb
        .selectFrom("components")
        .innerJoin(
          "product_depends_on_component_group",
          "product_depends_on_component_group.componentGroupId",
          "components.componentGroupId",
        )
        .innerJoin(
          "digital_products",
          "digital_products.id",
          "product_depends_on_component_group.productId",
        )
        .select("components.id")
        .where("digital_products.lifecycle", "!=", "RETIRED"),
    )
    // JunctionRow types FKs optional for inserts; componentId is NOT NULL.
    .$castTo<{ id: string }>();
}

/** Population members wired per `wiredComponentIdsQuery()`. */
export async function computeWiredComponentIds(): Promise<Set<string>> {
  const rows = await db
    .selectFrom("components")
    .select("components.id")
    .where((eb) => coveragePopulationPredicate(eb))
    .where("components.id", "in", wiredComponentIdsQuery())
    .execute();
  return new Set(rows.map((r) => r.id));
}

/**
 * Ids of products whose dependency surface is non-empty: own `DEPENDS_ON`
 * (direct or group target — empty groups count as declared intent), own
 * `CONSUMES_FROM`, or a non-retired `COMPOSES` descendant's `DEPENDS_ON`
 * (recursive, parent→child). Computed over the whole catalog; callers
 * scope to non-retired products as needed.
 */
export async function computeDependencySurfaces(): Promise<Set<string>> {
  const [ownRows, reliefRows] = await Promise.all([
    db
      .selectFrom("product_depends_on_component")
      .select("productId")
      .union((eb) =>
        eb.selectFrom("product_depends_on_component_group").select("productId"),
      )
      .union((eb) =>
        eb
          .selectFrom("product_consumes_from")
          .select("consumerId as productId"),
      )
      .execute(),
    db
      .withRecursive("reach(ancestorId, descendantId)", (qb) =>
        qb
          .selectFrom("product_composes")
          .select(["parentId as ancestorId", "childId as descendantId"])
          .union((eb) =>
            eb
              .selectFrom("reach")
              .innerJoin(
                "product_composes",
                "product_composes.parentId",
                "reach.descendantId",
              )
              .select([
                "reach.ancestorId",
                "product_composes.childId as descendantId",
              ]),
          ),
      )
      .selectFrom("reach")
      .innerJoin(
        "digital_products",
        "digital_products.id",
        "reach.descendantId",
      )
      .select("reach.ancestorId as productId")
      .distinct()
      .where("digital_products.lifecycle", "!=", "RETIRED")
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom("product_depends_on_component")
              .select("product_depends_on_component.productId")
              .whereRef(
                "product_depends_on_component.productId",
                "=",
                "reach.descendantId",
              ),
          ),
          eb.exists(
            eb
              .selectFrom("product_depends_on_component_group")
              .select("product_depends_on_component_group.productId")
              .whereRef(
                "product_depends_on_component_group.productId",
                "=",
                "reach.descendantId",
              ),
          ),
        ]),
      )
      .execute(),
  ]);

  const surfaces = new Set<string>();
  for (const r of ownRows) if (r.productId) surfaces.add(r.productId);
  for (const r of reliefRows) if (r.productId) surfaces.add(r.productId);
  return surfaces;
}

/**
 * FR-009/FR-010: the three completeness facets for one product row — single
 * derivation shared by the `missing` filter, list rows, detail payloads, and
 * the dashboard counters so the numbers can never drift (research D2).
 * `dependencies` mirrors `missing=dependencies`: false ⇔ empty surface.
 */
export function productCompleteness(
  row: {
    id: string;
    lobOwnerId: string | null;
    teamOwnerId: string | null;
    description: string | null;
  },
  surfaces: Set<string>,
): ProductCompleteness {
  return {
    owner: row.lobOwnerId != null || row.teamOwnerId != null,
    description: row.description != null && row.description.trim() !== "",
    dependencies: surfaces.has(row.id),
  };
}

/** FR-001/FR-002: dashboard catalog-coverage metrics (FR-003 zero-denominator). */
export async function getCatalogCoverage(): Promise<CatalogCoverage> {
  const [populationRows, wiredIds, surfaces, productRows] = await Promise.all([
    db
      .selectFrom("components")
      .select("components.id")
      .where((eb) => coveragePopulationPredicate(eb))
      .execute(),
    computeWiredComponentIds(),
    computeDependencySurfaces(),
    db
      .selectFrom("digital_products")
      .select(["id", "lobOwnerId", "teamOwnerId", "description"])
      .where("lifecycle", "!=", "RETIRED")
      .execute(),
  ]);

  const active = populationRows.length;
  const wired = wiredIds.size;
  const wiredPct =
    active === 0 ? null : Math.round((wired / active) * 1000) / 10;

  let missingOwner = 0;
  let missingDependencies = 0;
  let missingDescription = 0;
  for (const p of productRows) {
    const c = productCompleteness(p, surfaces);
    if (!c.owner) missingOwner += 1;
    if (!c.dependencies) missingDependencies += 1;
    if (!c.description) missingDescription += 1;
  }

  return {
    components: { active, wired, wiredPct },
    products: {
      total: productRows.length,
      missingOwner,
      missingDependencies,
      missingDescription,
    },
  };
}
