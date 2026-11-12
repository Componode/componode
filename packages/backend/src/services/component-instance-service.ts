import { uuidv7 } from "uuidv7";
import type { Selectable } from "kysely";
import {
  createInstanceBlockSchema,
  updateComponentInstanceSchema,
  type ComponentInstance,
  type Environment,
  type InstanceStatus,
} from "@componode/core";
import { db } from "../db/connection.js";
import type { ComponentInstanceRow } from "../db/types.js";
import { generateInstanceSlug, generateUniqueSlug } from "../utils/slug.js";
import { writeEntityChange, type Actor } from "./audit-service.js";

const coded = (message: string, statusCode: number, code: string) =>
  Object.assign(new Error(message), { statusCode, code });

/**
 * Spec 071: API shape for a ComponentInstance — `environment` is the
 * EFFECTIVE value (human override when set, else the importer-reported
 * column value); `reportedEnvironment` always carries the stored
 * non-override value. Every instance-emitting boundary maps rows through
 * here so effective/provenance semantics live in one place.
 */
export function toApiComponentInstance(
  row: Selectable<ComponentInstanceRow>,
): ComponentInstance {
  return {
    ...row,
    environment: (row.environmentOverride ?? row.environment) as Environment,
    reportedEnvironment: row.environment as Environment,
    environmentOverride: row.environmentOverride as Environment | null,
    status: row.status as InstanceStatus,
  };
}

/** Manual first-instance recovery (spec 054): intentionally not general CRUD. */
export async function createComponentInstance(
  componentId: string,
  input: unknown,
  actor: Actor,
): Promise<ComponentInstance> {
  const parsed = createInstanceBlockSchema.parse(input);
  return db.transaction().execute(async (trx) => {
    const component = await trx
      .selectFrom("components")
      .select(["id", "slug", "lifecycle"])
      .where("id", "=", componentId)
      .executeTakeFirst();
    if (!component || component.lifecycle !== "ACTIVE") {
      throw coded("Component not found", 404, "NOT_FOUND");
    }

    const existing = await trx
      .selectFrom("component_instances")
      .select("id")
      .where("componentId", "=", componentId)
      .executeTakeFirst();
    if (existing) {
      throw coded("Component already has an instance", 409, "CONFLICT");
    }

    const externalId = `manual:${component.slug}`;
    const baseSlug = generateInstanceSlug(
      component.slug,
      parsed.environment,
      externalId,
    );
    const slug = await generateUniqueSlug(baseSlug, async (candidate) => {
      const row = await trx
        .selectFrom("component_instances")
        .select("id")
        .where("slug", "=", candidate)
        .executeTakeFirst();
      return Boolean(row);
    });

    const id = uuidv7();
    try {
      await trx
        .insertInto("component_instances")
        .values({
          id,
          componentId,
          environment: parsed.environment,
          url: parsed.url ?? null,
          region: parsed.region ?? null,
          status: "RUNNING",
          version: parsed.version ?? null,
          deployedAt: null,
          rawConfig: null,
          externalId,
          slug,
          lastSeenAt: null,
          lastSeenInRunId: null,
          createdBy: actor.id,
          updatedBy: null,
        })
        .execute();
    } catch (err) {
      const pg = err as { code?: string };
      if (pg.code === "23505") {
        throw coded("Component already has an instance", 409, "CONFLICT");
      }
      throw err;
    }

    await writeEntityChange(
      {
        entityType: "component_instance",
        entityId: id,
        action: "created",
        changes: {
          componentId,
          environment: parsed.environment,
          externalId,
        },
        actor,
      },
      trx,
    );

    const row = await trx
      .selectFrom("component_instances")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return toApiComponentInstance(row);
  });
}

/**
 * Spec 071: set or clear a ComponentInstance's environment override.
 * `environment` non-null writes the override columns; `null` clears them
 * so the effective value falls back to the latest importer-reported
 * `environment` (which import runs keep refreshing untouched). Identity
 * fields — slug, externalId, memberships, URL checks — are never touched.
 */
export async function updateComponentInstanceEnvironment(
  instanceId: string,
  input: unknown,
  actor: Actor,
): Promise<ComponentInstance> {
  const parsed = updateComponentInstanceSchema.parse(input);
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom("component_instances")
      .selectAll()
      .where("id", "=", instanceId)
      .executeTakeFirst();
    if (!row) {
      throw coded("Component instance not found", 404, "NOT_FOUND");
    }

    const override = parsed.environment;
    const now = new Date().toISOString();
    const previousEffective = row.environmentOverride ?? row.environment;
    const newEffective = override ?? row.environment;

    await trx
      .updateTable("component_instances")
      .set({
        environmentOverride: override,
        environmentOverriddenBy: override === null ? null : actor.id,
        environmentOverriddenAt: override === null ? null : now,
        updatedAt: now,
      })
      .where("id", "=", instanceId)
      .execute();

    await writeEntityChange(
      {
        entityType: "component_instance",
        entityId: instanceId,
        action: "update",
        changes: {
          environment: newEffective,
          previousEnvironment: previousEffective,
          environmentOverride: override,
          reportedEnvironment: row.environment,
        },
        actor,
      },
      trx,
    );

    const updated = await trx
      .selectFrom("component_instances")
      .selectAll()
      .where("id", "=", instanceId)
      .executeTakeFirstOrThrow();
    return toApiComponentInstance(updated);
  });
}
