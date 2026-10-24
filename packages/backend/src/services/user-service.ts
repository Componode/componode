import { uuidv7 } from "uuidv7";
import { db } from "../db/connection.js";
import { hashPassword } from "../utils/argon2.js";
import type { CreateUserInput, UpdateUserInput } from "@componode/core";
import { writeEntityChange, type Actor } from "./audit-service.js";

function slugify(username: string): string {
  return username.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function getUserByIdWithTrx(
  trx: import("kysely").Transaction<import("../db/types.js").DB> | typeof db,
  id: string,
) {
  return trx
    .selectFrom("persons")
    .select([
      "persons.id",
      "persons.username",
      "persons.role",
      "persons.displayName",
      "persons.email",
      "persons.teamId",
      "persons.slug",
      "persons.isActive",
      "persons.createdAt",
      "persons.updatedAt",
    ])
    .where("persons.id", "=", id)
    .executeTakeFirst();
}

export async function createUser(input: CreateUserInput, actor: Actor) {
  const existing = await db
    .selectFrom("persons")
    .select("persons.id")
    .where("persons.username", "=", input.username)
    .executeTakeFirst();

  if (existing) {
    throw Object.assign(new Error("Username already taken"), {
      statusCode: 409,
      code: "AUTH_USERNAME_TAKEN",
    });
  }

  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();
  const id = uuidv7();

  return db.transaction().execute(async (trx) => {
    await trx
      .insertInto("persons")
      .values({
        id,
        username: input.username,
        passwordHash,
        role: input.role,
        displayName: input.displayName ?? null,
        email: input.email ?? null,
        teamId: input.teamId ?? null,
        slug: slugify(input.username),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await writeEntityChange(
      {
        entityType: "user",
        entityId: id,
        action: "created",
        changes: { role: input.role, teamId: input.teamId ?? null, displayName: input.displayName ?? null },
        actor,
      },
      trx,
    );

    return getUserByIdWithTrx(trx, id);
  });
}

export async function listUsers(filters: { role?: string; isActive?: boolean; search?: string } = {}) {
  let query = db.selectFrom("persons").select([
    "persons.id",
    "persons.username",
    "persons.role",
    "persons.displayName",
    "persons.email",
    "persons.teamId",
    "persons.slug",
    "persons.isActive",
    "persons.createdAt",
    "persons.updatedAt",
  ]);

  if (filters.role) {
    query = query.where("persons.role", "=", filters.role);
  }

  if (filters.isActive !== undefined) {
    query = query.where("persons.isActive", "=", filters.isActive);
  }

  if (filters.search) {
    query = query.where("persons.username", "ilike", `%${filters.search}%`);
  }

  return query.orderBy("persons.createdAt", "desc").execute();
}

export async function getUserById(id: string) {
  return getUserByIdWithTrx(db, id);
}

export async function getUserByUsername(username: string) {
  return db
    .selectFrom("persons")
    .select([
      "persons.id",
      "persons.username",
      "persons.role",
      "persons.displayName",
      "persons.email",
      "persons.teamId",
      "persons.slug",
      "persons.isActive",
      "persons.createdAt",
      "persons.updatedAt",
    ])
    .where("persons.username", "=", username)
    .executeTakeFirst();
}

export async function updateUser(id: string, input: UpdateUserInput, actor: Actor) {
  const existing = await getUserById(id);
  if (!existing) {
    return null;
  }

  const updates: Record<string, unknown> = {};
  if (input.role !== undefined) updates.role = input.role;
  // persons.displayName is nullable and createUser stores null — normalize
  // "" to null so there is one empty representation (`displayName ?? username`
  // fallbacks on audit/avatar surfaces would render blank on "").
  if (input.displayName !== undefined) {
    updates.displayName = input.displayName === "" ? null : input.displayName;
  }
  if (input.email !== undefined) updates.email = input.email;
  if (input.teamId !== undefined) updates.teamId = input.teamId;
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  updates.updatedAt = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable("persons")
      .set(updates)
      .where("persons.id", "=", id)
      .execute();

    const action =
      input.isActive !== undefined && input.isActive !== existing.isActive
        ? input.isActive
          ? "activated"
          : "deactivated"
        : input.role !== undefined && input.role !== existing.role
          ? "role_changed"
          : "updated";

    await writeEntityChange(
      {
        entityType: "user",
        entityId: id,
        action,
        changes: updates,
        actor,
      },
      trx,
    );

    return getUserByIdWithTrx(trx, id);
  });
}
