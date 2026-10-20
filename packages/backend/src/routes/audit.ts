import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  activityFeedQuerySchema,
  entityHistoryQuerySchema,
  correctionInputSchema,
} from "@componode/core";
import { requireRole } from "../plugins/rbac.js";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { getActivityFeed, getEntityHistory } from "../services/audit-query-service.js";
import { writeCorrection } from "../services/audit-service.js";
import { toActor } from "../services/actor.js";

const paramsSchema = z.object({
  entityType: z.string().min(1).max(100),
  entityId: z.string().uuid(),
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/audit/activity", {
    preHandler: [app.verifySession, requireRole("audit:feed")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const parsed = activityFeedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid query",
        details: parsed.error.issues,
      });
    }

    const result = await getActivityFeed(parsed.data);
    return reply.status(200).send(result);
  });

  app.get("/audit/entities/:entityType/:entityId", {
    preHandler: [app.verifySession],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid path parameters",
        details: params.error.issues,
      });
    }

    const parsed = entityHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid query",
        details: parsed.error.issues,
      });
    }

    const { entityType, entityId } = params.data;
    const result = await getEntityHistory(entityType, entityId, parsed.data);
    return reply.status(200).send(result);
  });

  app.post("/audit/corrections", {
    preHandler: [app.verifySession, requireRole("audit:correct")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const parsed = correctionInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    const { entryId, entryKind, note } = parsed.data;
    const actor = toActor(req);

    await writeCorrection(entryId, entryKind, note, actor);

    return reply.status(201).send({ ok: true });
  });
}
