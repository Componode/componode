import { sql, type SqlBool } from "kysely";
import { db } from "../db/connection.js";
import { listComponentsQuerySchema, type ListComponentsQuery } from "@componode/core";
import {
  coveragePopulationPredicate,
  hasNonGoneInstanceOrNone,
  wiredComponentIdsQuery,
} from "./catalog-coverage-service.js";

function normalizeValues(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const arr = Array.isArray(value) ? value : [value];
  const values = arr.map((v) => v.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export async function listComponents(rawQuery: ListComponentsQuery) {
  const parsed = listComponentsQuerySchema.parse(rawQuery);
  const { page, pageSize, sort, order, includeRetired, includeGone } = parsed;
  const offset = (page - 1) * pageSize;

  let query = db
    .selectFrom("components")
    .leftJoin("component_groups", "components.componentGroupId", "component_groups.id")
    .leftJoin("teams", "components.teamOwnerId", "teams.id");

  // Default: hide RETIRED components unless explicitly requested
  if (!includeRetired) {
    query = query.where("components.lifecycle", "!=", "RETIRED");
  }

  const lifecycles = normalizeValues(parsed.lifecycle);
  if (lifecycles) {
    query = query.where("components.lifecycle", "in", lifecycles);
  }

  const categories = normalizeValues(parsed.category);
  if (categories) {
    query = query.where("components.category", "in", categories);
  }

  const providers = normalizeValues(parsed.provider);
  if (providers) {
    query = query.where("components.provider", "in", providers);
  }

  const statuses = normalizeValues(parsed.status);
  if (statuses) {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom("component_instances")
          .select("component_instances.id")
          .whereRef("component_instances.componentId", "=", "components.id")
          .where("component_instances.status", "in", statuses),
      ),
    );
  } else if (!includeGone) {
    // Default: hide components that have only GONE instances; keep
    // components with no instances — shared predicate (spec 023).
    query = query.where((eb) => hasNonGoneInstanceOrNone(eb));
  }

  const groupValues = normalizeValues(parsed.componentGroup ?? parsed.group);
  if (groupValues) {
    const hasNone = groupValues.includes("none");
    const nonNone = groupValues.filter((g) => g !== "none");
    if (hasNone && nonNone.length === 0) {
      query = query.where("components.componentGroupId", "is", null);
    } else if (!hasNone) {
      query = query.where("component_groups.slug", "in", nonNone);
    } else {
      query = query.where((eb) =>
        eb.or([
          eb("components.componentGroupId", "is", null),
          eb("component_groups.slug", "in", nonNone),
        ]),
      );
    }
  }

  // Schema-validated + CSV-split values: wired|unwired only.
  const wiredValues = parsed.wired;
  if (wiredValues?.length) {
    const wantsWired = wiredValues.includes("wired");
    const wantsUnwired = wiredValues.includes("unwired");
    if (wantsWired || wantsUnwired) {
      // Spec 023 FR-004: wiring classification applies only to the
      // coverage population (default-visible: ACTIVE, not gone-only) —
      // includeRetired/includeGone never surface out-of-population rows.
      query = query.where((eb) => coveragePopulationPredicate(eb));
      if (wantsWired !== wantsUnwired) {
        query = query.where(
          "components.id",
          wantsWired ? "in" : "not in",
          wiredComponentIdsQuery(),
        );
      }
    }
  }

  if (parsed.tag) {
    query = query.where(
      sql<SqlBool>`components.tags @> ARRAY[${parsed.tag}]::text[]`,
    );
  }

  if (parsed.search) {
    const term = parsed.search;
    query = query.where((eb) =>
      eb.or([
        eb("components.name", "ilike", `${term}%`),
        eb("components.slug", "ilike", `${term}%`),
        eb("components.externalId", "ilike", term),
      ]),
    );
  }

  const sortColumn =
    sort === "lastSeenAt"
      ? "components.lastSeenAt"
      : sort === "createdAt"
        ? "components.createdAt"
        : "components.name";
  const orderedQuery = query.orderBy(sortColumn, order);

  const countResult = await orderedQuery
    .clearOrderBy()
    .clearSelect()
    .select(db.fn.count("components.id").as("count"))
    .executeTakeFirst();
  const total = Number(countResult?.count ?? 0);

  const components = await orderedQuery
    .select((eb) => [
      "components.id",
      "components.name",
      "components.slug",
      "components.category",
      "components.provider",
      "components.resourceType",
      "components.lifecycle",
      "components.componentGroupId",
      "component_groups.name as componentGroupName",
      "components.teamOwnerId",
      "teams.name as teamOwnerName",
      "components.links",
      "components.tags",
      "components.sunsetAt",
      eb
        .selectFrom("component_instances")
        .select((eb2) => eb2.fn.count("component_instances.id").as("count"))
        .whereRef("component_instances.componentId", "=", "components.id")
        .$if(!includeGone, (qb) => qb.where("component_instances.status", "!=", "GONE"))
        .as("instanceCount"),
    ])
    .limit(pageSize)
    .offset(offset)
    .execute();

  const pageCount = total === 0 ? 0 : Math.ceil(total / pageSize);
  const hasNext = page * pageSize < total;

  return {
    data: components.map((c) => ({
      ...c,
      instanceCount: Number(c.instanceCount),
    })),
    pagination: {
      page,
      pageSize,
      total,
      pageCount,
      hasNext,
    },
  };
}

export async function getComponentById(id: string) {
  const component = await db
    .selectFrom("components")
    .leftJoin("component_groups", "components.componentGroupId", "component_groups.id")
    .leftJoin("teams", "components.teamOwnerId", "teams.id")
    .select([
      "components.id",
      "components.name",
      "components.slug",
      "components.category",
      "components.provider",
      "components.resourceType",
      "components.lifecycle",
      "components.componentGroupId",
      "component_groups.name as componentGroupName",
      "components.teamOwnerId",
      "teams.name as teamOwnerName",
      "components.externalId",
      "components.details",
      "components.links",
      "components.tags",
      "components.sunsetAt",
      "components.lastSeenAt",
      "components.createdAt",
      "components.updatedAt",
    ])
    .where("components.id", "=", id)
    .executeTakeFirst();

  if (!component) {
    return null;
  }

  const instances = await db
    .selectFrom("component_instances")
    .selectAll()
    .where("componentId", "=", id)
    .where("status", "!=", "GONE")
    .orderBy("environment")
    .execute();

  return { ...component, instances };
}
