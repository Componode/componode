import { sql } from "kysely";
import { db } from "../db/connection.js";

export interface SearchHit {
  id: string;
  name: string;
  slug: string | null;
  kind: "component" | "product" | "group" | "importer" | "lob" | "team" | "package";
  href: string;
}

export interface SearchResults {
  components: SearchHit[];
  products: SearchHit[];
  groups: SearchHit[];
  importers: SearchHit[];
  lobs: SearchHit[];
  teams: SearchHit[];
  packages: SearchHit[];
}

/**
 * Global search behind the Ctrl+K palette (spec 004 / contracts/api.md).
 * Case-insensitive prefix match on name/slug, mirroring spec 003 semantics.
 * RETIRED entities excluded (constitution IV). Read-only (ADR-094);
 * Kysely parameterized only (ADR-084).
 */
export async function globalSearch(q: string, limit: number): Promise<SearchResults> {
  const term = q.trim();
  const like = `${term}%`;

  const [components, products, groups, importers, lobs, teams, packages] = await Promise.all([
    db
      .selectFrom("components")
      .select(["id", "name", "slug"])
      .where("lifecycle", "!=", "RETIRED")
      .where((eb) => eb.or([eb("name", "ilike", like), eb("slug", "ilike", like)]))
      .orderBy("name")
      .limit(limit)
      .execute(),
    db
      .selectFrom("digital_products")
      .select(["id", "name", "slug"])
      .where("lifecycle", "!=", "RETIRED")
      .where((eb) => eb.or([eb("name", "ilike", like), eb("slug", "ilike", like)]))
      .orderBy("name")
      .limit(limit)
      .execute(),
    db
      .selectFrom("component_groups")
      .select(["id", "name", "slug"])
      .where("lifecycle", "!=", "RETIRED")
      .where((eb) => eb.or([eb("name", "ilike", like), eb("slug", "ilike", like)]))
      .orderBy("name")
      .limit(limit)
      .execute(),
    db
      .selectFrom("importer_configs")
      .select(["id", "label", "importerName"])
      .where((eb) =>
        eb.or([eb("label", "ilike", like), eb("importerName", "ilike", like)]),
      )
      .orderBy("label")
      .limit(limit)
      .execute(),
    // Spec 005: org entities are searchable; persons are not (admin-managed).
    db
      .selectFrom("line_of_businesses")
      .select(["id", "name", "slug"])
      .where((eb) => eb.or([eb("name", "ilike", like), eb("slug", "ilike", like)]))
      .orderBy("name")
      .limit(limit)
      .execute(),
    db
      .selectFrom("teams")
      .select(["id", "name", "slug"])
      .where((eb) => eb.or([eb("name", "ilike", like), eb("slug", "ilike", like)]))
      .orderBy("name")
      .limit(limit)
      .execute(),
    // Spec 074: package rollup for the Ctrl+K Packages group — same
    // purlIdentity grouping as GET /packages, most-consumed first.
    db
      .selectFrom("bom_entries")
      .innerJoin("components", (join) =>
        join
          .onRef("components.id", "=", "bom_entries.componentId")
          .on("components.lifecycle", "=", "ACTIVE"),
      )
      .where((eb) =>
        eb.or([
          eb("bom_entries.name", "ilike", like),
          eb("bom_entries.purlIdentity", "ilike", like),
        ]),
      )
      .groupBy(["bom_entries.purlIdentity", "bom_entries.ecosystem"])
      .select((eb) => [
        "bom_entries.purlIdentity as purl",
        sql<string>`(array_agg(bom_entries.name ORDER BY bom_entries."lastReportedAt" DESC))[1]`.as(
          "name",
        ),
        "bom_entries.ecosystem as ecosystem",
        eb.fn.count("bom_entries.componentId").distinct().as("componentCount"),
      ])
      .orderBy("componentCount", "desc")
      .orderBy("purl")
      // Palette Packages group is spec'd at top 5 regardless of `limit`.
      .limit(Math.min(limit, 5))
      .execute(),
  ]);

  return {
    components: components.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      kind: "component",
      href: `/components/${c.id}`,
    })),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      kind: "product",
      href: `/products/${p.slug}`,
    })),
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      kind: "group",
      href: `/component-groups`,
    })),
    importers: importers.map((i) => ({
      id: i.id,
      name: i.label,
      slug: i.importerName,
      kind: "importer",
      href: `/importers`,
    })),
    lobs: lobs.map((l) => ({
      id: l.id,
      name: l.name,
      slug: l.slug,
      kind: "lob",
      href: `/lobs`,
    })),
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      kind: "team",
      href: `/teams`,
    })),
    // `{name} · {ecosystem} · {n} component(s)`; deep link into /packages.
    packages: packages.map((p) => ({
      id: p.purl,
      name: `${p.name} · ${p.ecosystem} · ${p.componentCount} ${Number(p.componentCount) === 1 ? "component" : "components"}`,
      slug: p.purl,
      kind: "package",
      href: `/packages?q=${encodeURIComponent(p.purl)}`,
    })),
  };
}
