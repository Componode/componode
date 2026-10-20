import { db } from "../db/connection.js";
import {
  PRODUCT_TYPES,
  INSTANCE_STATUS,
  COMPONENT_LIFECYCLE,
  type CatalogCoverage,
} from "@componode/core";
import { computeHealthForProducts } from "./product-health-service.js";
import {
  getCatalogCoverage,
  coveragePopulationPredicate,
} from "./catalog-coverage-service.js";

const ATTENTION_LIMIT = 20;

export interface AttentionItem {
  kind:
    | "FAILED_RUN"
    | "PRODUCT_ERROR"
    | "INSTANCE_ERROR"
    | "INSTANCE_GONE"
    | "SUNSET_OVERDUE_PRODUCT"
    | "SUNSET_OVERDUE_COMPONENT";
  label: string;
  href: string;
  at: string;
}

export interface ImporterRunStatusRow {
  configId: string;
  importerName: string;
  configLabel: string;
  runId: string | null;
  status: string | null;
  completedAt: string | null;
  assetsProcessed: number;
  assetsCreated: number;
  assetsUpdated: number;
}

export interface DashboardSummary {
  counts: {
    products: { total: number; byType: Record<string, number> };
    components: { total: number; byLifecycle: Record<string, number> };
    instances: { total: number; byStatus: Record<string, number> };
  };
  lastImportAt: string | null;
  attention: AttentionItem[];
  lastRuns: ImporterRunStatusRow[];
  coverage: CatalogCoverage;
}

function emptyBreakdown(keys: readonly string[]): Record<string, number> {
  return Object.fromEntries(keys.map((k) => [k, 0]));
}

/**
 * Read-only aggregates for the health-and-attention dashboard
 * (spec 004 / contracts/api.md). Side-effect-free GET (ADR-094);
 * Kysely parameterized only (ADR-084).
 */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const [productRows, componentRows, instanceRows] = await Promise.all([
    db
      .selectFrom("digital_products")
      .select(["type", (eb) => eb.fn.count("id").as("count")])
      .groupBy("type")
      .execute(),
    db
      .selectFrom("components")
      .select(["lifecycle", (eb) => eb.fn.count("id").as("count")])
      .groupBy("lifecycle")
      .execute(),
    db
      .selectFrom("component_instances")
      .select(["status", (eb) => eb.fn.count("id").as("count")])
      .groupBy("status")
      .execute(),
  ]);

  const byType = emptyBreakdown(PRODUCT_TYPES);
  for (const r of productRows) byType[r.type] = Number(r.count);

  const byLifecycle = emptyBreakdown(COMPONENT_LIFECYCLE);
  for (const r of componentRows) byLifecycle[r.lifecycle] = Number(r.count);

  const byStatus = emptyBreakdown(INSTANCE_STATUS);
  for (const r of instanceRows) byStatus[r.status] = Number(r.count);

  // Headline totals exclude RETIRED components / GONE instances (constitution IV)
  const productsTotal = productRows.reduce((s, r) => s + Number(r.count), 0);
  const componentsTotal = byLifecycle["ACTIVE"] ?? 0;
  const instancesTotal = (byStatus["RUNNING"] ?? 0) + (byStatus["STOPPED"] ?? 0) + (byStatus["ERROR"] ?? 0);

  const lastRun = await db
    .selectFrom("import_runs")
    .select("completedAt")
    .where("completedAt", "is not", null)
    .orderBy("completedAt", "desc")
    .executeTakeFirst();

  // Attention: failed runs first, then ERROR instances, then GONE instances.
  const failedRuns = await db
    .selectFrom("import_runs")
    .innerJoin("importer_configs", "import_runs.configId", "importer_configs.id")
    .select([
      "import_runs.id as runId",
      "import_runs.configId",
      "importer_configs.label as configLabel",
      "importer_configs.importerName",
      "import_runs.completedAt",
      "import_runs.createdAt",
    ])
    .where("import_runs.status", "=", "FAILED")
    .orderBy("import_runs.createdAt", "desc")
    .limit(ATTENTION_LIMIT)
    .execute();

  const errorInstances = await db
    .selectFrom("component_instances")
    .innerJoin("components", "component_instances.componentId", "components.id")
    .select([
      "components.id as componentId",
      "components.name as componentName",
      "component_instances.status",
      "component_instances.lastSeenAt",
    ])
    .where("component_instances.status", "in", ["ERROR", "GONE"])
    .orderBy("component_instances.lastSeenAt", "desc")
    .limit(ATTENTION_LIMIT)
    .execute();

  // ADR-112/spec 019: products whose derived health is ERROR. Product-level
  // "is my product affected" ranks below failed importer runs but above raw
  // instance noise. Derived health has no event timestamp — `at` is the
  // observation time.
  const allProducts = await db
    .selectFrom("digital_products")
    .select(["id", "name", "slug", "updatedAt"])
    .where("lifecycle", "!=", "RETIRED")
    .execute();
  const healthByProduct = await computeHealthForProducts(
    allProducts.map((p) => p.id),
  );
  const errorProducts = allProducts.filter(
    (p) => healthByProduct.get(p.id)?.status === "ERROR",
  );

  const [sunsetProducts, sunsetComponents] = await Promise.all([
    db
      .selectFrom("digital_products")
      .select(["name", "slug", "sunsetAt"])
      .where("lifecycle", "=", "ACTIVE")
      .where("sunsetAt", "<", new Date().toISOString())
      .orderBy("sunsetAt", "asc")
      .execute(),
    db
      .selectFrom("components")
      .select(["id", "name", "sunsetAt"])
      // Spec 023 edge case: gone-only components are invisible to every
      // coverage surface — the shared population predicate covers both the
      // ACTIVE and not-gone-only halves.
      .where((eb) => coveragePopulationPredicate(eb))
      .where("sunsetAt", "<", new Date().toISOString())
      .orderBy("sunsetAt", "asc")
      .execute(),
  ]);
  const sunsetItems: AttentionItem[] = [
    ...sunsetProducts.map((p) => ({
      kind: "SUNSET_OVERDUE_PRODUCT" as const,
      label: p.name,
      href: `/products/${p.slug}`,
      at: p.sunsetAt!.toString(),
    })),
    ...sunsetComponents.map((c) => ({
      kind: "SUNSET_OVERDUE_COMPONENT" as const,
      label: c.name,
      href: `/components/${c.id}`,
      at: c.sunsetAt!.toString(),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const attention: AttentionItem[] = [
    ...failedRuns.map((r) => ({
      kind: "FAILED_RUN" as const,
      label: `${r.importerName} / ${r.configLabel}`,
      href: `/importers/${r.configId}/runs/${r.runId}`,
      at: (r.completedAt ?? r.createdAt).toString(),
    })),
    ...errorProducts.map((p) => ({
      kind: "PRODUCT_ERROR" as const,
      label: p.name,
      href: `/products/${p.slug}`,
      at: new Date().toISOString(),
    })),
    ...errorInstances.map((i) => ({
      kind: (i.status === "ERROR" ? "INSTANCE_ERROR" : "INSTANCE_GONE") as AttentionItem["kind"],
      label: i.componentName,
      href: `/components/${i.componentId}`,
      at: i.lastSeenAt?.toString() ?? "",
    })),
    // Spec 023 FR-007/FR-008: overdue sunsets rank below every operational
    // kind — display-only (ADR-111: passing sunsetAt changes nothing).
    ...sunsetItems,
  ].slice(0, ATTENTION_LIMIT);

  // Latest run per importer config.
  const lastRuns = await db
    .selectFrom("importer_configs")
    .leftJoin("import_runs", (join) =>
      join
        .onRef("import_runs.configId", "=", "importer_configs.id")
        .on("import_runs.id", "=", (eb) =>
          eb
            .selectFrom("import_runs as r2")
            .select("r2.id")
            .whereRef("r2.configId", "=", "importer_configs.id")
            .orderBy("r2.createdAt", "desc")
            .limit(1),
        ),
    )
    .select([
      "importer_configs.id as configId",
      "importer_configs.importerName",
      "importer_configs.label as configLabel",
      "import_runs.id as runId",
      "import_runs.status",
      "import_runs.completedAt",
      "import_runs.assetsProcessed",
      "import_runs.assetsCreated",
      "import_runs.assetsUpdated",
    ])
    .orderBy("importer_configs.label")
    .execute();

  return {
    counts: {
      products: { total: productsTotal, byType },
      components: { total: componentsTotal, byLifecycle },
      instances: { total: instancesTotal, byStatus },
    },
    lastImportAt: lastRun?.completedAt?.toString() ?? null,
    attention,
    coverage: await getCatalogCoverage(),
    lastRuns: lastRuns.map((r) => ({
      configId: r.configId,
      importerName: r.importerName,
      configLabel: r.configLabel,
      runId: r.runId ?? null,
      status: r.status ?? null,
      completedAt: r.completedAt?.toString() ?? null,
      assetsProcessed: r.assetsProcessed ?? 0,
      assetsCreated: r.assetsCreated ?? 0,
      assetsUpdated: r.assetsUpdated ?? 0,
    })),
  };
}
