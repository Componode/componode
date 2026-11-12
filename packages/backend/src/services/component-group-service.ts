import { uuidv7 } from "uuidv7";
import { resolveIdOrSlug } from "../utils/ids.js";
import {
  createComponentGroupSchema,
  updateComponentGroupSchema,
  createComponentSchema,
  updateComponentSchema,
  type CreateComponentGroupInput,
  type CreateComponentInput,
  type UpdateComponentGroupInput,
  type UpdateComponentInput,
  type ComponentInstance,
  type Link,
  listComponentGroupsQuerySchema,
  type ListComponentGroupsQuery,
} from "@componode/core";
import type { Selectable } from "kysely";
import { db } from "../db/connection.js";
import type { ComponentRow } from "../db/types.js";
import { writeEntityChange, type Actor } from "./audit-service.js";
import { runSuggestionPass } from "./edge-suggestion-service.js";
import { tagsDiffer } from "./suggestion-signals.js";
import {
  addMemberships,
  assertAssignableHumanGroups,
  groupsOfComponent,
  humanGroupIdsOfComponent,
  replaceHumanMemberships,
  type ComponentGroupRef,
} from "./component-group-membership.js";
import { toApiComponentInstance } from "./component-instance-service.js";

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 100;
}

async function assertUniqueSlug(slug: string, excludeId?: string): Promise<void> {
  const existing = await db
    .selectFrom("component_groups")
    .select("id")
    .where("slug", "=", slug)
    .executeTakeFirst();
  if (existing && existing.id !== excludeId) {
    throw Object.assign(new Error("Slug already in use; choose another"), {
      statusCode: 409,
      code: "SLUG_CONFLICT",
    });
  }
}

function actorName(actor: Actor): string | null {
  return actor.name ?? actor.id;
}

/**
 * ADR-129 / spec 067+070: a group with `autoSourceId IS NOT NULL` is
 * auto-managed — its lifecycle and membership are derived by the
 * source-grouping pass (source groups and app groups alike). Humans may
 * still rename/re-describe/re-own it, but lifecycle writes and deletion
 * are rejected with a controlled conflict.
 */
async function isAutoManagedGroup(groupId: string): Promise<boolean> {
  const row = await db
    .selectFrom("component_groups")
    .select("autoSourceId")
    .where("id", "=", groupId)
    .executeTakeFirst();
  return row?.autoSourceId != null;
}

function autoManagedConflict(): never {
  throw Object.assign(
    new Error(
      "Component group is managed by an importer source — its lifecycle and membership are derived automatically",
    ),
    { statusCode: 409, code: "GROUP_AUTO_MANAGED" },
  );
}

import { paginateQuery, sortTarget, type OrderTarget } from "../utils/pagination.js";

type GroupSortKey = NonNullable<ListComponentGroupsQuery["sort"]>;

/** Sort whitelist mirrors listComponentGroupsQuerySchema (spec 069 / B.3). */
const GROUP_SORT_COLUMNS: Record<GroupSortKey, OrderTarget> = {
  name: "component_groups.name",
  lifecycle: "component_groups.lifecycle",
  createdAt: "component_groups.createdAt",
};

export async function listComponentGroups(rawQuery: unknown) {
  const parsed = listComponentGroupsQuerySchema.parse(rawQuery);
  const { page, pageSize, order } = parsed;

  let query = db
    .selectFrom("component_groups")
    .leftJoin("teams", "component_groups.teamOwnerId", "teams.id")
    .select((eb) => [
      "component_groups.id",
      "component_groups.name",
      "component_groups.slug",
      "component_groups.description",
      "component_groups.lifecycle",
      "component_groups.teamOwnerId",
      "teams.name as teamOwnerName",
      "component_groups.autoSourceId",
      "component_groups.autoGroupKey",
      "component_groups.createdAt",
      "component_groups.updatedAt",
      // FR-010: pickers/labels show how many components the group expands to.
      eb
        .selectFrom("component_group_members")
        .whereRef("component_group_members.groupId", "=", "component_groups.id")
        .select((eb2) => eb2.fn.countAll().as("c"))
        .as("memberCount"),
    ]);

  // Explicit lifecycle overrides the default RETIRED exclusion — same
  // precedence rule as /components (spec 068).
  if (parsed.lifecycle) {
    query = query.where("component_groups.lifecycle", "=", parsed.lifecycle);
  } else if (!parsed.includeRetired) {
    query = query.where("component_groups.lifecycle", "!=", "RETIRED");
  }

  if (parsed.search) {
    const term = `%${parsed.search}%`;
    query = query.where((eb) =>
      eb.or([
        eb("component_groups.name", "ilike", term),
        eb("component_groups.slug", "ilike", term),
      ]),
    );
  }

  const { data, pagination } = await paginateQuery(query, { page, pageSize }, {
    orderBy: (q) =>
      // Deterministic tie-break (ADR-130).
      q.orderBy(sortTarget(GROUP_SORT_COLUMNS, parsed.sort, GROUP_SORT_COLUMNS.name), order).orderBy(
        "component_groups.id",
        order,
      ),
  });

  return {
    data: data.map((r) => ({ ...r, memberCount: Number(r.memberCount) })),
    pagination,
  };
}

function groupDetailQuery() {
  return db
    .selectFrom("component_groups")
    .leftJoin("teams", "component_groups.teamOwnerId", "teams.id")
    .select((eb) => [
      "component_groups.id",
      "component_groups.name",
      "component_groups.slug",
      "component_groups.description",
      "component_groups.lifecycle",
      "component_groups.teamOwnerId",
      "teams.name as teamOwnerName",
      "component_groups.autoSourceId",
      "component_groups.autoGroupKey",
      "component_groups.createdAt",
      "component_groups.updatedAt",
      eb
        .selectFrom("component_group_members")
        .whereRef("component_group_members.groupId", "=", "component_groups.id")
        .select((eb2) => eb2.fn.countAll().as("c"))
        .as("memberCount"),
    ]);
}

type GroupDetailRow = Awaited<ReturnType<ReturnType<typeof groupDetailQuery>["executeTakeFirst"]>>;

/** PG count comes back as a bigint string — normalize to number. */
function normalizeGroup<T extends GroupDetailRow>(row: T | undefined) {
  return row ? { ...row, memberCount: Number(row.memberCount) } : row;
}

/** Strict id lookup — used by mutation paths that write `where id = …`. */
async function getComponentGroupById(id: string) {
  const row = await groupDetailQuery()
    .where("component_groups.id", "=", id)
    .executeTakeFirst();
  return normalizeGroup(row);
}

/** Detail read accepts the id OR the slug (the identifier UX routes carry). */
export async function getComponentGroup(idOrSlug: string) {
  return resolveIdOrSlug(
    idOrSlug,
    () => getComponentGroupById(idOrSlug),
    async () =>
      normalizeGroup(
        await groupDetailQuery()
          .where("component_groups.slug", "=", idOrSlug)
          .executeTakeFirst(),
      ),
  );
}

export async function createComponentGroup(
  input: CreateComponentGroupInput,
  actor: Actor,
) {
  const parsed = createComponentGroupSchema.parse(input);
  if (!isValidSlug(parsed.slug)) {
    throw Object.assign(new Error("Invalid slug"), {
      statusCode: 400,
      code: "VALIDATION_FAILED",
    });
  }
  await assertUniqueSlug(parsed.slug);

  const id = uuidv7();
  const now = new Date().toISOString();
  return db.transaction().execute(async (trx) => {
    await trx
      .insertInto("component_groups")
      .values({
        id,
        name: parsed.name,
        slug: parsed.slug,
        description: parsed.description ?? null,
        lifecycle: "ACTIVE",
        teamOwnerId: parsed.teamOwnerId ?? null,
        createdBy: actor.id,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await writeEntityChange(
      {
        entityType: "component_group",
        entityId: id,
        action: "created",
        changes: parsed as Record<string, unknown>,
        actor,
      },
      trx,
    );

    return trx
      .selectFrom("component_groups")
      .leftJoin("teams", "component_groups.teamOwnerId", "teams.id")
      .select([
        "component_groups.id",
        "component_groups.name",
        "component_groups.slug",
        "component_groups.description",
        "component_groups.lifecycle",
        "component_groups.teamOwnerId",
        "component_groups.autoSourceId",
        "component_groups.autoGroupKey",
        "teams.name as teamOwnerName",
        "component_groups.createdAt",
        "component_groups.updatedAt",
      ])
      .where("component_groups.id", "=", id)
      .executeTakeFirst();
  });
}

export async function updateComponentGroup(
  id: string,
  input: UpdateComponentGroupInput,
  actor: Actor,
) {
  const existing = await getComponentGroupById(id);
  if (!existing) {
    return null;
  }

  const parsed = updateComponentGroupSchema.parse(input);
  if (parsed.lifecycle !== undefined && (await isAutoManagedGroup(id))) {
    autoManagedConflict();
  }
  if (parsed.slug && !isValidSlug(parsed.slug)) {
    throw Object.assign(new Error("Invalid slug"), {
      statusCode: 400,
      code: "VALIDATION_FAILED",
    });
  }
  if (parsed.slug) {
    await assertUniqueSlug(parsed.slug, id);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.name !== undefined) updates.name = parsed.name;
  if (parsed.slug !== undefined) updates.slug = parsed.slug;
  if (parsed.description !== undefined) updates.description = parsed.description ?? null;
  if (parsed.lifecycle !== undefined) updates.lifecycle = parsed.lifecycle;
  if (parsed.teamOwnerId !== undefined) updates.teamOwnerId = parsed.teamOwnerId ?? null;

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  updates.updatedBy = actor.id;
  updates.updatedAt = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("component_groups")
      .set(updates)
      .where("id", "=", id)
      .execute();

    await writeEntityChange(
      {
        entityType: "component_group",
        entityId: id,
        action: parsed.lifecycle !== undefined && parsed.lifecycle !== existing.lifecycle ? "lifecycle" : "updated",
        changes: { ...updates, actorName: actorName(actor) },
        actor,
      },
      trx,
    );

    return trx
      .selectFrom("component_groups")
      .leftJoin("teams", "component_groups.teamOwnerId", "teams.id")
      .select([
        "component_groups.id",
        "component_groups.name",
        "component_groups.slug",
        "component_groups.description",
        "component_groups.lifecycle",
        "component_groups.teamOwnerId",
        "component_groups.autoSourceId",
        "component_groups.autoGroupKey",
        "teams.name as teamOwnerName",
        "component_groups.createdAt",
        "component_groups.updatedAt",
      ])
      .where("component_groups.id", "=", id)
      .executeTakeFirst();
  });
}

export async function deleteComponentGroup(id: string, actor: Actor) {
  const existing = await getComponentGroupById(id);
  if (!existing) {
    return null;
  }
  if (await isAutoManagedGroup(id)) {
    autoManagedConflict();
  }

  // Spec 019 / FR-009: a group that products depend on must not be deleted —
  // removal would silently drop curated dependency edges. Retirement is the
  // supported alternative (components keep their membership).
  const blockers = await db
    .selectFrom("product_depends_on_component_group")
    .innerJoin(
      "digital_products",
      "product_depends_on_component_group.productId",
      "digital_products.id",
    )
    .select([
      "digital_products.id",
      "digital_products.name",
      "digital_products.slug",
    ])
    .where(
      "product_depends_on_component_group.componentGroupId",
      "=",
      id,
    )
    .execute();
  if (blockers.length > 0) {
    throw Object.assign(
      new Error(
        `Component group is depended on by ${blockers.length} product(s): ${blockers
          .map((p) => p.name)
          .join(", ")}`,
      ),
      { statusCode: 409, code: "REFERENCED", details: { products: blockers } },
    );
  }

  return db.transaction().execute(async (trx) => {
    await trx.deleteFrom("component_groups").where("id", "=", id).execute();

    await writeEntityChange(
      {
        entityType: "component_group",
        entityId: id,
        action: "deleted",
        changes: { name: existing.name, slug: existing.slug },
        actor,
      },
      trx,
    );

    return existing;
  });
}

export async function updateComponent(
  componentId: string,
  input: UpdateComponentInput,
  actor: Actor,
) {
  const parsed = updateComponentSchema.parse(input);

  if (parsed.teamOwnerId) {
    const team = await db
      .selectFrom("teams")
      .select("id")
      .where("id", "=", parsed.teamOwnerId)
      .executeTakeFirst();
    if (!team) {
      throw Object.assign(new Error("Team not found"), {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }
  }

  // Spec 070: componentGroupIds manages HUMAN-group memberships only —
  // auto-managed ids are rejected, unknown ids 404.
  if (parsed.componentGroupIds !== undefined) {
    await assertAssignableHumanGroups(parsed.componentGroupIds);
  }

  const existing = await db
    .selectFrom("components")
    .selectAll()
    .where("id", "=", componentId)
    .executeTakeFirst();
  if (!existing) {
    throw Object.assign(new Error("Component not found"), {
      statusCode: 404,
      code: "NOT_FOUND",
    });
  }

  const priorHumanGroups =
    parsed.componentGroupIds !== undefined
      ? await humanGroupIdsOfComponent(componentId)
      : null;

  const updates: Record<string, unknown> = {};
  if (parsed.teamOwnerId !== undefined) updates.teamOwnerId = parsed.teamOwnerId;
  if (parsed.links !== undefined)
    updates.links = JSON.stringify(parsed.links) as unknown as Link[];
  if (parsed.tags !== undefined) updates.tags = parsed.tags;
  if (parsed.sunsetAt !== undefined) updates.sunsetAt = parsed.sunsetAt;

  const membershipChanged =
    priorHumanGroups !== null &&
    JSON.stringify([...priorHumanGroups].sort()) !==
      JSON.stringify([...new Set(parsed.componentGroupIds ?? [])].sort());

  if (Object.keys(updates).length === 0 && !membershipChanged) {
    return getComponentGroupByComponentId(componentId);
  }

  const result = await db.transaction().execute(async (trx) => {
    if (Object.keys(updates).length > 0) {
      await trx
        .updateTable("components")
        .set(updates)
        .where("id", "=", componentId)
        .execute();
    }

    let membershipAudit: Record<string, unknown> | null = null;
    if (parsed.componentGroupIds !== undefined) {
      const diff = await replaceHumanMemberships(
        componentId,
        parsed.componentGroupIds,
        trx,
      );
      membershipAudit = {
        componentGroupIds: { from: diff.before, to: diff.after },
      };
    }

    await writeEntityChange(
      {
        entityType: "component",
        entityId: componentId,
        action: "updated",
        changes: { ...updates, ...membershipAudit },
        actor,
      },
      trx,
    );

    return getComponentGroupByComponentIdWithTrx(trx, componentId);
  });

  // ADR-113: a scoped pass re-scores this component's pairs and tombstones
  // pairs newly covered by a group move — post-commit, failure-isolated.
  // Guard on real changes, not mere presence in the PATCH body.
  if (membershipChanged || (parsed.tags !== undefined && tagsDiffer(parsed.tags, existing.tags))) {
    await runSuggestionPass({ componentIds: [componentId] }, { componentId });
  }
  return result;
}

/**
 * Manual component creation (spec 042, gap G29) — same shape as
 * createComponentGroup: slug format + uniqueness, FK existence checks,
 * uuid v7, audit event. Importer-managed columns stay null.
 */
export interface CreateComponentResult {
  component:
    | (Selectable<ComponentRow> & { componentGroups: ComponentGroupRef[] })
    | undefined;
  // Composite create-with-instance — present only when the request
  // carried the instance block. Serialized API shape (spec 071).
  instance?: ComponentInstance;
}

export async function createComponent(
  input: CreateComponentInput,
  actor: Actor,
): Promise<CreateComponentResult> {
  const parsed = createComponentSchema.parse(input);
  // Spec 058 (ADR-126): the manual monitoring block is retired — managed
  // checks are authored through ImporterConfig. Instance-only creates are
  // unaffected.
  if (parsed.monitoring) {
    throw Object.assign(
      new Error(
        "Direct URL check writes are deprecated — manage checks through the ImporterConfig",
      ),
      { statusCode: 410, code: "URL_CHECK_WRITE_DEPRECATED" },
    );
  }
  if (!isValidSlug(parsed.slug)) {
    throw Object.assign(new Error("Invalid slug"), {
      statusCode: 400,
      code: "VALIDATION_FAILED",
    });
  }
  const slugTaken = await db
    .selectFrom("components")
    .select("id")
    .where("slug", "=", parsed.slug)
    .executeTakeFirst();
  if (slugTaken) {
    throw Object.assign(new Error("Slug already in use; choose another"), {
      statusCode: 409,
      code: "SLUG_CONFLICT",
    });
  }
  if (parsed.teamOwnerId) {
    const team = await db
      .selectFrom("teams")
      .select("id")
      .where("id", "=", parsed.teamOwnerId)
      .executeTakeFirst();
    if (!team) {
      throw Object.assign(new Error("Team not found"), {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }
  }
  if (parsed.componentGroupIds !== undefined) {
    await assertAssignableHumanGroups(parsed.componentGroupIds);
  }

  const id = uuidv7();
  const now = new Date().toISOString();
  return db.transaction().execute(async (trx) => {
    await trx
      .insertInto("components")
      .values({
        id,
        name: parsed.name,
        slug: parsed.slug,
        category: parsed.category,
        provider: parsed.provider,
        resourceType: parsed.resourceType,
        lifecycle: "ACTIVE",
        teamOwnerId: parsed.teamOwnerId ?? null,
        externalId: null,
        details: null,
        links: parsed.links ?? [],
        tags: parsed.tags ?? [],
        sunsetAt: parsed.sunsetAt ?? null,
        lastSeenAt: null,
        lastSeenInRunId: null,
        createdBy: actor.id,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await writeEntityChange(
      {
        entityType: "component",
        entityId: id,
        action: "created",
        changes: parsed as Record<string, unknown>,
        actor,
      },
      trx,
    );

    if (parsed.componentGroupIds && parsed.componentGroupIds.length > 0) {
      await addMemberships(id, parsed.componentGroupIds, trx);
    }

    const component = await trx
      .selectFrom("components")
      .selectAll()
      .where("components.id", "=", id)
      .executeTakeFirst();
    // Spec 070 FR-002: the create response exposes memberships like every
    // other component payload.
    const payload = component
      ? { ...component, componentGroups: await groupsOfComponent(id, trx) }
      : component;

    if (!parsed.instance) {
      return { component: payload };
    }

    // Composite create (spec 051 US5): component + one instance in this
    // transaction — the monitoring block is rejected before this point
    // (spec 058: direct check writes are deprecated).
    const block = parsed.instance;
    const instanceId = uuidv7();
    await trx
      .insertInto("component_instances")
      .values({
        id: instanceId,
        componentId: id,
        environment: block.environment,
        url: block.url ?? null,
        region: block.region ?? null,
        status: "RUNNING",
        version: block.version ?? null,
        deployedAt: null,
        rawConfig: null,
        externalId: `manual:${parsed.slug}`,
        slug: `${parsed.slug}-${block.environment.toLowerCase()}`,
        lastSeenAt: null,
        lastSeenInRunId: null,
        createdBy: actor.id,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await writeEntityChange(
      {
        entityType: "component_instance",
        entityId: instanceId,
        action: "created",
        changes: {
          componentId: id,
          environment: block.environment,
          externalId: `manual:${parsed.slug}`,
        },
        actor,
      },
      trx,
    );
    const instance = await trx
      .selectFrom("component_instances")
      .selectAll()
      .where("id", "=", instanceId)
      .executeTakeFirst();

    return {
      component: payload,
      instance: instance ? toApiComponentInstance(instance) : instance,
    };
  });
}

async function getComponentGroupByComponentIdWithTrx(
  trx: import("kysely").Transaction<import("../db/types.js").DB> | typeof db,
  componentId: string,
) {
  const component = await trx
    .selectFrom("components")
    .select([
      "components.id",
      "components.name",
      "components.slug",
      "components.category",
      "components.provider",
      "components.resourceType",
      "components.lifecycle",
      "components.teamOwnerId",
      "components.links",
      "components.tags",
      "components.sunsetAt",
    ])
    .where("components.id", "=", componentId)
    .executeTakeFirst();
  if (!component) return component;
  return {
    ...component,
    componentGroups: await groupsOfComponent(componentId, trx),
  };
}

async function getComponentGroupByComponentId(componentId: string) {
  return getComponentGroupByComponentIdWithTrx(db, componentId);
}
