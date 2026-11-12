import { sql, type SqlBool } from "kysely";
import { db } from "../db/connection.js";
import type { DB } from "../db/types.js";
import { listComponentsQuerySchema, type ListComponentsQuery } from "@componode/core";
import {
  coveragePopulationPredicate,
  hasNonGoneInstanceOrNone,
  wiredComponentIdsQuery,
} from "./catalog-coverage-service.js";
import { groupsOfComponents } from "./component-group-membership.js";
import { paginateQuery, sortTarget, type OrderTarget } from "../utils/pagination.js";

type ComponentSortKey = NonNullable<ListComponentsQuery["sort"]>;

/** Sort whitelist mirrors listComponentsQuerySchema — `health`,
 *  `instances`, and `lastSeenAt` order by select aliases whose ordering
 *  matches the displayed rollup (spec 069 / B.3). */
const COMPONENT_SORT_COLUMNS: Record<ComponentSortKey, OrderTarget> = {
  name: "components.name",
  category: "components.category",
  resourceType: "components.resourceType",
  owner: "teams.name",
  health: "worstStatus",
  instances: "instanceCount",
  lastSeenAt: "lastSeenAt",
};

function normalizeValues(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const arr = Array.isArray(value) ? value : [value];
  const values = arr.map((v) => v.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export async function listComponents(rawQuery: ListComponentsQuery) {
  const parsed = listComponentsQuerySchema.parse(rawQuery);
  const { page, pageSize, includeRetired, includeGone } = parsed;

  let query = db
    .selectFrom("components")
    .leftJoin("teams", "components.teamOwnerId", "teams.id");

  const lifecycles = normalizeValues(parsed.lifecycle);
  // Spec 068 bugfix: an explicit lifecycle filter overrides the default
  // RETIRED exclusion — the two predicates must never combine (otherwise
  // `lifecycle=RETIRED` could never match without includeRetired).
  if (!includeRetired && !lifecycles) {
    query = query.where("components.lifecycle", "!=", "RETIRED");
  }
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
    // Spec 070: membership is multi-valued — the filter matches a component
    // having ANY membership in a group with the slug; "none" = zero
    // memberships of any kind.
    const applyGroupFilter = (
      eb: import("kysely").ExpressionBuilder<DB, "components">,
      mode: "none" | "slugs" | "either",
    ) => {
      const memberJoin = eb
        .selectFrom("component_group_members")
        .innerJoin(
          "component_groups",
          "component_group_members.groupId",
          "component_groups.id",
        )
        .select("component_group_members.componentId")
        .whereRef("component_group_members.componentId", "=", "components.id")
        .$if(mode !== "none", (qb) =>
          qb.where("component_groups.slug", "in", nonNone),
        );
      const hasAnyMembership = eb
        .selectFrom("component_group_members")
        .select("component_group_members.componentId")
        .whereRef("component_group_members.componentId", "=", "components.id");
      if (mode === "none") return eb.not(eb.exists(hasAnyMembership));
      if (mode === "slugs") return eb.exists(memberJoin);
      return eb.or([
        eb.not(eb.exists(hasAnyMembership)),
        eb.exists(memberJoin),
      ]);
    };
    if (hasNone && nonNone.length === 0) {
      query = query.where((eb) => applyGroupFilter(eb, "none"));
    } else if (!hasNone) {
      query = query.where((eb) => applyGroupFilter(eb, "slugs"));
    } else {
      query = query.where((eb) => applyGroupFilter(eb, "either"));
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

  // Spec 068: substring ILIKE across the displayed identity columns plus a
  // tags unnest — replaces the old prefix-only name/slug/externalId match.
  if (parsed.search) {
    const term = `%${parsed.search}%`;
    query = query.where((eb) =>
      eb.or([
        eb("components.name", "ilike", term),
        eb("components.slug", "ilike", term),
        eb("components.resourceType", "ilike", term),
        eb("components.externalId", "ilike", term),
        sql<SqlBool>`EXISTS (
          SELECT 1 FROM unnest(components.tags) AS t
          WHERE t ILIKE ${term}
        )`,
      ]),
    );
  }

  const selected = query.select((eb) => {
    const hasInstanceStatus = (status: string) =>
      eb.exists(
        eb
          .selectFrom("component_instances")
          .select("component_instances.id")
          .whereRef("component_instances.componentId", "=", "components.id")
          .where("component_instances.status", "=", status),
      );

    // G21: per-row health rollup for the list's Health column — worst
    // observed instance status. Spec 068 bugfix: the GONE rung exists only
    // when includeGone=true, so hidden GONE instances can't mask the worst
    // VISIBLE state (ERROR > GONE > STOPPED > RUNNING).
    let worstStatus = eb.case().when(hasInstanceStatus("ERROR")).then("ERROR");
    if (includeGone) {
      worstStatus = worstStatus.when(hasInstanceStatus("GONE")).then("GONE");
    }
    const worstStatusExpr = worstStatus
      .when(hasInstanceStatus("STOPPED"))
      .then("STOPPED")
      .when(hasInstanceStatus("RUNNING"))
      .then("RUNNING")
      .else(null)
      .end();

    return [
      "components.id",
      "components.name",
      "components.slug",
      "components.category",
      "components.provider",
      "components.resourceType",
      "components.lifecycle",
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
      worstStatusExpr.as("worstStatus"),
      eb
        .selectFrom("component_instances")
        .select((eb2) => eb2.fn.max("component_instances.lastSeenAt").as("m"))
        .whereRef("component_instances.componentId", "=", "components.id")
        .as("lastSeenAt"),
    ];
  });

  // Spec 068 / ADR-130 sort whitelist → ORDER BY. Computed sorts order by
  // the SELECT aliases (`worstStatus`, `instanceCount`, `lastSeenAt`) so
  // ordering matches the displayed rollup — notably `lastSeenAt` is the
  // max(instance.lastSeenAt) subquery, NOT the components.lastSeenAt
  // column. `components.id` is the deterministic tie-break and follows the
  // requested direction.
  const { data: components, pagination } = await paginateQuery(
    selected,
    { page, pageSize },
    {
      orderBy: (q) =>
        q.orderBy(sortTarget(COMPONENT_SORT_COLUMNS, parsed.sort, COMPONENT_SORT_COLUMNS.name), parsed.order).orderBy(
          "components.id",
          parsed.order,
        ),
    },
  );

  const groupsByComponent = await groupsOfComponents(
    components.map((c) => c.id),
  );

  return {
    data: components.map((c) => ({
      ...c,
      instanceCount: Number(c.instanceCount),
      componentGroups: groupsByComponent.get(c.id) ?? [],
    })),
    pagination,
  };
}

export async function getComponentById(id: string) {
  const component = await db
    .selectFrom("components")
    .leftJoin("teams", "components.teamOwnerId", "teams.id")
    .select([
      "components.id",
      "components.name",
      "components.slug",
      "components.category",
      "components.provider",
      "components.resourceType",
      "components.lifecycle",
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
      (eb) =>
        eb
          .selectFrom("component_instances")
          .select((eb2) => eb2.fn.count("component_instances.id").as("count"))
          .whereRef("component_instances.componentId", "=", "components.id")
          .as("totalInstanceCount"),
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

  const componentGroups = await groupsOfComponents([id]);

  return {
    ...component,
    componentGroups: componentGroups.get(id) ?? [],
    totalInstanceCount: Number(component.totalInstanceCount ?? 0),
    instances,
  };
}
