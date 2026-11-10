import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { searchQuerySchema } from "@componode/core";
import { globalSearch } from "../services/search-service.js";
import { validationFailed } from "./route-helpers.js";

/**
 * GET /api/v1/search?q=<term>&limit=<n> — global search for the Ctrl+K
 * palette (spec 004 / contracts/api.md). Side-effect-free GET (ADR-094);
 * Zod strict validation rejecting unknown fields (ADR-095).
 */
export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/search",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return validationFailed(reply, parsed.error.issues);
      }
      const results = await globalSearch(parsed.data.q, parsed.data.limit);
      return reply.status(200).send(results);
    },
  );
}
