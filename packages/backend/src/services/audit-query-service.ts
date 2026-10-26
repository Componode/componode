import { db } from "../db/connection.js";
import { isUuid } from "../utils/ids.js";
import type {
  ActivityFeedItem,
  ActivityFeedQuery,
  EntityChange,
  EntityHistoryQuery,
} from "@componode/core";

interface FeedResult {
  items: ActivityFeedItem[];
  total: number;
}

type NameTable =
  | "digital_products"
  | "components"
  | "component_groups"
  | "teams"
  | "line_of_businesses"
  | "import_agents";

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
    case "importer_config":
      return fetchNames("importer_configs", ids, "label");
    case "credential":
      return fetchNames("credentials", ids, "label");
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

export async function getActivityFeed(query: ActivityFeedQuery): Promise<FeedResult> {
  const { kind, entityType, action, actor, from, to, limit, offset } = query;

  const wantEntities = kind === undefined || kind === "entity";
  const wantEdges = kind === undefined || kind === "edge";

  const entityPromise = wantEntities
    ? buildEntityChangesQuery({ entityType, action, actor, from, to }).execute()
    : Promise.resolve([]);

  const edgePromise = wantEdges
    ? buildEdgeChangesQuery({ entityType, action, actor, from, to }).execute()
    : Promise.resolve([]);

  const [entityRows, edgeRows] = await Promise.all([entityPromise, edgePromise]);

  const items = [
    ...entityRows.map((row) => ({ kind: "entity" as const, ...row })),
    ...edgeRows.map((row) => ({ kind: "edge" as const, ...row })),
  ] as unknown as ActivityFeedItem[];

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = items.length;
  const paginated = items.slice(offset, offset + limit);
  await attachEntityNames(paginated);

  return { items: paginated, total };
}

export async function getEntityHistory(
  entityType: string,
  entityId: string,
  query: EntityHistoryQuery,
): Promise<FeedResult> {
  const { kind, action, actor, from, to, limit, offset } = query;

  const wantEntities = kind === undefined || kind === "entity";
  const wantEdges = kind === undefined || kind === "edge";

  const entityPromise = wantEntities
    ? buildEntityChangesQuery({ entityType, entityId, action, actor, from, to }).execute()
    : Promise.resolve([]);

  const edgePromise = wantEdges
    ? buildEdgeChangesQuery({
        relatedEntityType: entityType,
        relatedEntityId: entityId,
        action,
        actor,
        from,
        to,
      }).execute()
    : Promise.resolve([]);

  const [entityRows, edgeRows] = await Promise.all([entityPromise, edgePromise]);

  const items = [
    ...entityRows.map((row) => ({ kind: "entity" as const, ...row })),
    ...edgeRows.map((row) => ({ kind: "edge" as const, ...row })),
  ] as unknown as ActivityFeedItem[];

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = items.length;
  const paginated = items.slice(offset, offset + limit);
  await attachEntityNames(paginated);

  return { items: paginated, total };
}

export async function getRunChanges(runId: string): Promise<{
  changes: import("@componode/core").EntityChange[];
  errors: import("@componode/core").ImportRunError[];
}> {
  const changes = await db
    .selectFrom("entity_changes")
    .selectAll()
    .where("importRunId", "=", runId)
    .orderBy("createdAt", "desc")
    .execute();

  const errors = await db
    .selectFrom("import_run_errors")
    .selectAll()
    .where("runId", "=", runId)
    .orderBy("createdAt", "desc")
    .execute();

  const named = changes as import("@componode/core").EntityChange[];
  await attachEntityNames(named);
  return { changes: named, errors };
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

function buildEntityChangesQuery(filters: CommonFilters) {
  let q = db.selectFrom("entity_changes").selectAll();

  if (filters.entityType) {
    q = q.where("entityType", "=", filters.entityType);
  }
  if (filters.entityId) {
    q = q.where("entityId", "=", filters.entityId);
  }
  if (filters.action) {
    q = q.where("action", "=", filters.action);
  }
  if (filters.actor) {
    const uuidActor = isUuid(filters.actor);
    q = q.where((eb) => {
      const ors = [eb("createdByName", "=", filters.actor!)];
      if (uuidActor) {
        ors.push(eb("createdBy", "=", filters.actor!));
      }
      return eb.or(ors);
    });
  }
  if (isValidDate(filters.from)) {
    q = q.where("createdAt", ">=", filters.from!);
  }
  if (isValidDate(filters.to)) {
    q = q.where("createdAt", "<=", filters.to!);
  }

  return q.orderBy("createdAt", "desc");
}

function buildEdgeChangesQuery(filters: CommonFilters) {
  let q = db.selectFrom("edge_changes").selectAll();

  if (filters.relatedEntityType && filters.relatedEntityId) {
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
    q = q.where((eb) =>
      eb.or([
        eb("fromEntityType", "=", filters.entityType!),
        eb("toEntityType", "=", filters.entityType!),
      ]),
    );
  }

  if (filters.action) {
    q = q.where("action", "=", filters.action);
  }
  if (filters.actor) {
    const uuidActor = isUuid(filters.actor);
    q = q.where((eb) => {
      const ors = [eb("createdByName", "=", filters.actor!)];
      if (uuidActor) {
        ors.push(eb("createdBy", "=", filters.actor!));
      }
      return eb.or(ors);
    });
  }
  if (isValidDate(filters.from)) {
    q = q.where("createdAt", ">=", filters.from!);
  }
  if (isValidDate(filters.to)) {
    q = q.where("createdAt", "<=", filters.to!);
  }

  return q.orderBy("createdAt", "desc");
}
