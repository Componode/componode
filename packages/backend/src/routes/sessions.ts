import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { listSessionsQuerySchema } from "@componode/core";
import {
  listOwnSessionsPage,
  listUserSessions,
  revokeSession,
} from "../services/session-service.js";
import { requireRole } from "../plugins/rbac.js";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { toActor } from "../services/actor.js";
import { validationFailed } from "./route-helpers.js";

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  // GET /sessions — the caller's own active sessions. Spec 068 / ADR-130:
  // strict query validation at the boundary; response is the
  // {data, pagination} envelope.
  app.get("/sessions", {
    preHandler: [app.verifySession],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    if (!req.user) {
      return reply.status(401).send({ code: "AUTH_NO_SESSION", message: "Not authenticated" });
    }
    const parsed = listSessionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }
    const result = await listOwnSessionsPage(req.user.id, parsed.data, {
      currentSessionHash: req.sessionId,
    });
    return reply.status(200).send(result);
  });

  // POST /sessions/:id/revoke — revoke a session
  app.post("/sessions/:id/revoke", {
    preHandler: [app.verifySession],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!req.user) {
      return reply.status(401).send({ code: "AUTH_NO_SESSION", message: "Not authenticated" });
    }

    // Users can revoke their own sessions; admins can revoke any.
    // :id is the session's non-secret publicId (UUID), not the token.

    try {
      await revokeSession(id, { id: req.user.id, role: req.user.role }, toActor(req));
      return reply.status(204).send();
    } catch (err) {
      const error = err as { statusCode?: number; code?: string; message?: string };
      if (error.statusCode === 404) {
        return reply.status(404).send({ code: error.code ?? "NOT_FOUND", message: error.message ?? "Session not found" });
      }
      if (error.statusCode === 403) {
        return reply.status(403).send({ code: error.code ?? "AUTH_FORBIDDEN", message: error.message ?? "Forbidden" });
      }
      throw err;
    }
  });

  // GET /users/:id/sessions — admin only, list a user's sessions
  app.get("/users/:id/sessions", {
    preHandler: [app.verifySession, requireRole("user:listSessions")],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const sessions = await listUserSessions(id, {
      currentSessionHash: (req as AuthenticatedRequest).sessionId,
    });
    return reply.status(200).send({ sessions });
  });
}
