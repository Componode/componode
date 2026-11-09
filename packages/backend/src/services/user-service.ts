import { uuidv7 } from "uuidv7";
import { db } from "../db/connection.js";
import { hashPassword } from "../utils/argon2.js";
import {
  type CreateUserInput,
  type UpdateUserInput,
  type ListUsersQuery,
  type Paginated,
} from "@componode/core";
import { writeEntityChange, type Actor } from "./audit-service.js";
import { paginateQuery } from "../utils/pagination.js";

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

/** List-row shape for GET /users — credential columns are never selected. */
export interface UserListItem {
  id: string;
  username: string;
  role: string;
  displayName: string | null;
  email: string | null;
  teamId: string | null;
  slug: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
}

/**
 * Spec 068 / ADR-130: standardized list contract for GET /users (admin).
 * Selects never include `passwordHash` — credential material stays out of
 * list rows. `lastActiveAt` is the derived most-recent-session sighting,
 * now a per-row subquery so it can drive the `lastActiveAt` sort key.
 * `search` covers the fields the users table searches client-side today
 * (display name, email, username).
 */
export async function listUsers(
  parsed: ListUsersQuery,
): Promise<Paginated<UserListItem>> {
  let query = db.selectFrom("persons").select((eb) => [
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
    // Last activity = the user's most recent session sighting across ALL
    // session rows (revoked/expired included — same semantics the previous
    // grouped post-query used).
    eb
      .selectFrom("sessions")
      .select((eb2) => eb2.fn.max("sessions.lastSeenAt").as("m"))
      .whereRef("sessions.userId", "=", "persons.id")
      .as("lastActiveAt"),
  ]);

  if (parsed.role) {
    query = query.where("persons.role", "=", parsed.role);
  }

  if (parsed.isActive !== undefined) {
    query = query.where("persons.isActive", "=", parsed.isActive);
  }

  if (parsed.search) {
    const term = `%${parsed.search}%`;
    query = query.where((eb) =>
      eb.or([
        eb("persons.username", "ilike", term),
        eb("persons.displayName", "ilike", term),
        eb("persons.email", "ilike", term),
      ]),
    );
  }

  const { data, pagination } = await paginateQuery(
    query,
    { page: parsed.page, pageSize: parsed.pageSize },
    {
      orderBy: (q) => {
        const primary =
          parsed.sort === "name"
            ? // Display name with username fallback (schema-documented).
              q.orderBy(
                (eb) => eb.fn.coalesce("persons.displayName", "persons.username"),
                parsed.order,
              )
            : parsed.sort === "role"
              ? q.orderBy("persons.role", parsed.order)
              : parsed.sort === "isActive"
                ? q.orderBy("persons.isActive", parsed.order)
                : parsed.sort === "lastActiveAt"
                  ? q.orderBy("lastActiveAt", parsed.order)
                  : q.orderBy("persons.createdAt", parsed.order);
        // Deterministic tie-break (ADR-130).
        return primary.orderBy("persons.id", parsed.order);
      },
    },
  );

  return {
    data: data.map((r) => ({ ...r, lastActiveAt: r.lastActiveAt ?? null })),
    pagination,
  };
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
