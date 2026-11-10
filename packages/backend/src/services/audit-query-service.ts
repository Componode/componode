import { sql, type SelectQueryBuilder } from "kysely";
import { db } from "../db/connection.js";
import type { DB } from "../db/types.js";
import { isUuid } from "../utils/ids.js";
import { paginateQuery, paginationMeta, sortTarget, type OrderTarget } from "../utils/pagination.js";
import type {
  ActivityFeedItem,
  ActivityFeedQuery,
  EdgeChange,
  EntityChange,
  EntityHistoryQuery,
  ImportRunError,
  ListRunChangesQuery,
  Paginated,
  PaginationMeta,
} from "@componode/core";

type NameTable =
  | "digital_products"
  | "components"
  | "component_groups"
  | "teams"
  | "line_of_businesses"
  | "import_agents"
  | "docker_targets";

async function fetchNames(
  table: NameTable | "importer_configs" | "credentials",
  ids: string[],
  col: "name" | "label" = "name",
): Promise<Map<string, string>> {
  const rows = await db
    .selectFrom(table)
    .select((eb) => ["id", eb.ref(col as never).as("n")])
    .where("id", "in", ids)
    .execute();
  return new Map(rows.map((r) => [r.id, r.n as string]));
}

/** entityType → display-name lookup; types without a map resolve to null. */
async function namesFor(
  entityType: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  switch (entityType) {
    case "digital_product":
      return fetchNames("digital_products", ids);
    case "component":
      return fetchNames("components", ids);
    case "component_group":
      return fetchNames("component_groups", ids);
    case "team":
      return fetchNames("teams", ids);
    case "line_of_business":
      return fetchNames("line_of_businesses", ids);
    case "import_agent":
      return fetchNames("import_agents", ids);
    case "docker_target":
      return fetchNames("docker_targets", ids, "label");
    case "importer_source": {
      const rows = await db
        .selectFrom("importer_sources")
        .select(["id", "externalIdentity"])
        .where("id", "in", ids)
        .execute();
      return new Map(rows.map((r) => [r.id, r.externalIdentity]));
    }
    case "importer_config":
      return fetchNames("importer_configs", ids, "label");
    case "credential":
      return fetchNames("credentials", ids, "label");
    case "url_check": {
      const rows = await db
        .selectFrom("url_checks")
        .innerJoin(
          "component_instances",
          "component_instances.id",
          "url_checks.componentInstanceId",
        )
        .innerJoin(
          "components",
          "components.id",
          "component_instances.componentId",
        )
        .select([
          "url_checks.id",
          "url_checks.name",
          "components.name as componentName",
          "component_instances.environment",
        ])
        .where("url_checks.id", "in", ids)
        .execute();
      return new Map(
        rows.map((r) => [
          r.id,
          `${r.componentName} · ${r.environment} · ${r.name}`,
        ]),
      );
    }
    case "monitoring_setup": {
      const rows = await db
        .selectFrom("component_monitoring_setups")
        .innerJoin(
          "components",
          "components.id",
          "component_monitoring_setups.componentId",
        )
        .select(["component_monitoring_setups.id", "components.name"])
        .where("component_monitoring_setups.id", "in", ids)
        .execute();
      return new Map(rows.map((r) => [r.id, r.name]));
    }
    case "user": {
      const rows = await db
        .selectFrom("persons")
        .select(["id", "username", "displayName"])
        .where("id", "in", ids)
        .execute();
      return new Map(rows.map((r) => [r.id, r.displayName ?? r.username]));
    }
    case "component_instance": {
      const rows = await db
        .selectFrom("component_instances")
        .innerJoin(
          "components",
          "components.id",
          "component_instances.componentId",
        )
        .select([
          "component_instances.id",
          "components.name",
          "component_instances.environment",
        ])
        .where("component_instances.id", "in", ids)
        .execute();
      return new Map(
        rows.map((r) => [r.id, `${r.name} · ${r.environment}`]),
      );
    }
    default:
      return new Map();
  }
}

/**
 * Resolve display names for every entity referenced by the page and attach
 * them — `entityName` on entity changes, `fromEntityName`/`toEntityName` on
 * edge changes. Read-time resolution covers historical rows and renames;
 * unresolvable references (deleted entities, non-entity types) get null.
 */
async function attachEntityNames(
  items: (EntityChange | ActivityFeedItem)[],
): Promise<void> {
  const idsByType = new Map<string, Set<string>>();
  const add = (type: string, id: string | null | undefined) => {
    if (!id || !isUuid(id)) return;
    let set = idsByType.get(type);
    if (!set) idsByType.set(type, (set = new Set()));
    set.add(id);
  };
  for (const item of items) {
    if ("kind" in item && item.kind === "edge") {
      add(item.fromEntityType, item.fromEntityId);
      add(item.toEntityType, item.toEntityId);
    } else {
      add(item.entityType, item.entityId);
    }
  }

  const names = new Map<string, string>();
  await Promise.all(
    [...idsByType].map(async ([type, ids]) => {
      for (const [id, name] of await namesFor(type, [...ids])) {
        names.set(`${type}:${id}`, name);
      }
    }),
  );

  for (const item of items) {
    if ("kind" in item && item.kind === "edge") {
      item.fromEntityName =
        names.get(`${item.fromEntityType}:${item.fromEntityId}`) ?? null;
      item.toEntityName =
        names.get(`${item.toEntityType}:${item.toEntityId}`) ?? null;
    } else {
      item.entityName =
        names.get(`${item.entityType}:${item.entityId}`) ?? null;
    }
  }
}

function isValidDate(value: string | undefined): value is string {
  return value !== undefined && !Number.isNaN(Date.parse(value));
}

// ---------------------------------------------------------------------------
// SQL feed — UNION ALL of entity_changes + edge_changes (spec 068 / ADR-130,
// research D10). Both branches select the same normalized superset; columns
// a table lacks come back NULL and are dropped again when mapping rows back
// to the ActivityFeedItem union, so the response shape is unchanged. Filters
// live inside each branch (the createdAt indexes apply per table), the
// whitelisted sort + LIMIT/OFFSET run on the union, and the count wraps the
// same filtered union — no more fetch-all-then-slice.
// ---------------------------------------------------------------------------

/** Normalized row produced by both UNION ALL branches. */
interface AuditFeedRow {
  kind: "entity" | "edge";
  id: string;
  entityType: string | null;
  entityId: string | null;
  action: string;
  changes: Record<string, unknown> | null;
  importRunId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  edgeType: string | null;
  fromEntityType: string | null;
  fromEntityId: string | null;
  toEntityType: string | null;
  toEntityId: string | null;
  reason: string | null;
}

interface CommonFilters {
  entityType?: string;
  entityId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
}

/**
 * Actor/date/action predicates — identical column names on both change
 * tables, applied inside each branch so filters stay SQL-side (and the
 * createdAt indexes apply per table). Written out per branch because
 * Kysely validates unqualified refs against each table's own type.
 */
function applyEntityCommonFilters(
  q: SelectQueryBuilder<DB, "entity_changes", AuditFeedRow>,
  filters: Pick<CommonFilters, "action" | "actor" | "from" | "to">,
): SelectQueryBuilder<DB, "entity_changes", AuditFeedRow> {
  let out = q;
  if (filters.action) out = out.where("action", "=", filters.action);
  if (filters.actor) {
    const uuidActor = isUuid(filters.actor);
    out = out.where((eb) => {
      const ors = [eb("createdByName", "=", filters.actor!)];
      if (uuidActor) ors.push(eb("createdBy", "=", filters.actor!));
      return eb.or(ors);
    });
  }
  if (isValidDate(filters.from)) {
    out = out.where("createdAt", ">=", filters.from!);
  }
  if (isValidDate(filters.to)) {
    out = out.where("createdAt", "<=", filters.to!);
  }
  return out;
}

function applyEdgeCommonFilters(
  q: SelectQueryBuilder<DB, "edge_changes", AuditFeedRow>,
  filters: Pick<CommonFilters, "action" | "actor" | "from" | "to">,
): SelectQueryBuilder<DB, "edge_changes", AuditFeedRow> {
  let out = q;
  if (filters.action) out = out.where("action", "=", filters.action);
  if (filters.actor) {
    const uuidActor = isUuid(filters.actor);
    out = out.where((eb) => {
      const ors = [eb("createdByName", "=", filters.actor!)];
      if (uuidActor) ors.push(eb("createdBy", "=", filters.actor!));
      return eb.or(ors);
    });
  }
  if (isValidDate(filters.from)) {
    out = out.where("createdAt", ">=", filters.from!);
  }
  if (isValidDate(filters.to)) {
    out = out.where("createdAt", "<=", filters.to!);
  }
  return out;
}

function entityFeedBranch(
  filters: CommonFilters,
): SelectQueryBuilder<DB, "entity_changes", AuditFeedRow> {
  let q = db
    .selectFrom("entity_changes")
    .select([
      sql<"entity">`'entity'`.as("kind"),
      "id",
      "entityType",
      "entityId",
      "action",
      "changes",
      "importRunId",
      "createdBy",
      "createdByName",
      "createdAt",
      sql<null>`NULL::text`.as("edgeType"),
      sql<null>`NULL::text`.as("fromEntityType"),
      sql<null>`NULL::uuid`.as("fromEntityId"),
      sql<null>`NULL::text`.as("toEntityType"),
      sql<null>`NULL::uuid`.as("toEntityId"),
      sql<null>`NULL::text`.as("reason"),
    ])
    .$castTo<AuditFeedRow>();

  if (filters.entityType) {
    q = q.where("entityType", "=", filters.entityType);
  }
  if (filters.entityId) {
    q = q.where("entityId", "=", filters.entityId);
  }
  return applyEntityCommonFilters(q, filters);
}

function edgeFeedBranch(
  filters: CommonFilters,
): SelectQueryBuilder<DB, "edge_changes", AuditFeedRow> {
  let q = db
    .selectFrom("edge_changes")
    .select([
      sql<"edge">`'edge'`.as("kind"),
      "id",
      sql<null>`NULL::text`.as("entityType"),
      sql<null>`NULL::uuid`.as("entityId"),
      "action",
      sql<null>`NULL::jsonb`.as("changes"),
      sql<null>`NULL::uuid`.as("importRunId"),
      "createdBy",
      "createdByName",
      "createdAt",
      "edgeType",
      "fromEntityType",
      "fromEntityId",
      "toEntityType",
      "toEntityId",
      "reason",
    ])
    .$castTo<AuditFeedRow>();

  if (filters.relatedEntityType && filters.relatedEntityId) {
    // Entity history: edges that touch the entity at either endpoint.
    q = q.where((eb) =>
      eb.or([
        eb.and([
          eb("fromEntityType", "=", filters.relatedEntityType!),
          eb("fromEntityId", "=", filters.relatedEntityId!),
        ]),
        eb.and([
          eb("toEntityType", "=", filters.relatedEntityType!),
          eb("toEntityId", "=", filters.relatedEntityId!),
        ]),
      ]),
    );
  } else if (filters.entityType) {
    // Activity feed entityType filter: either endpoint of the edge.
    q = q.where((eb) =>
      eb.or([
        eb("fromEntityType", "=", filters.entityType!),
        eb("toEntityType", "=", filters.entityType!),
      ]),
    );
  }
  return applyEdgeCommonFilters(q, filters);
}

type FeedQuery = SelectQueryBuilder<DB, "entity_changes", AuditFeedRow>;

/**
 * Combines the wanted branches into one union query. A single-kind feed
 * skips UNION ALL entirely; the lone edge branch reports TB
 * "edge_changes" but downstream only touches output-level methods
 * (orderBy/limit/offset/as), so the type-level cast is safe.
 */
function buildFeedUnion(
  filters: CommonFilters,
  wantEntities: boolean,
  wantEdges: boolean,
): FeedQuery {
  if (wantEntities && wantEdges) {
    return entityFeedBranch(filters).unionAll(edgeFeedBranch(filters));
  }
  if (wantEntities) return entityFeedBranch(filters);
  return edgeFeedBranch(filters) as unknown as FeedQuery;
}

/** Whitelisted `actor` sort — mirrors the old feed's case-insensitive coalesce. */
const ACTOR_SORT = sql`lower(coalesce("createdByName", "createdBy"::text, ''))`;

/**
 * Whitelisted `entityType` sort (T059 / FR-005) — matches the entity-kind
 * badge the feed renders: entity rows display `entityType`, edge rows
 * display their FROM endpoint's type (`entityType` is NULL on edge rows).
 */
const ENTITY_TYPE_SORT = sql`coalesce("entityType", "fromEntityType")`;

type ActivitySortKey = NonNullable<ActivityFeedQuery["sort"]>;
type RunChangeSortKey = NonNullable<ListRunChangesQuery["sort"]>;

/** Sort whitelists mirror the audit query schemas — `actor`/`entityType`
 *  order by sql expressions on the derived feed table (spec 069 / B.3). */
const ACTIVITY_SORT_COLUMNS: Record<ActivitySortKey, OrderTarget> = {
  createdAt: "createdAt",
  action: "action",
  actor: ACTOR_SORT,
  kind: "kind",
  entityType: ENTITY_TYPE_SORT,
};

const RUN_CHANGE_SORT_COLUMNS: Record<RunChangeSortKey, OrderTarget> = {
  createdAt: "entity_changes.createdAt",
  action: "entity_changes.action",
  entityType: "entity_changes.entityType",
  actor: sql`coalesce("entity_changes"."createdByName", 'importer')`,
};

/** Maps a normalized UNION row back to the exact ActivityFeedItem shape. */
function unionRowToFeedItem(row: AuditFeedRow): ActivityFeedItem {
  if (row.kind === "entity") {
    return {
      kind: "entity",
      id: row.id,
      entityType: row.entityType ?? "",
      entityId: row.entityId,
      action: row.action,
      changes: row.changes,
      importRunId: row.importRunId,
      createdBy: row.createdBy,
      createdByName: row.createdByName,
      createdAt: row.createdAt,
    };
  }
  return {
    kind: "edge",
    id: row.id,
    edgeType: row.edgeType as EdgeChange["edgeType"],
    fromEntityType: row.fromEntityType ?? "",
    fromEntityId: row.fromEntityId ?? "",
    toEntityType: row.toEntityType ?? "",
    toEntityId: row.toEntityId ?? "",
    action: row.action,
    reason: row.reason,
    createdBy: row.createdBy,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
  };
}

/** Sort + paginate the union in SQL, then attach read-time display names. */
async function pageFeedUnion(
  feed: FeedQuery,
  query: Pick<ActivityFeedQuery, "page" | "pageSize" | "sort" | "order">,
): Promise<Paginated<ActivityFeedItem>> {
  const { page, pageSize, sort, order } = query;

  // The union becomes a derived table so the whitelisted sort runs on the
  // OUTER select: Postgres only allows result column names in a UNION's own
  // ORDER BY, so expressions like ACTOR_SORT would be rejected there.
  // Tiebreak preserves the pre-068 feed semantics: most recent first,
  // then stable id order.
  const feedTable = feed.as("feed");
  const ordered = db
    .selectFrom(feedTable)
    .selectAll()
    .orderBy(sortTarget(ACTIVITY_SORT_COLUMNS, sort, ACTIVITY_SORT_COLUMNS.createdAt), order)
    .orderBy("createdAt", "desc")
    .orderBy("id", "asc");

  const offset = (page - 1) * pageSize;
  const [countRow, rows] = await Promise.all([
    db
      .selectFrom(feedTable)
      .select((eb) => eb.fn.countAll().as("total"))
      .executeTakeFirstOrThrow(),
    ordered.limit(pageSize).offset(offset).execute(),
  ]);

  const items = rows.map(unionRowToFeedItem);
  await attachEntityNames(items);

  return {
    data: items,
    pagination: paginationMeta(Number(countRow.total), page, pageSize),
  };
}

export async function getActivityFeed(
  query: ActivityFeedQuery,
): Promise<Paginated<ActivityFeedItem>> {
  const { kind, entityType, action, actor, from, to } = query;
  const wantEntities = kind === undefined || kind === "entity";
  const wantEdges = kind === undefined || kind === "edge";

  const feed = buildFeedUnion(
    { entityType, action, actor, from, to },
    wantEntities,
    wantEdges,
  );
  return pageFeedUnion(feed, query);
}

export async function getEntityHistory(
  entityType: string,
  entityId: string,
  query: EntityHistoryQuery,
): Promise<Paginated<ActivityFeedItem>> {
  const { kind, action, actor, from, to } = query;
  const wantEntities = kind === undefined || kind === "entity";
  const wantEdges = kind === undefined || kind === "edge";

  const feed = buildFeedUnion(
    {
      entityType,
      entityId,
      relatedEntityType: entityType,
      relatedEntityId: entityId,
      action,
      actor,
      from,
      to,
    },
    wantEntities,
    wantEdges,
  );
  return pageFeedUnion(feed, query);
}

/**
 * Spec 068 / ADR-130 / FR-005: the run's entity_changes paginate with an
 * id tie-break; sort keys map to the stored columns behind the
 * Entity/Type/Action/Actor/Time cells — `entityType` orders by the stored
 * type column (its display kind ordering is identical for the run-change
 * vocabulary) and `actor` mirrors the row's `createdByName ?? "importer"`
 * fallback. The `action` filter and the run's errors stay a top-level
 * extra (same data the sibling /errors endpoint serves).
 */
export async function getRunChanges(
  runId: string,
  query: ListRunChangesQuery,
): Promise<{
  data: EntityChange[];
  pagination: PaginationMeta;
  errors: ImportRunError[];
}> {
  let q = db
    .selectFrom("entity_changes")
    .selectAll()
    .where("importRunId", "=", runId);

  if (query.action) {
    q = q.where("action", "=", query.action);
  }

  const { data: changes, pagination } = await paginateQuery(
    q,
    { page: query.page, pageSize: query.pageSize },
    {
      orderBy: (qb) =>
        // Deterministic tie-break (ADR-130).
        qb.orderBy(
          sortTarget(RUN_CHANGE_SORT_COLUMNS, query.sort, RUN_CHANGE_SORT_COLUMNS.createdAt),
          query.order,
        ).orderBy("entity_changes.id", query.order),
    },
  );

  const errors = await db
    .selectFrom("import_run_errors")
    .selectAll()
    .where("runId", "=", runId)
    .orderBy("createdAt", "desc")
    .execute();

  const named = changes as EntityChange[];
  await attachEntityNames(named);
  return { data: named, pagination, errors };
}
