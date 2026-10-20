import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { listSuggestionsQuerySchema } from "@componode/core";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole } from "../plugins/rbac.js";
import { metrics } from "../plugins/metrics.js";
import {
  listSuggestions,
  acceptSuggestion,
  dismissSuggestion,
  generateSuggestions,
} from "../services/edge-suggestion-service.js";
import { toActor } from "../services/actor.js";
import {
  sendServiceError,
  validationFailed,
} from "./route-helpers.js";

/**
 * ADR-113 staged DEPENDS_ON edge suggestions. Reads are any authenticated
 * role; accept/dismiss/rescan reuse the `product:edge:add` permission —
 * accepting a suggestion IS an edge write (research.md D6).
 */
export async function suggestionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/suggestions",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = listSuggestionsQuerySchema.safeParse(req.query);
      if (!parsed.success) return validationFailed(reply, parsed.error.issues);
      const result = await listSuggestions(parsed.data);
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/suggestions/:id/accept",
    { preHandler: [app.verifySession, requireRole("product:edge:add")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      try {
        const suggestion = await acceptSuggestion(id, toActor(req));
        return reply.status(200).send({ suggestion });
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.post(
    "/suggestions/:id/dismiss",
    { preHandler: [app.verifySession, requireRole("product:edge:add")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      try {
        const suggestion = await dismissSuggestion(id, toActor(req));
        return reply.status(200).send({ suggestion });
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  // Bounded synchronous whole-catalog pass (SC-002 <1 min).
  app.post(
    "/suggestions/rescan",
    { preHandler: [app.verifySession, requireRole("product:edge:add")] },
    async (_req: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        const report = await generateSuggestions({ all: true });
        return reply.status(200).send(report);
      } catch (err) {
        // User-initiated passes must surface the error (unlike the
        // failure-isolated runSuggestionPass triggers) — count it here.
        metrics.suggestionPassErrorsTotal.inc();
        return sendServiceError(reply, err);
      }
    },
  );
}
