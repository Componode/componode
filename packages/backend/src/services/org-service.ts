import { uuidv7 } from "uuidv7";
import {
  createOrgEntitySchema,
  updateOrgEntitySchema,
  type CreateOrgEntityInput,
  type UpdateOrgEntityInput,
} from "@componode/core";
import { db } from "../db/connection.js";
import { writeEntityChange, type Actor } from "./audit-service.js";
import { resolveIdOrSlug } from "../utils/ids.js";

type OrgTable = "line_of_businesses" | "teams";
const ENTITY_TYPE: Record<OrgTable, string> = {
  line_of_businesses: "line_of_business",
  teams: "team",
};

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

async function assertUniqueSlug(table: OrgTable, slug: string, excludeId?: string) {
  const existing = await db
    .selectFrom(table)
    .select("id")
    .where("slug", "=", slug)
    .executeTakeFirst();
  if (existing && existing.id !== excludeId) {
    throw Object.assign(new Error(`Slug "${slug}" is already in use`), {
      statusCode: 409,
      code: "SLUG_TAKEN",
    });
  }
}

export function listOrgEntities(table: OrgTable) {
  return db.selectFrom(table).selectAll().orderBy("name").execute();
}

/** Strict id lookup — used by mutation paths that write `where id = …`. */
function getOrgEntityById(table: OrgTable, id: string) {
  return db
    .selectFrom(table)
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

/** Detail read accepts the id OR the slug (the identifier UX routes carry). */
export function getOrgEntity(table: OrgTable, idOrSlug: string) {
  return resolveIdOrSlug(
    idOrSlug,
    () => getOrgEntityById(table, idOrSlug),
    () =>
      db
        .selectFrom(table)
        .selectAll()
        .where("slug", "=", idOrSlug)
        .executeTakeFirst(),
  );
}

export async function getTeamMembers(teamId: string) {
  const team = await getOrgEntity("teams", teamId);
  if (!team) return null;
  const members = await db
    .selectFrom("persons")
    .select(["id", "displayName", "username", "slug"])
    .where("teamId", "=", team.id)
    .where("isActive", "=", true)
    .orderBy("displayName")
    .execute();
  return { members };
}

export async function createOrgEntity(
  table: OrgTable,
  input: CreateOrgEntityInput,
  actor: Actor,
) {
  const parsed = createOrgEntitySchema.parse(input);
  const slug = parsed.slug ?? toSlug(parsed.name);
  if (!slug) {
    throw Object.assign(new Error("Could not derive a slug from the name"), {
      statusCode: 400,
      code: "VALIDATION_FAILED",
    });
  }
  await assertUniqueSlug(table, slug);

  const id = uuidv7();
  const now = new Date().toISOString();
  return db.transaction().execute(async (trx) => {
    await trx
      .insertInto(table)
      .values({
        id,
        name: parsed.name,
        slug,
        description: parsed.description ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await writeEntityChange({
      entityType: ENTITY_TYPE[table],
      entityId: id,
      action: "created",
      changes: parsed as Record<string, unknown>,
      actor,
    }, trx);
    return trx
      .selectFrom(table)
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  });
}

export async function updateOrgEntity(
  table: OrgTable,
  id: string,
  input: UpdateOrgEntityInput,
  actor: Actor,
) {
  const existing = await getOrgEntityById(table, id);
  if (!existing) return null;
  const parsed = updateOrgEntitySchema.parse(input);
  if (parsed.slug) await assertUniqueSlug(table, parsed.slug, id);

  const updates: Record<string, unknown> = {};
  if (parsed.name !== undefined) updates.name = parsed.name;
  if (parsed.slug !== undefined) updates.slug = parsed.slug;
  if (parsed.description !== undefined) updates.description = parsed.description;
  if (Object.keys(updates).length === 0) return existing;
  updates.updatedAt = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    await trx.updateTable(table).set(updates).where("id", "=", id).execute();
    await writeEntityChange({
      entityType: ENTITY_TYPE[table],
      entityId: id,
      action: "updated",
      changes: updates,
      actor,
    }, trx);
    return trx
      .selectFrom(table)
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  });
}

/**
 * Delete is blocked while referenced (grilling Q10-B): owner references across
 * products/groups/components plus team membership.
 */
async function referenceCounts(table: OrgTable, id: string) {
  const [products, groups, components, members] = await Promise.all([
    table === "line_of_businesses"
      ? db.selectFrom("digital_products").where("lobOwnerId", "=", id).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow()
      : db.selectFrom("digital_products").where("teamOwnerId", "=", id).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow(),
    table === "teams"
      ? db.selectFrom("component_groups").where("teamOwnerId", "=", id).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow()
      : Promise.resolve({ n: 0 }),
    table === "teams"
      ? db.selectFrom("components").where("teamOwnerId", "=", id).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow()
      : Promise.resolve({ n: 0 }),
    table === "teams"
      ? db.selectFrom("persons").where("teamId", "=", id).select((eb) => eb.fn.countAll().as("n")).executeTakeFirstOrThrow()
      : Promise.resolve({ n: 0 }),
  ]);
  return {
    products: Number(products.n),
    groups: Number(groups.n),
    components: Number(components.n),
    members: Number(members.n),
  };
}

export async function deleteOrgEntity(table: OrgTable, id: string, actor: Actor) {
  const existing = await getOrgEntityById(table, id);
  if (!existing) return null;

  const counts = await referenceCounts(table, id);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total > 0) {
    throw Object.assign(
      new Error(`Still referenced (${total} reference(s)) — reassign first`),
      { statusCode: 409, code: "REFERENCED", details: { counts } },
    );
  }

  return db.transaction().execute(async (trx) => {
    await trx.deleteFrom(table).where("id", "=", id).execute();
    await writeEntityChange({
      entityType: ENTITY_TYPE[table],
      entityId: id,
      action: "deleted",
      changes: { name: existing.name, slug: existing.slug },
      actor,
    }, trx);
    return existing;
  });
}
