import { db } from "../db/connection.js";
import { generateSessionToken, hashToken } from "../utils/crypto.js";
import { uuidv7 } from "uuidv7";
import { getSetting } from "./settings-service.js";
import { writeAuthEvent, type Actor } from "./audit-service.js";

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

/** Coarse "Browser · OS" label from a user-agent string; null-safe. */
export function parseDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent;
  const browser = ua.includes("Edg") ? "Edge"
    : ua.includes("Firefox") ? "Firefox"
    : ua.includes("Chrome") ? "Chrome"
    : ua.includes("Safari") ? "Safari"
    : ua.includes("curl") || ua.includes("wget") ? "CLI"
    : "Unknown browser";
  const os = ua.includes("Windows") ? "Windows"
    : ua.includes("Mac OS") || ua.includes("Macintosh") ? "macOS"
    : ua.includes("Android") ? "Android"
    : ua.includes("iPhone") || ua.includes("iPad") ? "iOS"
    : ua.includes("Linux") ? "Linux"
    : null;
  return os ? `${browser} · ${os}` : browser;
}

export async function createSession(
  userId: string,
  meta?: SessionMeta,
): Promise<string> {
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
      userAgent: meta?.userAgent ?? null,
      ip: meta?.ip ?? null,
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
export async function listUserSessions(
  userId: string,
  opts?: { currentSessionHash?: string },
) {
  const rows = await db
    .selectFrom("sessions")
    .select([
      "sessions.id",
      "sessions.publicId",
      "sessions.tokenLast4",
      "sessions.userId",
      "sessions.userAgent",
      "sessions.ip",
      "sessions.createdAt",
      "sessions.lastSeenAt",
      "sessions.expiresAt",
    ])
    .where("sessions.userId", "=", userId)
    .where("sessions.revokedAt", "is", null)
    .orderBy("sessions.createdAt", "desc")
    .execute();

  return rows.map((row) => ({
    // `id` exposed is the non-secret publicId; the token hash in row.id is
    // only compared internally to mark the caller's own session (ADR-099).
    id: row.publicId,
    tokenLast4: row.tokenLast4,
    userId: row.userId,
    device: parseDevice(row.userAgent),
    ip: row.ip,
    current: opts?.currentSessionHash != null && row.id === opts.currentSessionHash,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
  }));
}
