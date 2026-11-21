import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
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
import {
  listDependencySuggestions,
  listDependencyGroups,
  acceptDependencySuggestion,
  dismissDependencySuggestion,
  bulkDecideDependencies,
} from "../services/dependency-suggestion-service.js";
import {
  dependencyGroupsQuerySchema,
  dependencyBulkBodySchema,
} from "@componode/core";
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
      // Spec 075: `kind=dependency` routes to the BOM queue; `edge`
      // (default) is the unchanged product-edge queue the nav badge reads.
      const result =
        parsed.data.kind === "dependency"
          ? await listDependencySuggestions(parsed.data)
          : await listSuggestions(parsed.data);
      return reply.status(200).send(result);
    },
  );

  // Spec 075 — dependency queue (ADR-132). Grouped pending read is any
  // authenticated role; decides are Editor-only (`component:edge:add`).
  app.get(
    "/suggestions/dependencies/groups",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = dependencyGroupsQuerySchema.safeParse(req.query);
      if (!parsed.success) return validationFailed(reply, parsed.error.issues);
      return reply.status(200).send(await listDependencyGroups(parsed.data));
    },
  );

  const suggestionIdParam = z.object({ id: z.string().uuid() });
  app.post(
    "/suggestions/dependencies/:id/accept",
    { preHandler: [app.verifySession, requireRole("component:edge:add")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const parsed = suggestionIdParam.safeParse(req.params);
      if (!parsed.success) return validationFailed(reply, parsed.error.issues);
      try {
        const suggestion = await acceptDependencySuggestion(
          parsed.data.id,
          toActor(req),
        );
        return reply.status(200).send({ suggestion });
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.post(
    "/suggestions/dependencies/:id/dismiss",
    { preHandler: [app.verifySession, requireRole("component:edge:add")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const parsed = suggestionIdParam.safeParse(req.params);
      if (!parsed.success) return validationFailed(reply, parsed.error.issues);
      try {
        const suggestion = await dismissDependencySuggestion(
          parsed.data.id,
          toActor(req),
        );
        return reply.status(200).send({ suggestion });
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.post(
    "/suggestions/dependencies/bulk",
    { preHandler: [app.verifySession, requireRole("component:edge:add")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const body = dependencyBulkBodySchema.safeParse(req.body);
      if (!body.success) return validationFailed(reply, body.error.issues);
      try {
        return reply
          .status(200)
          .send(await bulkDecideDependencies(body.data, toActor(req)));
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.post(
    "/suggestions/:id/accept",
    { preHandler: [app.verifySession, requireRole("product:edge:add")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const parsed = suggestionIdParam.safeParse(req.params);
      if (!parsed.success) return validationFailed(reply, parsed.error.issues);
      try {
        const suggestion = await acceptSuggestion(
          parsed.data.id,
          toActor(req),
        );
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
      const parsed = suggestionIdParam.safeParse(req.params);
      if (!parsed.success) return validationFailed(reply, parsed.error.issues);
      try {
        const suggestion = await dismissSuggestion(
          parsed.data.id,
          toActor(req),
        );
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
