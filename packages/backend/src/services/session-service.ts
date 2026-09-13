import { db } from "../db/connection.js";
import { generateSessionToken, hashToken } from "../utils/crypto.js";
import { uuidv7 } from "uuidv7";
import { getSetting } from "./settings-service.js";
import { writeAuthEvent, type Actor } from "./audit-service.js";

export async function createSession(userId: string): Promise<string> {
  const sessionToken = generateSessionToken();
  const now = new Date();
  const absoluteTimeoutMs = Number(await getSetting("sessionAbsoluteTimeoutMs"));
  const expiresAt = new Date(now.getTime() + absoluteTimeoutMs);

  // `id` stores SHA-256(token); the plaintext token never touches the DB.
  // `tokenLast4` is kept for display so users can match a session to the
  // cookie shown in their browser devtools.
  await db
    .insertInto("sessions")
    .values({
      id: hashToken(sessionToken),
      publicId: uuidv7(),
      userId,
      tokenLast4: sessionToken.slice(-4),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
    .execute();

  return sessionToken;
}

/**
 * Revoke a session by its non-secret publicId (never by the token — the
 * token is a credential and is not exposed to clients).
 *
 * Authorization: a user may revoke their own sessions; only ADMINs may
 * revoke another user's session.
 */
export async function revokeSession(
  publicId: string,
  caller: { id: string; role: string },
  actor: Actor,
): Promise<void> {
  const session = await db
    .selectFrom("sessions")
    .select(["id", "userId"])
    .where("sessions.publicId", "=", publicId)
    .executeTakeFirst();

  if (!session) {
    throw Object.assign(new Error("Session not found"), {
      statusCode: 404,
      code: "NOT_FOUND",
    });
  }

  if (caller.role !== "ADMIN" && session.userId !== caller.id) {
    throw Object.assign(new Error("Cannot revoke another user's session"), {
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
  }

  const now = new Date().toISOString();
  await db
    .updateTable("sessions")
    .set({ revokedAt: now })
    .where("sessions.publicId", "=", publicId)
    .execute();

  await writeAuthEvent("revoked", null, { id: session.userId, name: actor.name ?? actor.id });
}

export async function revokeUserSessions(userId: string, actor: Actor): Promise<void> {
  const now = new Date().toISOString();
  await db
    .updateTable("sessions")
    .set({ revokedAt: now })
    .where("sessions.userId", "=", userId)
    .where("sessions.revokedAt", "is", null)
    .execute();

  await writeAuthEvent("revoked", null, { id: userId, name: actor.name ?? actor.id });
}

/**
 * List active sessions for a user. Returns the non-secret `publicId` as `id`
 * plus the last 4 characters of the token for display (001-foundation
 * contract: session tokens are never returned by the API).
 */
export async function listUserSessions(userId: string) {
  const rows = await db
    .selectFrom("sessions")
    .select([
      "sessions.publicId",
      "sessions.tokenLast4",
      "sessions.createdAt",
      "sessions.lastSeenAt",
      "sessions.expiresAt",
    ])
    .where("sessions.userId", "=", userId)
    .where("sessions.revokedAt", "is", null)
    .orderBy("sessions.createdAt", "desc")
    .execute();

  return rows.map((row) => ({
    id: row.publicId,
    tokenLast4: row.tokenLast4,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
  }));
}
