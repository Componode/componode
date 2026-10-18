import { uuidv7 } from "uuidv7";
import {
  createComponentGroupSchema,
  updateComponentGroupSchema,
  updateComponentSchema,
  type CreateComponentGroupInput,
  type UpdateComponentGroupInput,
  type UpdateComponentInput,
  type Link,
  type ListComponentGroupsQuery,
  listComponentGroupsQuerySchema,
} from "@componode/core";
import { db } from "../db/connection.js";
import { writeEntityChange, type Actor } from "./audit-service.js";

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

export async function listComponentGroups(rawQuery: ListComponentGroupsQuery) {
  const parsed = listComponentGroupsQuerySchema.parse(rawQuery);
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
      "component_groups.createdAt",
      "component_groups.updatedAt",
      // FR-010: pickers/labels show how many components the group expands to.
      eb
        .selectFrom("components")
        .whereRef("components.componentGroupId", "=", "component_groups.id")
        .select((eb2) => eb2.fn.countAll().as("c"))
        .as("memberCount"),
    ]);

  if (parsed.lifecycle) {
    query = query.where("component_groups.lifecycle", "=", parsed.lifecycle);
  } else {
    query = query.where("component_groups.lifecycle", "!=", "RETIRED");
  }

  const rows = await query.orderBy("component_groups.name").execute();
  return rows.map((r) => ({ ...r, memberCount: Number(r.memberCount) }));
}

export async function getComponentGroup(id: string) {
  return db
    .selectFrom("component_groups")
    .leftJoin("teams", "component_groups.teamOwnerId", "teams.id")
    .select([
      "component_groups.id",
      "component_groups.name",
      "component_groups.slug",
      "component_groups.description",
      "component_groups.lifecycle",
      "component_groups.teamOwnerId",
      "teams.name as teamOwnerName",
      "component_groups.createdAt",
      "component_groups.updatedAt",
    ])
    .where("component_groups.id", "=", id)
    .executeTakeFirst();
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
  const existing = await getComponentGroup(id);
  if (!existing) {
    return null;
  }

  const parsed = updateComponentGroupSchema.parse(input);
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
        "teams.name as teamOwnerName",
        "component_groups.createdAt",
        "component_groups.updatedAt",
      ])
      .where("component_groups.id", "=", id)
      .executeTakeFirst();
  });
}

export async function deleteComponentGroup(id: string, actor: Actor) {
  const existing = await getComponentGroup(id);
  if (!existing) {
    return null;
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

  if (parsed.componentGroupId) {
    const group = await getComponentGroup(parsed.componentGroupId);
    if (!group) {
      throw Object.assign(new Error("Component group not found"), {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }
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

  const updates: Record<string, unknown> = {};
  if (parsed.componentGroupId !== undefined)
    updates.componentGroupId = parsed.componentGroupId;
  if (parsed.teamOwnerId !== undefined) updates.teamOwnerId = parsed.teamOwnerId;
  if (parsed.links !== undefined)
    updates.links = JSON.stringify(parsed.links) as unknown as Link[];
  if (parsed.tags !== undefined) updates.tags = parsed.tags;
  if (parsed.sunsetAt !== undefined) updates.sunsetAt = parsed.sunsetAt;
  if (Object.keys(updates).length === 0) {
    return getComponentGroupByComponentId(componentId);
  }

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("components")
      .set(updates)
      .where("id", "=", componentId)
      .execute();

    await writeEntityChange(
      {
        entityType: "component",
        entityId: componentId,
        action: "updated",
        changes: updates,
        actor,
      },
      trx,
    );

    return getComponentGroupByComponentIdWithTrx(trx, componentId);
  });
}

async function getComponentGroupByComponentIdWithTrx(
  trx: import("kysely").Transaction<import("../db/types.js").DB> | typeof db,
  componentId: string,
) {
  return trx
    .selectFrom("components")
    .leftJoin("component_groups", "components.componentGroupId", "component_groups.id")
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
      "components.links",
      "components.tags",
      "components.sunsetAt",
    ])
    .where("components.id", "=", componentId)
    .executeTakeFirst();
}

async function getComponentGroupByComponentId(componentId: string) {
  return getComponentGroupByComponentIdWithTrx(db, componentId);
}
