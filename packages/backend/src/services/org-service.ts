import { uuidv7 } from "uuidv7";
import type { Kysely, Selectable } from "kysely";
import {
  type CreateOrgEntityInput,
  type UpdateOrgEntityInput,
  type CreateTeamInput,
  type UpdateTeamInput,
} from "@componode/core";
import { db } from "../db/connection.js";
import type { DB, LineOfBusinessRow, TeamRow } from "../db/types.js";
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

// Transaction<Database> extends Kysely<Database>, so both db and trx fit.
/**
 * Team rows carry their LOB association resolved server-side (spec 034):
 * a left join embeds `lob {id,name,slug}` — null when unassociated — so
 * clients never render a raw `lobId`.
 */
function selectTeams(q: Kysely<DB>) {
  return q
    .selectFrom("teams")
    .leftJoin("line_of_businesses as lob", (join) =>
      join.onRef("lob.id", "=", "teams.lobId"),
    )
    .selectAll("teams")
    .select([
      "lob.id as lobId_ref",
      "lob.name as lobName",
      "lob.slug as lobSlug",
    ]);
}

export interface TeamLobSummary {
  id: string;
  name: string;
  slug: string;
}
export type TeamWithLob = Selectable<TeamRow> & { lob: TeamLobSummary | null };
export type LobRow = Selectable<LineOfBusinessRow>;
export type OrgEntityRow = TeamWithLob | LobRow;

function withLob<T extends { lobId_ref: string | null; lobName: string | null; lobSlug: string | null }>(
  row: T,
): Omit<T, "lobId_ref" | "lobName" | "lobSlug"> & { lob: TeamLobSummary | null } {
  const { lobId_ref, lobName, lobSlug, ...team } = row;
  return {
    ...team,
    lob: lobId_ref ? { id: lobId_ref, name: lobName, slug: lobSlug } as TeamLobSummary : null,
  };
}

async function assertLobExists(lobId: string) {
  const lob = await db
    .selectFrom("line_of_businesses")
    .select("id")
    .where("id", "=", lobId)
    .executeTakeFirst();
  if (!lob) {
    throw Object.assign(new Error("Referenced line of business not found"), {
      statusCode: 400,
      code: "VALIDATION_FAILED",
    });
  }
}

export function listOrgEntities(table: "teams"): Promise<TeamWithLob[]>;
export function listOrgEntities(table: "line_of_businesses"): Promise<LobRow[]>;
export function listOrgEntities(table: OrgTable): Promise<OrgEntityRow[]>;
export async function listOrgEntities(table: OrgTable): Promise<OrgEntityRow[]> {
  if (table === "teams") {
    const rows = await selectTeams(db).orderBy("teams.name").execute();
    return rows.map(withLob);
  }
  return db.selectFrom(table).selectAll().orderBy("name").execute();
}

/** Strict id lookup — used by mutation paths that write `where id = …`. */
function getOrgEntityById(table: OrgTable, id: string): Promise<OrgEntityRow | undefined> {
  if (table === "teams") {
    return selectTeams(db)
      .where("teams.id", "=", id)
      .executeTakeFirst()
      .then((row) => row && withLob(row));
  }
  return db
    .selectFrom(table)
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

/** Detail read accepts the id OR the slug (the identifier UX routes carry). */
export function getOrgEntity(table: "teams", idOrSlug: string): Promise<TeamWithLob | undefined>;
export function getOrgEntity(table: "line_of_businesses", idOrSlug: string): Promise<LobRow | undefined>;
export function getOrgEntity(table: OrgTable, idOrSlug: string): Promise<OrgEntityRow | undefined>;
export function getOrgEntity(table: OrgTable, idOrSlug: string): Promise<OrgEntityRow | undefined> {
  if (table === "teams") {
    return resolveIdOrSlug(
      idOrSlug,
      () => getOrgEntityById(table, idOrSlug),
      () =>
        selectTeams(db)
          .where("teams.slug", "=", idOrSlug)
          .executeTakeFirst()
          .then((row) => row && withLob(row)),
    );
  }
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
  input: CreateOrgEntityInput | CreateTeamInput,
  actor: Actor,
) {
  // Boundary-validated upstream (ADR-095): routes safeParse with the
  // per-table schema before calling in.
  const parsed = input;
  const slug = parsed.slug ?? toSlug(parsed.name);
  if (!slug) {
    throw Object.assign(new Error("Could not derive a slug from the name"), {
      statusCode: 400,
      code: "VALIDATION_FAILED",
    });
  }
  await assertUniqueSlug(table, slug);
  const lobId = table === "teams" ? (parsed as CreateTeamInput).lobId : undefined;
  if (lobId) await assertLobExists(lobId);

  const id = uuidv7();
  const now = new Date().toISOString();
  return db.transaction().execute(async (trx) => {
    if (table === "teams") {
      await trx
        .insertInto("teams")
        .values({
          id,
          name: parsed.name,
          slug,
          description: parsed.description ?? null,
          lobId: lobId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    } else {
      await trx
        .insertInto("line_of_businesses")
        .values({
          id,
          name: parsed.name,
          slug,
          description: parsed.description ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }
    await writeEntityChange({
      entityType: ENTITY_TYPE[table],
      entityId: id,
      action: "created",
      changes: parsed as Record<string, unknown>,
      actor,
    }, trx);
    if (table === "teams") {
      return selectTeams(trx)
        .where("teams.id", "=", id)
        .executeTakeFirst()
        .then((row) => row && withLob(row));
    }
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
  input: UpdateOrgEntityInput | UpdateTeamInput,
  actor: Actor,
) {
  const existing = await getOrgEntityById(table, id);
  if (!existing) return null;
  const parsed = input;
  if (parsed.slug) await assertUniqueSlug(table, parsed.slug, id);
  const lobInput = table === "teams" ? (parsed as UpdateTeamInput).lobId : undefined;
  if (lobInput) await assertLobExists(lobInput);

  const updates: Record<string, unknown> = {};
  if (parsed.name !== undefined) updates.name = parsed.name;
  if (parsed.slug !== undefined) updates.slug = parsed.slug;
  if (parsed.description !== undefined) updates.description = parsed.description;
  if (lobInput !== undefined) updates.lobId = lobInput;
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
    if (table === "teams") {
      return selectTeams(trx)
        .where("teams.id", "=", id)
        .executeTakeFirst()
        .then((row) => row && withLob(row));
    }
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
    if (table === "line_of_businesses") {
      // FR-008: clearing the association is a change to each team — record
      // it like any other team field change (FK SET NULL stays the net).
      const affected = await trx
        .selectFrom("teams")
        .select("id")
        .where("lobId", "=", id)
        .execute();
      if (affected.length > 0) {
        const now = new Date().toISOString();
        await trx
          .updateTable("teams")
          .set({ lobId: null, updatedAt: now })
          .where("lobId", "=", id)
          .execute();
        for (const team of affected) {
          await writeEntityChange({
            entityType: "team",
            entityId: team.id,
            action: "updated",
            changes: { lobId: null },
            actor,
          }, trx);
        }
      }
    }
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
