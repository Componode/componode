import { uuidv7 } from "uuidv7";
import { resolveIdOrSlug } from "../utils/ids.js";
import {
  createComponentGroupSchema,
  updateComponentGroupSchema,
  createComponentSchema,
  updateComponentSchema,
  createUrlCheckSchema,
  URL_CHECK_DEFAULT_CADENCE_SECONDS,
  type CreateComponentGroupInput,
  type CreateComponentInput,
  type UpdateComponentGroupInput,
  type UpdateComponentInput,
  type Link,
  type MonitoringSetup,
  type UrlCheck,
  listComponentGroupsQuerySchema,
} from "@componode/core";
import type { Selectable } from "kysely";
import { db } from "../db/connection.js";
import type { ComponentInstanceRow, ComponentRow } from "../db/types.js";
import { writeEntityChange, type Actor } from "./audit-service.js";
import { runSuggestionPass } from "./edge-suggestion-service.js";
import { tagsDiffer } from "./suggestion-signals.js";
import { insertCheck } from "./url-check-service.js";
import { assertAgentUsable } from "./monitoring-setup-service.js";

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

export async function listComponentGroups(rawQuery: unknown) {
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
  } else if (!parsed.includeRetired) {
    query = query.where("component_groups.lifecycle", "!=", "RETIRED");
  }

  const rows = await query.orderBy("component_groups.name").execute();
  return rows.map((r) => ({ ...r, memberCount: Number(r.memberCount) }));
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
      "component_groups.createdAt",
      "component_groups.updatedAt",
      eb
        .selectFrom("components")
        .whereRef("components.componentGroupId", "=", "component_groups.id")
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
  const existing = await getComponentGroupById(id);
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
    const group = await getComponentGroupById(parsed.componentGroupId);
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

  const result = await db.transaction().execute(async (trx) => {
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

  // ADR-113: a scoped pass re-scores this component's pairs and tombstones
  // pairs newly covered by a group move — post-commit, failure-isolated.
  // Guard on real changes, not mere presence in the PATCH body.
  if (
    (parsed.componentGroupId !== undefined &&
      parsed.componentGroupId !== existing.componentGroupId) ||
    (parsed.tags !== undefined && tagsDiffer(parsed.tags, existing.tags))
  ) {
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
  component: Selectable<ComponentRow> | undefined;
  // Composite create-with-checks (spec 051 US5) — present only when the
  // request carried the instance/monitoring blocks.
  instance?: Selectable<ComponentInstanceRow>;
  setup?: MonitoringSetup;
  checks?: UrlCheck[];
}

export async function createComponent(
  input: CreateComponentInput,
  actor: Actor,
): Promise<CreateComponentResult> {
  const parsed = createComponentSchema.parse(input);
  if (parsed.monitoring && !parsed.instance) {
    throw Object.assign(
      new Error("monitoring requires an instance block"),
      { statusCode: 400, code: "VALIDATION_FAILED" },
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
  if (parsed.componentGroupId) {
    const group = await getComponentGroupById(parsed.componentGroupId);
    if (!group) {
      throw Object.assign(new Error("Component group not found"), {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }
  }

  // Setup-block validation runs before the transaction so a bad request
  // fails fast; row validation (agent usable, check rules) happens inside.
  const setupIn = parsed.monitoring?.setup;
  if (parsed.monitoring && setupIn?.vantage === "AGENT" && !setupIn.agentId) {
    throw Object.assign(
      new Error("agentId is required when vantage is AGENT"),
      { statusCode: 400, code: "VALIDATION_FAILED" },
    );
  }
  if (setupIn?.agentId) {
    await assertAgentUsable(setupIn.agentId);
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
        componentGroupId: parsed.componentGroupId ?? null,
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

    const component = await trx
      .selectFrom("components")
      .selectAll()
      .where("components.id", "=", id)
      .executeTakeFirst();

    if (!parsed.instance) {
      return { component };
    }

    // Composite create (spec 051 US5): component + one instance, plus the
    // monitoring setup + every check when a monitoring block is present —
    // all in this transaction, so a failed check rolls the graph back.
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

    if (!parsed.monitoring) {
      return { component, instance };
    }

    const vantage = setupIn?.vantage ?? "HUB";
    const setupId = uuidv7();
    await trx
      .insertInto("component_monitoring_setups")
      .values({
        id: setupId,
        componentId: id,
        cadenceSeconds:
          setupIn?.cadenceSeconds ?? URL_CHECK_DEFAULT_CADENCE_SECONDS,
        vantage,
        agentId: vantage === "AGENT" ? (setupIn?.agentId ?? null) : null,
      })
      .execute();
    await writeEntityChange(
      {
        entityType: "monitoring_setup",
        entityId: setupId,
        action: "created",
        changes: {
          componentId: id,
          cadenceSeconds:
            setupIn?.cadenceSeconds ?? URL_CHECK_DEFAULT_CADENCE_SECONDS,
          vantage,
        },
        actor,
      },
      trx,
    );
    const setupRow = await trx
      .selectFrom("component_monitoring_setups")
      .selectAll()
      .where("id", "=", setupId)
      .executeTakeFirstOrThrow();
    const agentName = setupRow.agentId
      ? (
          await trx
            .selectFrom("import_agents")
            .select("name")
            .where("id", "=", setupRow.agentId)
            .executeTakeFirst()
        )?.name ?? null
      : null;
    const setup: MonitoringSetup = {
      id: setupRow.id,
      componentId: setupRow.componentId,
      cadenceSeconds: setupRow.cadenceSeconds,
      vantage: setupRow.vantage as MonitoringSetup["vantage"],
      agentId: setupRow.agentId,
      agentName,
      createdAt: setupRow.createdAt,
      updatedAt: setupRow.updatedAt,
    };

    const checks: UrlCheck[] = [];
    for (const checkInput of parsed.monitoring.checks) {
      const checkParsed = createUrlCheckSchema.parse({
        ...checkInput,
        componentInstanceId: instanceId,
      });
      checks.push(await insertCheck(trx, id, setupId, vantage, checkParsed, actor));
    }

    return { component, instance, setup, checks };
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
