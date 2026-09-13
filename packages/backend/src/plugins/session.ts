import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db/connection.js";
import { hashToken } from "../utils/crypto.js";
import { getSetting } from "../services/settings-service.js";

const SESSION_COOKIE_NAME = "componode_session";
const LAST_SEEN_UPDATE_INTERVAL_MS = 60_000; // Throttle lastSeenAt updates to once per 60s

export interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    id: string;
    username: string;
    role: string;
    displayName: string | null;
  };
  sessionId?: string;
}

export async function sessionPlugin(app: FastifyInstance): Promise<void> {
  // Session verification preHandler — applied to protected routes
  app.decorate("verifySession", async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const sessionToken = req.cookies?.[SESSION_COOKIE_NAME];

    if (!sessionToken) {
      return reply.status(401).send({ code: "AUTH_NO_SESSION", message: "No session cookie" });
    }

    // Sessions are looked up by the SHA-256 of the bearer token — the
    // plaintext token is never stored (ADR-099).
    const sessionHash = hashToken(sessionToken);
    const session = await db
      .selectFrom("sessions")
      .select([
        "sessions.id",
        "sessions.userId",
        "sessions.createdAt",
        "sessions.lastSeenAt",
        "sessions.expiresAt",
        "sessions.revokedAt",
      ])
      .where("sessions.id", "=", sessionHash)
      .executeTakeFirst();

    if (!session) {
      return reply.status(401).send({ code: "AUTH_NO_SESSION", message: "Session not found" });
    }

    if (session.revokedAt !== null) {
      return reply.status(401).send({ code: "AUTH_NO_SESSION", message: "Session revoked" });
    }

    const now = new Date();

    if (new Date(session.expiresAt) < now) {
      return reply.status(401).send({ code: "AUTH_NO_SESSION", message: "Session expired" });
    }

    // Idle timeout check
    const idleTimeoutMs = Number(await getSetting("sessionIdleTimeoutMs"));
    const lastSeen = new Date(session.lastSeenAt);
    const idleMs = now.getTime() - lastSeen.getTime();
    if (idleMs > idleTimeoutMs) {
      return reply.status(401).send({ code: "AUTH_NO_SESSION", message: "Session idle timeout" });
    }

    // Load user
    const user = await db
      .selectFrom("persons")
      .select([
        "persons.id",
        "persons.username",
        "persons.role",
        "persons.displayName",
        "persons.isActive",
      ])
      .where("persons.id", "=", session.userId)
      .executeTakeFirst();

    if (!user || !user.isActive) {
      return reply.status(401).send({ code: "AUTH_NO_SESSION", message: "User not found or inactive" });
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
    };
    req.sessionId = sessionHash;

    // Throttled lastSeenAt update
    if (idleMs > LAST_SEEN_UPDATE_INTERVAL_MS) {
      await db
        .updateTable("sessions")
        .set({ lastSeenAt: now.toISOString() })
        .where("sessions.id", "=", sessionHash)
        .execute();
    }
  });
}

export { SESSION_COOKIE_NAME };
