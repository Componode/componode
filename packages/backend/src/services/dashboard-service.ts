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
import { lastDisconnectReasons } from "./agent-service.js";

const ATTENTION_LIMIT = 20;
// G5 convention: the credentials UI warns within 30 days of expiresAt —
// CREDENTIAL_EXPIRING uses the same window.
const CREDENTIAL_EXPIRY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DELTA_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface AttentionItem {
  kind:
    | "FAILED_RUN"
    | "PRODUCT_ERROR"
    | "INSTANCE_ERROR"
    | "INSTANCE_GONE"
    | "SUNSET_OVERDUE_PRODUCT"
    | "SUNSET_OVERDUE_COMPONENT"
    | "CREDENTIAL_EXPIRING"
    | "OFFLINE_AGENT";
  label: string;
  // One-line context (spec 040): why the row needs action. Null when the
  // kind has nothing to add beyond the label.
  detail: string | null;
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
  // Rows created in the trailing 7 days, scoped to the same population as
  // the matching headline total (products: all; components: ACTIVE;
  // instances: non-GONE). Spec 040 / G23.
  deltas: {
    products: number;
    components: number;
    instances: number;
  };
  // Importer-related attention items (FAILED_RUN, OFFLINE_AGENT) in the
  // FULL queue — the `attention` array is capped at ATTENTION_LIMIT, so a
  // truthful count must be computed before truncation. Spec 040 / G23.
  importerIssues: number;
  lastImportAt: string | null;
  attention: AttentionItem[];
  lastRuns: ImporterRunStatusRow[];
  coverage: CatalogCoverage;
}

function emptyBreakdown(keys: readonly string[]): Record<string, number> {
  return Object.fromEntries(keys.map((k) => [k, 0]));
}

/** Compact relative-past string for attention detail lines ("2h ago"). */
function relAgo(iso: string | null): string | null {
  if (!iso) return null;
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** "Expired 2d ago" / "Expires in 3d" / "Expires today". */
function expiryDistance(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms < 0) return `Expired ${relAgo(expiresAt) ?? "recently"}`;
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return days <= 1 ? "Expires today" : `Expires in ${days}d`;
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
    .leftJoin("importer_configs", "import_runs.configId", "importer_configs.id")
    .select([
      "import_runs.id as runId",
      "import_runs.configId",
      "importer_configs.label as configLabel",
      "importer_configs.importerName",
      "import_runs.completedAt",
      "import_runs.createdAt",
      "import_runs.errorType",
      "import_runs.errorMessage",
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
      "components.slug as componentSlug",
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

  // Spec 027 US5: an OFFLINE agent that still owns bound configs is an
  // operator action item — its next runs sit queued until it reconnects.
  const offlineAgents = await db
    .selectFrom("import_agents")
    .select(["id", "name", "lastSeenAt"])
    .select((eb) =>
      eb
        .selectFrom("importer_configs")
        .select((eb2) => eb2.fn.countAll<number>().as("n"))
        .whereRef("importer_configs.agentId", "=", "import_agents.id")
        .as("boundConfigCount"),
    )
    .where("status", "=", "OFFLINE")
    .execute();

  // Most recent closed session's disconnect reason per offline agent.
  const offlineReasons = await lastDisconnectReasons(
    offlineAgents.map((a) => a.id),
  );

  // Spec 040 / G24: ACTIVE credentials already past expiresAt or inside
  // the 30-day warning window — the only otherwise-silent failure mode.
  const expiringCredentials = await db
    .selectFrom("credentials")
    .select(["id", "label", "expiresAt"])
    .where("status", "=", "ACTIVE")
    .where("expiresAt", "is not", null)
    .where("expiresAt", "<=", new Date(Date.now() + CREDENTIAL_EXPIRY_WINDOW_MS).toISOString())
    .orderBy("expiresAt", "asc")
    .limit(ATTENTION_LIMIT)
    .execute();

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
      .select(["id", "name", "slug", "sunsetAt"])
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
      detail: `Sunset ${relAgo(p.sunsetAt!.toString()) ?? "passed"}`,
      href: `/products/${p.slug}`,
      at: p.sunsetAt!.toString(),
    })),
    ...sunsetComponents.map((c) => ({
      kind: "SUNSET_OVERDUE_COMPONENT" as const,
      label: c.name,
      detail: `Sunset ${relAgo(c.sunsetAt!.toString()) ?? "passed"}`,
      href: `/components/${c.slug}`,
      at: c.sunsetAt!.toString(),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const attention: AttentionItem[] = [
    ...failedRuns.map((r) => ({
      kind: "FAILED_RUN" as const,
      label: `${r.importerName} / ${r.configLabel}`,
      detail:
        [r.errorType, r.errorMessage].filter(Boolean).join(": ") || null,
      href: `/importers/${r.configId}/runs/${r.runId}`,
      at: (r.completedAt ?? r.createdAt).toString(),
    })),
    ...errorProducts.map((p) => ({
      kind: "PRODUCT_ERROR" as const,
      label: p.name,
      detail: null,
      href: `/products/${p.slug}`,
      at: new Date().toISOString(),
    })),
    ...errorInstances.map((i) => ({
      kind: (i.status === "ERROR" ? "INSTANCE_ERROR" : "INSTANCE_GONE") as AttentionItem["kind"],
      label: i.componentName,
      detail: ((seen) =>
        [i.status, seen ? `last seen ${seen}` : null]
          .filter(Boolean)
          .join(" · "))(relAgo(i.lastSeenAt?.toString() ?? null)),
      href: `/components/${i.componentSlug}`,
      at: i.lastSeenAt?.toString() ?? new Date().toISOString(),
    })),
    ...offlineAgents
      .filter((a) => Number(a.boundConfigCount) > 0)
      .map((a) => ({
        kind: "OFFLINE_AGENT" as const,
        label: a.name,
        detail:
          [
            a.lastSeenAt
              ? `Last heartbeat ${relAgo(a.lastSeenAt.toString())}`
              : "No recent contact",
            offlineReasons.get(a.id) ?? null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        href: `/agents/${a.id}`,
        at: new Date().toISOString(),
      })),
    // Spec 040 / G24: actionable expiry warning — ranks below the
    // operational failure kinds, above the display-only sunset items
    // (ADR-116 ranking precedent); ordered by soonest expiresAt.
    ...expiringCredentials.map((c) => ({
      kind: "CREDENTIAL_EXPIRING" as const,
      label: c.label,
      detail: expiryDistance(c.expiresAt!),
      href: `/credentials/${c.id}`,
      at: c.expiresAt!.toString(),
    })),
    // Spec 023 FR-007/FR-008: overdue sunsets rank below every operational
    // kind — display-only (ADR-111: passing sunsetAt changes nothing).
    ...sunsetItems,
  ].slice(0, ATTENTION_LIMIT);

  // Spec 040 / G23: importer-issue count over the untruncated queue — the
  // `attention` slice above may hide OFFLINE_AGENT rows behind >20
  // higher-ranked items, so the frontend cannot derive this itself.
  const [failedRunCnt, offlineAgentCnt] = await Promise.all([
    db
      .selectFrom("import_runs")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("status", "=", "FAILED")
      .executeTakeFirst(),
    db
      .selectFrom("import_agents")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("status", "=", "OFFLINE")
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom("importer_configs")
            .select("importer_configs.id")
            .whereRef("importer_configs.agentId", "=", "import_agents.id"),
        ),
      )
      .executeTakeFirst(),
  ]);
  const importerIssues =
    Number(failedRunCnt?.n ?? 0) + Number(offlineAgentCnt?.n ?? 0);

  // Spec 040 / G23: trailing-7-day created counts, each scoped to the same
  // population as its headline total (products: all rows — the total
  // applies no lifecycle filter; components: ACTIVE; instances: non-GONE).
  const deltaSince = new Date(Date.now() - DELTA_WINDOW_MS).toISOString();
  const [dProducts, dComponents, dInstances] = await Promise.all([
    db
      .selectFrom("digital_products")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("createdAt", ">=", deltaSince)
      .executeTakeFirst(),
    db
      .selectFrom("components")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("lifecycle", "=", "ACTIVE")
      .where("createdAt", ">=", deltaSince)
      .executeTakeFirst(),
    db
      .selectFrom("component_instances")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("status", "!=", "GONE")
      .where("createdAt", ">=", deltaSince)
      .executeTakeFirst(),
  ]);

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
    deltas: {
      products: Number(dProducts?.n ?? 0),
      components: Number(dComponents?.n ?? 0),
      instances: Number(dInstances?.n ?? 0),
    },
    importerIssues,
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
