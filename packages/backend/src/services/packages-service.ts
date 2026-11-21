import { sql, type SqlBool } from "kysely";
import { db } from "../db/connection.js";
import {
  normalizePurlIdentity,
  type ListPackageConsumersQuery,
  type ListPackagesQuery,
  type ListPackageVersionsQuery,
  type PackageConsumerListItem,
  type PackageVersionListItem,
  type PackagesResponse,
  type Paginated,
} from "@componode/core";
import { paginateQuery, sortTarget, type OrderTarget } from "../utils/pagination.js";
import { toIsoTimestamp } from "../db/timestamps.js";

// Spec 074 — the workspace where-used reads behind GET /packages and
// GET /packages/consumers. Both group bom_entries on the stored
// `purlIdentity` (migration 034) and join ACTIVE components only (D5):
// retired components keep their rows but don't inflate "where is it used".

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

/**
 * `GET /packages` — one row per version-free purl. Filters/search apply at
 * entry level before grouping (a package qualifies when any entry matches).
 * `versions[]` is a second grouped pass over just the page's identities,
 * top 5 by component count (D3). `catalog` and the catalog fields are
 * live (Phase 2, spec 075).
 */
export async function listPackages(
  query: ListPackagesQuery,
): Promise<PackagesResponse> {
  let inner = db
    .selectFrom("bom_entries")
    .innerJoin("components", (join) =>
      join
        .onRef("components.id", "=", "bom_entries.componentId")
        .on("components.lifecycle", "=", "ACTIVE"),
    )
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
      sql<string>`(array_agg(bom_entries."resolvedComponentId" ORDER BY bom_entries."resolvedComponentId" NULLS LAST, bom_entries."lastReportedAt" DESC))[1]`.as(
        "resolvedComponentId",
      ),
    ]);

  if (query.ecosystem?.length) {
    inner = inner.where("bom_entries.ecosystem", "in", query.ecosystem);
  }
  if (query.scope?.length) {
    inner = inner.where("bom_entries.scope", "in", query.scope);
  }

  // Spec 075: catalog fields are live — `catalogComponent` is the resolved
  // component (`resolvedComponentId`, written by the match pass or an
  // Add/Link decision), falling back to a non-retired component whose
  // externalId equals the package's normalized identity verbatim (the form
  // curated components store). `pendingSuggestionCount` tallies that
  // component's PENDING dependency suggestions. `catalog` filter: linked →
  // has component; suggested → pending > 0; none → neither.
  // Retired-endpoint rows are hidden everywhere the queue reads (T076) —
  // the chip/count must match what's actually decidable.
  const pendingCounts = db
    .selectFrom("bom_component_suggestions as s")
    .innerJoin("components as sp", (join) =>
      join.onRef("sp.id", "=", "s.parentComponentId"),
    )
    .innerJoin("components as sc", (join) =>
      join.onRef("sc.id", "=", "s.childComponentId"),
    )
    .select((eb) => [
      "s.childComponentId",
      eb.fn.countAll().as("n"),
    ])
    .where("s.status", "=", "PENDING")
    .where("sp.lifecycle", "!=", "RETIRED")
    .where("sc.lifecycle", "!=", "RETIRED")
    .groupBy("s.childComponentId")
    .as("pc");

  // One verbatim-matching component per identity — externalId has no DB
  // uniqueness, so duplicate identities would fan a package row out.
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
    .leftJoin(pendingCounts, (join) =>
      join.on(
        sql<SqlBool>`"pc"."childComponentId" = coalesce("catr"."id", "catv"."id")`,
      ),
    )
    .select((eb) => [
      "g.purl",
      "g.name",
      "g.ecosystem",
      "g.versionCount",
      "g.componentCount",
      sql<string>`coalesce("catr"."id", "catv"."id")`.as(
        "catalogComponentId",
      ),
      sql<string>`coalesce("catr"."slug", "catv"."slug")`.as(
        "catalogComponentSlug",
      ),
      sql<string>`coalesce("catr"."name", "catv"."name")`.as(
        "catalogComponentName",
      ),
      eb.fn.coalesce("pc.n", eb.lit(0)).as("pendingSuggestionCount"),
    ]);

  // `catalog` is a multi-value OR applied at the package-group level.
  if (query.catalog?.length) {
    const linked = sql<SqlBool>`coalesce("catr"."id", "catv"."id") is not null`;
    const unlinked = sql<SqlBool>`coalesce("catr"."id", "catv"."id") is null`;
    grouped = grouped.where((eb) =>
      eb.or(
        query.catalog!.map((state) => {
          if (state === "linked") return linked;
          if (state === "suggested") return eb("pc.n", ">", 0);
          return eb.and([
            unlinked,
            eb.or([eb("pc.n", "is", null), eb("pc.n", "=", 0)]),
          ]);
        }),
      ),
    );
  }
  // Facets are the filter domain — the whole ACTIVE inventory, not the
  // filtered page, so an ecosystem stays selectable when it has no rows.
  const ecosystemFacet = db
    .selectFrom("bom_entries")
    .innerJoin("components", (join) =>
      join
        .onRef("components.id", "=", "bom_entries.componentId")
        .on("components.lifecycle", "=", "ACTIVE"),
    )
    .select("bom_entries.ecosystem")
    .distinct()
    .orderBy("bom_entries.ecosystem")
    .execute();
  const [page, facetRows] = await Promise.all([
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
  ]);
  const facets = {
    ecosystems: facetRows.map((r) => r.ecosystem),
  };

  type GroupRow = {
    purl: string;
    name: string;
    ecosystem: string;
    versionCount: string | number;
    componentCount: string | number;
    catalogComponentId: string | null;
    catalogComponentSlug: string | null;
    catalogComponentName: string | null;
    pendingSuggestionCount: string | number;
  };
  const rows = page.data as GroupRow[];
  if (!rows.length) return { data: [], pagination: page.pagination, facets };

  const versionRows = await db
    .selectFrom("bom_entries")
    .innerJoin("components", (join) =>
      join
        .onRef("components.id", "=", "bom_entries.componentId")
        .on("components.lifecycle", "=", "ACTIVE"),
    )
    .where("bom_entries.purlIdentity", "in", rows.map((r) => r.purl))
    .where("bom_entries.version", "is not", null)
    .groupBy(["bom_entries.purlIdentity", "bom_entries.version"])
    .select((eb) => [
      "bom_entries.purlIdentity as purl",
      "bom_entries.version as version",
      eb.fn.count("bom_entries.componentId").distinct().as("componentCount"),
    ])
    .execute();

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
    facets,
    data: rows.map((r) => ({
      purl: r.purl,
      name: r.name,
      ecosystem: r.ecosystem,
      versionCount: Number(r.versionCount),
      versions: (versionsByPurl.get(r.purl) ?? [])
        .sort((a, b) => b.componentCount - a.componentCount || a.version.localeCompare(b.version))
        .slice(0, 5),
      componentCount: Number(r.componentCount),
      catalogComponent: r.catalogComponentId
        ? {
            id: r.catalogComponentId,
            slug: r.catalogComponentSlug!,
            name: r.catalogComponentName!,
          }
        : null,
      pendingSuggestionCount: Number(r.pendingSuggestionCount),
    })),
  };
}

/**
 * `GET /packages/versions` — every version reported for one identity
 * with its distinct ACTIVE-consumer count (spec 075; Library detail
 * "versions in use" list). `purl` normalizes before matching
 * `purlIdentity`.
 */
export async function listPackageVersions(
  query: ListPackageVersionsQuery,
): Promise<Paginated<PackageVersionListItem>> {
  const identity = normalizePurlIdentity(query.purl) ?? query.purl;

  const grouped = db
    .selectFrom("bom_entries")
    .innerJoin("components", (join) =>
      join
        .onRef("components.id", "=", "bom_entries.componentId")
        .on("components.lifecycle", "=", "ACTIVE"),
    )
    .where("bom_entries.purlIdentity", "=", identity)
    .where("bom_entries.version", "is not", null)
    .groupBy("bom_entries.version")
    .select((eb) => [
      "bom_entries.version",
      eb.fn.count("bom_entries.componentId").distinct().as("componentCount"),
    ]);

  const page = await paginateQuery(
    grouped,
    { page: query.page, pageSize: query.pageSize },
    {
      // Contract: componentCount desc, then version asc.
      orderBy: (qb) =>
        qb.orderBy("componentCount", "desc").orderBy("version", "asc"),
    },
  );

  type Row = { version: string; componentCount: string | number };
  return {
    pagination: page.pagination,
    data: (page.data as Row[]).map((r) => ({
      version: r.version,
      componentCount: Number(r.componentCount),
    })),
  };
}

/**
 * `GET /packages/consumers` — one row per (component, version, scope)
 * reporting the package: merged-view parity with the BOM tab. `purl` is
 * normalized before matching `purlIdentity` (unparseable input falls back
 * to verbatim equality). `direct` is bool_or over the group — a component
 * declaring the package anywhere shows direct (D2). Unknown purls return
 * an empty page, not an error.
 */
export async function listPackageConsumers(
  query: ListPackageConsumersQuery,
): Promise<Paginated<PackageConsumerListItem>> {
  const identity = normalizePurlIdentity(query.purl) ?? query.purl;

  let inner = db
    .selectFrom("bom_entries")
    .innerJoin("components", (join) =>
      join
        .onRef("components.id", "=", "bom_entries.componentId")
        .on("components.lifecycle", "=", "ACTIVE"),
    )
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
    scope: PackageConsumerListItem["scope"];
    direct: boolean;
    lastReportedAt: unknown;
  };

  return {
    pagination: page.pagination,
    data: (page.data as Row[]).map((r) => ({
      component: {
        id: r.componentId,
        slug: r.slug,
        name: r.name,
        category: r.category,
      },
      version: r.version,
      scope: r.scope,
      direct: r.direct,
      lastReportedAt: toIsoTimestamp(r.lastReportedAt),
    })),
  };
}
