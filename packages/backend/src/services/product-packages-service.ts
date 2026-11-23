import { sql, type SqlBool } from "kysely";
import { db } from "../db/connection.js";
import {
  normalizePurlIdentity,
  type DepSource,
  type ListProductPackageConsumersQuery,
  type ListProductPackagesQuery,
  type ProductPackageConsumerListItem,
  type ProductPackagesResponse,
  type Paginated,
} from "@componode/core";
import { paginateQuery, sortTarget, type OrderTarget } from "../utils/pagination.js";
import { toIsoTimestamp } from "../db/timestamps.js";
import { getBomStaleThresholdDays } from "./settings-service.js";
import { productComponentScope, type ScopedComponent } from "./product-dep-scope.js";

// Spec 080 — the per-product package roll-up (research Q7): the spec-074
// purlIdentity grouping scoped to the product's reachable component set
// (productComponentScope — direct / group / COMPOSES-inherited, ACTIVE only,
// D5 parity), plus the declared-dependency signal: a package row is
// "declared" when its matched catalog component is itself reachable.

const PACKAGE_SORT: Record<string, OrderTarget> = {
  name: "name",
  components: "componentCount",
  versions: "versionCount",
  ecosystem: "ecosystem",
};

const CONSUMER_SORT: Record<string, OrderTarget> = {
  name: "name",
  version: "version",
  scope: "scope",
  lastReportedAt: "lastReportedAt",
};

/** Preferred attribution for a multi-path component — declared sources
 * (DIRECT/GROUP) outrank INHERITED, mirroring the declared/inherited split. */
function preferredSource(c: ScopedComponent): DepSource {
  return c.sources.find((s) => s.kind !== "INHERITED") ?? c.sources[0]!;
}

async function productBySlug(slug: string) {
  return db
    .selectFrom("digital_products")
    .select(["id"])
    .where("slug", "=", slug)
    .executeTakeFirst();
}

function emptyPage(query: { page: number; pageSize: number }) {
  return {
    data: [],
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: 0,
      pageCount: 0,
      hasNext: false,
    },
  };
}

/**
 * `GET /products/:slug/packages` — one row per version-free purl across the
 * product's reachable ACTIVE components. `declared` resolves the same
 * two-step catalog match as `listPackages` (resolved → verbatim externalId)
 * and marks membership in the scope map with its DepSource attribution.
 */
export async function listProductPackages(
  slug: string,
  query: ListProductPackagesQuery,
): Promise<ProductPackagesResponse | null> {
  const product = await productBySlug(slug);
  if (!product) return null;

  const scope = await productComponentScope(product.id);
  const contributingIds = [...scope.values()]
    .filter((c) => c.lifecycle === "ACTIVE")
    .map((c) => c.id);
  // Coverage denominator (D5 parity): Library components are declared
  // dependencies, not monitored workloads — they may aggregate BOM entries
  // into rows, but they never inflate "N of M components report".
  const coverageIds = [...scope.values()]
    .filter((c) => c.lifecycle === "ACTIVE" && c.category !== "LIBRARY")
    .map((c) => c.id);
  const staleThresholdDays = await getBomStaleThresholdDays();

  if (!contributingIds.length) {
    return {
      ...emptyPage(query),
      coverage: { reporting: 0, total: coverageIds.length, reachable: 0 },
      staleThresholdDays,
      facets: { ecosystems: [] as string[] },
    };
  }

  let inner = db
    .selectFrom("bom_entries")
    .where("bom_entries.componentId", "in", contributingIds)
    .where((eb) => {
      if (!query.search) return eb.val(true);
      const like = `%${query.search}%`;
      return eb.or([
        eb("bom_entries.name", "ilike", like),
        eb("bom_entries.purl", "ilike", like),
        eb("bom_entries.purlIdentity", "ilike", like),
      ]);
    })
    .groupBy(["bom_entries.purlIdentity", "bom_entries.ecosystem"])
    .select((eb) => [
      "bom_entries.purlIdentity as purl",
      sql<string>`(array_agg(bom_entries.name ORDER BY bom_entries."lastReportedAt" DESC))[1]`.as(
        "name",
      ),
      "bom_entries.ecosystem as ecosystem",
      eb.fn.count("bom_entries.version").distinct().as("versionCount"),
      eb.fn.count("bom_entries.componentId").distinct().as("componentCount"),
      eb.fn.max("bom_entries.lastReportedAt").as("lastReportedAt"),
      sql<string>`(array_agg(bom_entries."resolvedComponentId" ORDER BY bom_entries."resolvedComponentId" NULLS LAST, bom_entries."lastReportedAt" DESC))[1]`.as(
        "resolvedComponentId",
      ),
    ]);

  if (query.ecosystem?.length) {
    inner = inner.where("bom_entries.ecosystem", "in", query.ecosystem);
  }
  // skew — only identities reported at more than one distinct version.
  if (query.skew) {
    inner = inner.having((eb) =>
      eb(eb.fn.count("bom_entries.version").distinct(), ">", 1),
    );
  }

  // Catalog match (spec-075 parity): resolved component, else a non-retired
  // component whose externalId equals the identity verbatim. The declared
  // signal is scope membership of that matched id.
  const verbatimCandidates = db
    .selectFrom(
      db
        .selectFrom("components")
        .select(["id", "slug", "name", "externalId"])
        .where("externalId", "is not", null)
        .where("lifecycle", "!=", "RETIRED")
        .as("cv"),
    )
    .select(["cv.id", "cv.slug", "cv.name", "cv.externalId"])
    .distinctOn("cv.externalId")
    .orderBy("cv.externalId")
    .orderBy("cv.id")
    .as("catv");

  // Declared membership — the matched catalog component must be a
  // non-retired member of the product's reachable set (FR-012).
  const memberIn = sql.join(contributingIds.map((id) => sql`${id}`), sql`, `);

  let grouped = db
    .selectFrom(inner.as("g"))
    .leftJoin("components as catr", (join) =>
      join
        .onRef("catr.id", "=", "g.resolvedComponentId")
        .on("catr.lifecycle", "!=", "RETIRED"),
    )
    .leftJoin(verbatimCandidates, (join) =>
      join.onRef("catv.externalId", "=", "g.purl"),
    )
    .select((eb) => [
      "g.purl",
      "g.name",
      "g.ecosystem",
      "g.versionCount",
      "g.componentCount",
      "g.lastReportedAt",
      sql<string>`coalesce("catr"."id", "catv"."id")`.as("catalogComponentId"),
      sql<string>`coalesce("catr"."slug", "catv"."slug")`.as(
        "catalogComponentSlug",
      ),
      sql<string>`coalesce("catr"."name", "catv"."name")`.as(
        "catalogComponentName",
      ),
      eb
        .fn.coalesce(
          sql<boolean>`coalesce("catr"."id", "catv"."id") in (${memberIn})`,
          eb.lit(false),
        )
        .as("declared"),
    ]);

  if (query.declared) {
    const matched = sql`coalesce("catr"."id", "catv"."id")`;
    const isMember = sql<SqlBool>`${matched} in (${memberIn})`;
    // undeclared must keep NULL-matched rows — `NOT (NULL IN …)` is NULL.
    grouped = grouped.where(
      query.declared === "declared"
        ? isMember
        : sql<SqlBool>`(${matched} is null or ${matched} not in (${memberIn}))`,
    );
  }

  const ecosystemFacet = db
    .selectFrom("bom_entries")
    .where("bom_entries.componentId", "in", contributingIds)
    .select("bom_entries.ecosystem")
    .distinct()
    .orderBy("bom_entries.ecosystem")
    .execute();
  const reportingFacet = coverageIds.length
    ? db
        .selectFrom("bom_entries")
        .where("bom_entries.componentId", "in", coverageIds)
        .select((eb) =>
          eb.fn.count("bom_entries.componentId").distinct().as("n"),
        )
        .executeTakeFirst()
    : Promise.resolve(undefined);

  const [page, facetRows, reportingRow] = await Promise.all([
    paginateQuery(
      grouped,
      { page: query.page, pageSize: query.pageSize },
      {
        orderBy: (qb) =>
          qb
            .orderBy(
              sortTarget(PACKAGE_SORT, query.sort, "componentCount"),
              query.order,
            )
            .orderBy("name", "asc")
            .orderBy("purl", "asc"),
      },
    ),
    ecosystemFacet,
    reportingFacet,
  ]);

  type GroupRow = {
    purl: string;
    name: string;
    ecosystem: string;
    versionCount: string | number;
    componentCount: string | number;
    lastReportedAt: unknown;
    catalogComponentId: string | null;
    catalogComponentSlug: string | null;
    catalogComponentName: string | null;
    declared: boolean;
  };
  const rows = page.data as GroupRow[];

  const versionRows = rows.length
    ? await db
        .selectFrom("bom_entries")
        .where("bom_entries.componentId", "in", contributingIds)
        .where("bom_entries.purlIdentity", "in", rows.map((r) => r.purl))
        .where("bom_entries.version", "is not", null)
        .groupBy(["bom_entries.purlIdentity", "bom_entries.version"])
        .select((eb) => [
          "bom_entries.purlIdentity as purl",
          "bom_entries.version as version",
          eb.fn.count("bom_entries.componentId").distinct().as("componentCount"),
        ])
        .execute()
    : [];

  const versionsByPurl = new Map<
    string,
    { version: string; componentCount: number }[]
  >();
  for (const r of versionRows) {
    const list = versionsByPurl.get(r.purl) ?? [];
    list.push({
      version: r.version!,
      componentCount: Number(r.componentCount),
    });
    versionsByPurl.set(r.purl, list);
  }

  return {
    pagination: page.pagination,
    coverage: {
      reporting: Number(reportingRow?.n ?? 0),
      total: coverageIds.length,
      reachable: contributingIds.length,
    },
    staleThresholdDays,
    facets: { ecosystems: facetRows.map((r) => r.ecosystem) },
    data: rows.map((r) => {
      const scoped = r.catalogComponentId
        ? scope.get(r.catalogComponentId)
        : undefined;
      return {
        purl: r.purl,
        name: r.name,
        ecosystem: r.ecosystem,
        versionCount: Number(r.versionCount),
        versions: (versionsByPurl.get(r.purl) ?? [])
          .sort(
            (a, b) =>
              b.componentCount - a.componentCount ||
              a.version.localeCompare(b.version),
          )
          .slice(0, 5),
        componentCount: Number(r.componentCount),
        lastReportedAt: toIsoTimestamp(r.lastReportedAt),
        catalogComponent: r.catalogComponentId
          ? {
              id: r.catalogComponentId,
              slug: r.catalogComponentSlug!,
              name: r.catalogComponentName!,
            }
          : null,
        declared: r.declared && scoped ? preferredSource(scoped) : null,
      };
    }),
  };
}

/**
 * `GET /products/:slug/packages/consumers` — merged (component, version,
 * scope) rows scoped to the product's reachable ACTIVE components, each
 * carrying its DepSource attribution. Unknown purls return an empty page.
 */
export async function listProductPackageConsumers(
  slug: string,
  query: ListProductPackageConsumersQuery,
): Promise<Paginated<ProductPackageConsumerListItem> | null> {
  const product = await productBySlug(slug);
  if (!product) return null;

  const scope = await productComponentScope(product.id);
  const contributingIds = [...scope.values()]
    .filter((c) => c.lifecycle === "ACTIVE")
    .map((c) => c.id);
  const identity = normalizePurlIdentity(query.purl) ?? query.purl;

  if (!contributingIds.length) return emptyPage(query);

  let inner = db
    .selectFrom("bom_entries")
    .innerJoin("components", (join) =>
      join.onRef("components.id", "=", "bom_entries.componentId"),
    )
    .where("bom_entries.componentId", "in", contributingIds)
    .where("bom_entries.purlIdentity", "=", identity)
    .groupBy([
      "components.id",
      "components.slug",
      "components.name",
      "components.category",
      "bom_entries.version",
      "bom_entries.scope",
    ])
    .select((eb) => [
      "components.id as componentId",
      "components.slug as slug",
      "components.name as name",
      "components.category as category",
      "bom_entries.version as version",
      "bom_entries.scope as scope",
      sql<boolean>`bool_or("bom_entries"."direct")`.as("direct"),
      eb.fn.max("bom_entries.lastReportedAt").as("lastReportedAt"),
    ]);

  if (query.version) {
    inner = inner.where("bom_entries.version", "=", query.version);
  }

  const grouped = db.selectFrom(inner.as("c")).selectAll();
  const page = await paginateQuery(
    grouped,
    { page: query.page, pageSize: query.pageSize },
    {
      orderBy: (qb) =>
        qb
          .orderBy(sortTarget(CONSUMER_SORT, query.sort, "name"), query.order)
          .orderBy("slug", "asc"),
    },
  );

  type Row = {
    componentId: string;
    slug: string;
    name: string;
    category: string;
    version: string | null;
    scope: ProductPackageConsumerListItem["scope"];
    direct: boolean;
    lastReportedAt: unknown;
  };

  return {
    pagination: page.pagination,
    // Rows are drawn from contributingIds ⊆ scope — a missing entry is
    // impossible, so skip rather than misattribute a fallback.
    data: (page.data as Row[]).flatMap((r) => {
      const scoped = scope.get(r.componentId);
      if (!scoped) return [];
      return [
        {
          component: {
            id: r.componentId,
            slug: r.slug,
            name: r.name,
            category: r.category,
          },
          depSource: preferredSource(scoped),
          version: r.version,
          scope: r.scope,
          direct: r.direct,
          lastReportedAt: toIsoTimestamp(r.lastReportedAt),
        },
      ];
    }),
  };
}
