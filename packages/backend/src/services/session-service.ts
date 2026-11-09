import { db } from "../db/connection.js";
import { generateSessionToken, hashToken } from "../utils/crypto.js";
import { uuidv7 } from "uuidv7";
import {
  type ListSessionsQuery,
  type Paginated,
} from "@componode/core";
import { getSetting } from "./settings-service.js";
import { writeAuthEvent, type Actor } from "./audit-service.js";
import { paginateQuery, sortTarget, type OrderTarget } from "../utils/pagination.js";

type SessionSortKey = NonNullable<ListSessionsQuery["sort"]>;

/** Sort whitelist mirrors listSessionsQuerySchema — `location` orders by
 *  the stored `ip` column (spec 069 / B.3). */
const SESSION_SORT_COLUMNS: Record<SessionSortKey, OrderTarget> = {
  createdAt: "sessions.createdAt",
  lastSeenAt: "sessions.lastSeenAt",
  expiresAt: "sessions.expiresAt",
  location: "sessions.ip",
};

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

/** Columns every session list row exposes — the token hash `id` is
 *  selected only to mark the caller's own session, never serialized. */
const SESSION_LIST_COLUMNS = [
  "sessions.id",
  "sessions.publicId",
  "sessions.tokenLast4",
  "sessions.userId",
  "sessions.userAgent",
  "sessions.ip",
  "sessions.createdAt",
  "sessions.lastSeenAt",
  "sessions.expiresAt",
] as const;

type SessionListRow = {
  id: string;
  publicId: string;
  tokenLast4: string;
  userId: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

/** Session list DTO — `id` exposed is the non-secret publicId (ADR-099);
 *  the token hash in row.id is only compared internally to mark the
 *  caller's own session. */
function toSessionDto(row: SessionListRow, currentSessionHash?: string) {
  return {
    id: row.publicId,
    tokenLast4: row.tokenLast4,
    userId: row.userId,
    device: parseDevice(row.userAgent),
    ip: row.ip,
    current: currentSessionHash != null && row.id === currentSessionHash,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * List active sessions for a user. Returns the non-secret `publicId` as `id`
 * plus the last 4 characters of the token for display (001-foundation
 * contract: session tokens are never returned by the API).
 *
 * Used by the exempt detail sub-list `GET /users/:id/sessions` — the
 * standardized paginated variant for `GET /sessions` is
 * {@link listOwnSessionsPage} below.
 */
export async function listUserSessions(
  userId: string,
  opts?: { currentSessionHash?: string },
) {
  const rows = await db
    .selectFrom("sessions")
    .select(SESSION_LIST_COLUMNS)
    .where("sessions.userId", "=", userId)
    .where("sessions.revokedAt", "is", null)
    // Active sign-ins only — an expired row can't authenticate, so it
    // isn't manageable state (the audit feed retains the history).
    .where("sessions.expiresAt", ">", new Date().toISOString())
    .orderBy("sessions.createdAt", "desc")
    .execute();

  return rows.map((row) => toSessionDto(row, opts?.currentSessionHash));
}

/**
 * Spec 068 / ADR-130: standardized list contract for GET /sessions — the
 * caller's own active sessions. Same active-row filters as
 * {@link listUserSessions}; `search` matches the device/user-agent
 * fragment (and IP); sort keys are real `sessions` columns.
 */
export async function listOwnSessionsPage(
  userId: string,
  query: ListSessionsQuery,
  opts?: { currentSessionHash?: string },
): Promise<Paginated<ReturnType<typeof toSessionDto>>> {
  let filtered = db
    .selectFrom("sessions")
    .select(SESSION_LIST_COLUMNS)
    .where("sessions.userId", "=", userId)
    .where("sessions.revokedAt", "is", null)
    .where("sessions.expiresAt", ">", new Date().toISOString());

  if (query.search) {
    const term = `%${query.search}%`;
    filtered = filtered.where((eb) =>
      eb.or([
        eb("sessions.userAgent", "ilike", term),
        eb("sessions.ip", "ilike", term),
      ]),
    );
  }

  const { data, pagination } = await paginateQuery(
    filtered,
    { page: query.page, pageSize: query.pageSize },
    {
      orderBy: (q) =>
        // Deterministic tie-break (ADR-130) — sessions.id is the token
        // hash PK; unique and stable within a page set.
        q.orderBy(sortTarget(SESSION_SORT_COLUMNS, query.sort, SESSION_SORT_COLUMNS.createdAt), query.order).orderBy(
          "sessions.id",
          query.order,
        ),
    },
  );

  return {
    data: data.map((row) => toSessionDto(row, opts?.currentSessionHash)),
    pagination,
  };
}
