import { uuidv7 } from "uuidv7";
import type { Selectable } from "kysely";
import { createInstanceBlockSchema } from "@componode/core";
import { db } from "../db/connection.js";
import type { ComponentInstanceRow } from "../db/types.js";
import { generateInstanceSlug, generateUniqueSlug } from "../utils/slug.js";
import { writeEntityChange, type Actor } from "./audit-service.js";

const coded = (message: string, statusCode: number, code: string) =>
  Object.assign(new Error(message), { statusCode, code });

/** Manual first-instance recovery (spec 054): intentionally not general CRUD. */
export async function createComponentInstance(
  componentId: string,
  input: unknown,
  actor: Actor,
): Promise<Selectable<ComponentInstanceRow>> {
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

    return trx
      .selectFrom("component_instances")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  });
}
