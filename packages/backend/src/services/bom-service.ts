import type { Kysely, Selectable } from "kysely";
import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import { db } from "../db/connection.js";
import type { BomEntryRow, DB } from "../db/types.js";
import type {
  BomEntryListItem,
  BomSummary,
  DiscoveredBomEntry,
  ListBomQuery,
  Paginated,
} from "@componode/core";
import { normalizePurlIdentity, purlEcosystem } from "@componode/core";
import { paginateQuery, sortTarget, type OrderTarget } from "../utils/pagination.js";
import { toIsoTimestamp } from "../db/timestamps.js";
import { getBomStaleThresholdDays } from "./settings-service.js";

// Spec 073 / ADR-131 — the BOM write path. Entries are factual importer
// observations upserted per-asset during the run and key-matched-replaced
// at run completion, source-scoped. Upsert keys mirror migration 032's two
// partial unique indexes: `(componentId, purl, scope, componentInstanceId)`
// for top-level rows, plus `parentBomEntryId` for children.

export interface BomScope {
  componentId: string;
  componentInstanceId: string | null;
}

export interface BomProcessResult {
  created: number;
  updated: number;
  unchanged: number;
}

interface ProcessBomOptions {
  componentId: string;
  componentInstanceId: string | null;
  sourceId: string | null;
  runId: string;
  entries: DiscoveredBomEntry[];
}

// The mutable payload compared to decide updated-vs-unchanged. Keys and
// identity columns are excluded — they select the row.
function payloadOf(entry: DiscoveredBomEntry, scope: string, direct: boolean) {
  return {
    name: entry.name,
    version: entry.version ?? null,
    ecosystem: purlEcosystem(entry.purl) ?? "unknown",
    scope,
    evidenceSource: entry.evidenceSource,
    evidenceDetail: entry.evidenceDetail ?? null,
    supplier: entry.supplier ?? null,
    licenses: entry.licenses ?? [],
    direct,
    cdxType: entry.cdxType ?? null,
    cdxBomRef: entry.cdxBomRef ?? null,
    details: entry.details ?? null,
  };
}

function samePayload(
  row: Record<string, unknown>,
  payload: ReturnType<typeof payloadOf>,
): boolean {
  return (
    row.name === payload.name &&
    row.version === payload.version &&
    row.ecosystem === payload.ecosystem &&
    row.scope === payload.scope &&
    row.evidenceSource === payload.evidenceSource &&
    row.evidenceDetail === payload.evidenceDetail &&
    row.supplier === payload.supplier &&
    JSON.stringify(row.licenses) === JSON.stringify(payload.licenses) &&
    row.direct === payload.direct &&
    row.cdxType === payload.cdxType &&
    row.cdxBomRef === payload.cdxBomRef &&
    JSON.stringify(row.details) === JSON.stringify(payload.details)
  );
}

/**
 * Upserts the reported BOM tree for one `(componentId, componentInstanceId)`
 * scope inside the per-asset run transaction. Top-down so children bind the
 * freshly upserted parent id. `direct` defaults to `scope !== 'TRANSITIVE'`;
 * an explicit `direct` always wins (authoritative, ADR-131).
 */
export async function processBomEntries(
  trx: Kysely<DB>,
  opts: ProcessBomOptions,
): Promise<BomProcessResult> {
  const result: BomProcessResult = { created: 0, updated: 0, unchanged: 0 };
  const now = new Date().toISOString();

  const upsert = async (
    entry: DiscoveredBomEntry,
    parentBomEntryId: string | null,
  ): Promise<string> => {
    const scope = entry.scope ?? "RUNTIME";
    // `direct` is authoritative — only default when absent.
    const direct = entry.direct ?? scope !== "TRANSITIVE";
    const payload = payloadOf(entry, scope, direct);

    let keyQuery = trx
      .selectFrom("bom_entries")
      .selectAll()
      .where("componentId", "=", opts.componentId)
      .where("purl", "=", entry.purl)
      .where("scope", "=", scope);
    keyQuery =
      opts.componentInstanceId === null
        ? keyQuery.where("componentInstanceId", "is", null)
        : keyQuery.where("componentInstanceId", "=", opts.componentInstanceId);
    keyQuery =
      parentBomEntryId === null
        ? keyQuery.where("parentBomEntryId", "is", null)
        : keyQuery.where("parentBomEntryId", "=", parentBomEntryId);
    const existing = await keyQuery.executeTakeFirst();

    const id = existing?.id ?? uuidv7();
    const insert = trx
      .insertInto("bom_entries")
      .values({
        id,
        componentId: opts.componentId,
        componentInstanceId: opts.componentInstanceId,
        parentBomEntryId,
        purl: entry.purl,
        // Spec 074: normalized version-free identity — grouping key for the
        // /packages rollup, match key for consumers, Phase-2 join target.
        // Insert-only: purl is an upsert key so identity cannot change on
        // conflict. Verbatim fallback when the purl fails to parse.
        purlIdentity: normalizePurlIdentity(entry.purl) ?? entry.purl,
        ...payload,
        // pg serializes JS arrays as Postgres array literals, not JSON —
        // stringify so jsonb stores a real array ('[]' → '{}' otherwise).
        licenses: JSON.stringify(payload.licenses),
        lastReportedAt: now,
        importRunId: opts.runId,
        sourceId: opts.sourceId,
        resolvedComponentId: null,
        createdAt: now,
        updatedAt: now,
      });

    const conflictColumns =
      parentBomEntryId === null
        ? (["componentId", "purl", "scope", "componentInstanceId"] as const)
        : ([
            "componentId",
            "purl",
            "scope",
            "componentInstanceId",
            "parentBomEntryId",
          ] as const);

    await insert
      .onConflict((oc) =>
        oc
          .columns([...conflictColumns])
          .where("parentBomEntryId", parentBomEntryId === null ? "is" : "is not", null)
          .doUpdateSet({
            ...payload,
            licenses: JSON.stringify(payload.licenses),
            lastReportedAt: now,
            importRunId: opts.runId,
            sourceId: opts.sourceId,
            updatedAt: now,
          }),
      )
      .execute();

    if (!existing) result.created++;
    else if (samePayload(existing, payload)) result.unchanged++;
    else result.updated++;

    for (const child of entry.children ?? []) {
      await upsert(child, id);
    }
    return id;
  };

  for (const entry of opts.entries) {
    await upsert(entry, null);
  }
  return result;
}

/**
 * Source-scoped diff-replace (ADR-131). Runs only on COMPLETED runs, once per
 * reported `(componentId, componentInstanceId)` scope — including scopes that
 * reported `[]` (present-but-empty clears the set). Deletes the source's rows
 * in those scopes whose `importRunId` is stale. Returns rows removed.
 */
export async function deleteAbsentBomEntries(
  trx: Kysely<DB>,
  scopes: BomScope[],
  sourceId: string | null,
  runId: string,
): Promise<number> {
  let removed = 0;
  for (const scope of scopes) {
    let q = trx
      .deleteFrom("bom_entries")
      .where("componentId", "=", scope.componentId)
      .where((eb) =>
        eb("importRunId", "is", null).or("importRunId", "!=", runId),
      );
    q =
      sourceId === null
        ? q.where("sourceId", "is", null)
        : q.where("sourceId", "=", sourceId);
    q =
      scope.componentInstanceId === null
        ? q.where("componentInstanceId", "is", null)
        : q.where("componentInstanceId", "=", scope.componentInstanceId);
    const res = await q.executeTakeFirst();
    removed += Number(res.numDeletedRows ?? 0);
  }
  return removed;
}

// ---- Read path (US2) -------------------------------------------------------

type BomReadRow = Selectable<BomEntryRow> & {
  srcId: string | null;
  srcName: string | null;
};

// Sort whitelist mirrors listBomQuerySchema's enum (ADR-130). Targets are
// unqualified — the scoped read sorts bom_entries columns directly and the
// merged read's outer select re-aliases them under the same names.
const BOM_SORT: Record<string, OrderTarget> = {
  name: "name",
  version: "version",
  scope: "scope",
  ecosystem: "ecosystem",
  lastReportedAt: "lastReportedAt",
};

/**
 * Filtered row set shared by all read shapes: search across name/purl/
 * licences, CSV OR filters, `direct`, plus the view selectors
 * (`instanceId` scoped view, `parentId` children, `view=tree` top-level).
 * `catalog` is accepted by the schema and ignored — Phase 2 (contracts).
 */
function filteredBomRows(componentId: string, query: ListBomQuery) {
  let q = db
    .selectFrom("bom_entries")
    .leftJoin(
      "importer_sources",
      "importer_sources.id",
      "bom_entries.sourceId",
    )
    .selectAll("bom_entries")
    .select((eb) => [
      "importer_sources.id as srcId",
      eb.fn
        .coalesce("importer_sources.label", "importer_sources.externalIdentity")
        .as("srcName"),
    ])
    .where("bom_entries.componentId", "=", componentId);

  if (query.search) {
    const like = `%${query.search}%`;
    q = q.where((eb) =>
      eb.or([
        eb("bom_entries.name", "ilike", like),
        eb("bom_entries.purl", "ilike", like),
        // licences are jsonb — text-cast keeps the match parameterized.
        eb(sql`bom_entries.licenses::text`, "ilike", like),
      ]),
    );
  }
  if (query.scope?.length) {
    q = q.where("bom_entries.scope", "in", query.scope);
  }
  if (query.ecosystem?.length) {
    q = q.where("bom_entries.ecosystem", "in", query.ecosystem);
  }
  if (query.found?.length) {
    q = q.where("bom_entries.evidenceSource", "in", query.found);
  }
  if (query.direct !== undefined) {
    q = q.where("bom_entries.direct", "=", query.direct);
  }
  if (query.instanceId) {
    q = q.where("bom_entries.componentInstanceId", "=", query.instanceId);
  }
  if (query.parentId) {
    q = q.where("bom_entries.parentBomEntryId", "=", query.parentId);
  } else if (query.view === "tree") {
    q = q.where("bom_entries.parentBomEntryId", "is", null);
  }
  return q;
}

function toListItem(
  row: BomReadRow,
  extras: {
    instanceCount: number;
    instanceTotal: number;
    hasChildren: boolean;
    childCount: number;
    parentName?: string | null;
  },
): BomEntryListItem {
  return {
    id: row.id,
    purl: row.purl,
    name: row.name,
    version: row.version,
    ecosystem: row.ecosystem,
    scope: row.scope as BomEntryListItem["scope"],
    direct: row.direct,
    evidenceSource: row.evidenceSource as BomEntryListItem["evidenceSource"],
    evidenceDetail: row.evidenceDetail,
    licenses: Array.isArray(row.licenses) ? (row.licenses as string[]) : [],
    supplier: row.supplier,
    cdxType: row.cdxType as BomEntryListItem["cdxType"],
    source: row.srcId ? { id: row.srcId, name: row.srcName ?? "" } : null,
    lastReportedAt: toIsoTimestamp(row.lastReportedAt),
    parentId: row.parentBomEntryId,
    parentName: extras.parentName ?? null,
    hasChildren: extras.hasChildren,
    childCount: extras.childCount,
    instanceCount: extras.instanceCount,
    instanceTotal: extras.instanceTotal,
    resolvedComponent: null,
    pendingSuggestionId: null,
  };
}

async function bomBearingInstanceTotal(componentId: string): Promise<number> {
  const row = await db
    .selectFrom("bom_entries")
    .where("componentId", "=", componentId)
    .where("componentInstanceId", "is not", null)
    .select((eb) =>
      eb.fn.count("componentInstanceId").distinct().as("n"),
    )
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

/** Display names for the page's distinct parents ("in {parent}", UX-BOM-04). */
async function parentNames(rows: BomReadRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.parentBomEntryId).filter(Boolean))];
  if (!ids.length) return new Map();
  const parents = await db
    .selectFrom("bom_entries")
    .where("id", "in", ids as string[])
    .select(["id", "name"])
    .execute();
  return new Map(parents.map((p) => [p.id, p.name]));
}

/**
 * Scoped read — instance view and lazy children return raw rows (no merge);
 * `instanceCount` reflects the row's own scope truthfully.
 */
async function listScopedBom(
  componentId: string,
  query: ListBomQuery,
): Promise<Paginated<BomEntryListItem>> {
  const filtered = filteredBomRows(componentId, query);
  const page = await paginateQuery(
    filtered,
    { page: query.page, pageSize: query.pageSize },
    {
      orderBy: (qb) =>
        qb
          .orderBy(
            sortTarget(BOM_SORT, query.sort, "bom_entries.name"),
            query.order,
          )
          .orderBy("bom_entries.id", query.order),
    },
  );
  const rows = page.data as BomReadRow[];

  const parentIds = rows.map((r) => r.id);
  const [childCounts, names, instanceTotal] = await Promise.all([
    parentIds.length
      ? db
          .selectFrom("bom_entries")
          .where("parentBomEntryId", "in", parentIds)
          .groupBy("parentBomEntryId")
          .select(["parentBomEntryId", (eb) => eb.fn.countAll().as("n")])
          .execute()
      : Promise.resolve([]),
    parentNames(rows),
    bomBearingInstanceTotal(componentId),
  ]);
  const childByParent = new Map(
    childCounts.map((r) => [r.parentBomEntryId as string, Number(r.n)]),
  );

  return {
    pagination: page.pagination,
    data: rows.map((row) =>
      toListItem(row, {
        instanceCount: row.componentInstanceId ? 1 : 0,
        instanceTotal,
        hasChildren: (childByParent.get(row.id) ?? 0) > 0,
        childCount: childByParent.get(row.id) ?? 0,
        parentName: row.parentBomEntryId
          ? (names.get(row.parentBomEntryId) ?? null)
          : null,
      }),
    ),
  };
}

/**
 * Merged view (contracts/bom-api.md): one row per `(purl, version, scope)`
 * across sources and instance scopes — the representative row is the most
 * recently reported (DISTINCT ON), `instanceCount` counts distinct
 * BOM-bearing instances per key, `instanceTotal` the component's total.
 */
export async function getBomForComponent(
  componentId: string,
  query: ListBomQuery,
): Promise<Paginated<BomEntryListItem>> {
  if (query.instanceId || query.parentId) {
    return listScopedBom(componentId, query);
  }

  const inner = filteredBomRows(componentId, query)
    .distinctOn(["bom_entries.purl", "bom_entries.version", "bom_entries.scope"])
    .orderBy("bom_entries.purl")
    .orderBy("bom_entries.version")
    .orderBy("bom_entries.scope")
    .orderBy("bom_entries.lastReportedAt", "desc");

  const filtered = db.selectFrom(inner.as("merged")).selectAll();
  const page = await paginateQuery(
    filtered,
    { page: query.page, pageSize: query.pageSize },
    {
      orderBy: (qb) =>
        qb
          .orderBy(sortTarget(BOM_SORT, query.sort, "name"), query.order)
          .orderBy("id", query.order),
    },
  );
  const rows = page.data as BomReadRow[];
  if (!rows.length) {
    return { data: [], pagination: page.pagination };
  }

  // One grouped pass over the component's entries yields both merged-row
  // extras: distinct-instance counts and child counts per (purl, version,
  // scope). NULL version groups correctly — it's the same key the write
  // path's NULLS NOT DISTINCT index dedupes on.
  const [groupStats, names, instanceTotal] = await Promise.all([
    db
      .selectFrom("bom_entries")
      .leftJoin("bom_entries as c", (join) =>
        join.onRef("c.parentBomEntryId", "=", "bom_entries.id"),
      )
      .where("bom_entries.componentId", "=", componentId)
      .groupBy([
        "bom_entries.purl",
        "bom_entries.version",
        "bom_entries.scope",
      ])
      .select((eb) => [
        "bom_entries.purl as purl",
        "bom_entries.version as version",
        "bom_entries.scope as scope",
        eb.fn
          .count("bom_entries.componentInstanceId")
          .distinct()
          .as("instances"),
        eb.fn.count("c.id").as("children"),
      ])
      .execute(),
    parentNames(rows),
    bomBearingInstanceTotal(componentId),
  ]);

  const keyOf = (r: { purl: string; version: string | null; scope: string }) =>
    `${r.purl}${r.version ?? ""}${r.scope}`;
  const instByKey = new Map(
    groupStats.map((r) => [keyOf(r), Number(r.instances)]),
  );
  const childByKey = new Map(
    groupStats.map((r) => [keyOf(r), Number(r.children)]),
  );

  return {
    pagination: page.pagination,
    data: rows.map((row) => {
      const k = keyOf(row);
      const childCount = childByKey.get(k) ?? 0;
      return toListItem(row, {
        instanceCount: instByKey.get(k) ?? 0,
        instanceTotal,
        hasChildren: childCount > 0,
        childCount,
        parentName: row.parentBomEntryId
          ? (names.get(row.parentBomEntryId) ?? null)
          : null,
      });
    }),
  };
}

/**
 * `GET /component-instances/:id/bom` — exactly that instance's rows.
 * Returns null on an unknown instance (route renders 404, UX-STATE-10).
 * `instanceTotal` stays component-level via the resolved componentId.
 */
export async function getBomForInstance(
  instanceId: string,
  query: ListBomQuery,
): Promise<Paginated<BomEntryListItem> | null> {
  const instance = await db
    .selectFrom("component_instances")
    .select("componentId")
    .where("id", "=", instanceId)
    .executeTakeFirst();
  if (!instance) return null;
  return listScopedBom(instance.componentId, { ...query, instanceId });
}

/**
 * Summary for the tab strip / pickers (contracts/bom-api.md). `sources[]`
 * and `instances[]` stay component-level even when `instanceId` scopes the
 * totals — freshness is a component property and the picker always lists
 * every BOM-bearing instance.
 */
export async function getBomSummary(
  componentId: string,
  instanceId?: string,
): Promise<BomSummary> {
  let scoped = db
    .selectFrom("bom_entries")
    .where("componentId", "=", componentId);
  if (instanceId) {
    scoped = scoped.where("componentInstanceId", "=", instanceId);
  }
  const rows = await scoped
    .select([
      "scope",
      "ecosystem",
      "licenses",
      "direct",
      "parentBomEntryId",
      "lastReportedAt",
    ])
    .execute();

  const ecosystems = [...new Set(rows.map((r) => r.ecosystem))].sort();
  const licenseSet = new Set<string>();
  for (const r of rows) {
    if (Array.isArray(r.licenses)) {
      for (const l of r.licenses as string[]) licenseSet.add(l);
    }
  }
  const lastReportedAt = rows.reduce<string | null>(
    (acc, r) => {
      const t = toIsoTimestamp(r.lastReportedAt);
      return acc === null || t > acc ? t : acc;
    },
    null,
  );

  const [sources, instances, staleThresholdDays] = await Promise.all([
    db
      .selectFrom("bom_entries")
      .innerJoin(
        "importer_sources",
        "importer_sources.id",
        "bom_entries.sourceId",
      )
      .where("bom_entries.componentId", "=", componentId)
      .groupBy([
        "importer_sources.id",
        "importer_sources.label",
        "importer_sources.externalIdentity",
        "importer_sources.importerName",
      ])
      .select((eb) => [
        "importer_sources.id as id",
        eb.fn
          .coalesce(
            "importer_sources.label",
            "importer_sources.externalIdentity",
          )
          .as("name"),
        "importer_sources.importerName as importerKind",
        eb.fn.max("bom_entries.lastReportedAt").as("lastReportedAt"),
      ])
      .orderBy("name")
      .execute(),
    db
      .selectFrom("bom_entries")
      .innerJoin(
        "component_instances",
        "component_instances.id",
        "bom_entries.componentInstanceId",
      )
      .where("bom_entries.componentId", "=", componentId)
      .where("bom_entries.componentInstanceId", "is not", null)
      .groupBy([
        "component_instances.id",
        "component_instances.slug",
        "component_instances.environment",
      ])
      .select((eb) => [
        "component_instances.id as id",
        "component_instances.slug as name",
        "component_instances.environment as environment",
        eb.fn.countAll().as("entryCount"),
      ])
      .orderBy("component_instances.slug")
      .execute(),
    getBomStaleThresholdDays(),
  ]);

  return {
    total: rows.length,
    direct: rows.filter((r) => r.direct).length,
    ecosystems,
    licenseCount: licenseSet.size,
    hasNesting: rows.some((r) => r.parentBomEntryId !== null),
    lastReportedAt,
    staleThresholdDays,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      importerKind: s.importerKind,
      lastReportedAt: toIsoTimestamp(s.lastReportedAt),
    })),
    instances: instances.map((i) => ({
      id: i.id,
      name: i.name,
      environment: i.environment,
      entryCount: Number(i.entryCount),
    })),
  };
}
