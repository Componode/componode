import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  createComponentGroupSchema,
  listComponentGroupsQuerySchema,
  updateComponentGroupSchema,
} from "@componode/core";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole } from "../plugins/rbac.js";
import {
  listComponentGroups,
  getComponentGroup,
  createComponentGroup,
  updateComponentGroup,
  deleteComponentGroup,
} from "../services/component-group-service.js";
import { toActor } from "../services/actor.js";
import { validationFailed } from "./route-helpers.js";

export async function componentGroupRoutes(app: FastifyInstance): Promise<void> {
  // Spec 068 / ADR-130 / ADR-095: strict query validation at the route
  // boundary — malformed params are a controlled 400, never a service 500.
  app.get("/component-groups", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = listComponentGroupsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }
    const result = await listComponentGroups(parsed.data);
    return reply.status(200).send(result);
  });

  app.get("/component-groups/:id", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = z.object({ id: z.string().min(1).max(200) }).safeParse(req.params);
    if (!parsed.success) return validationFailed(reply, parsed.error.issues);
    const group = await getComponentGroup(parsed.data.id);
    if (!group) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Component group not found" });
    }
    return reply.status(200).send({ group });
  });

  app.post("/component-groups", {
    preHandler: [app.verifySession, requireRole("componentGroup:create")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const parsed = createComponentGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }

    try {
      const group = await createComponentGroup(parsed.data, toActor(req));
      return reply.status(201).send({ group });
    } catch (err) {
      const error = err as { statusCode?: number; code?: string; message?: string };
      if (error.statusCode === 409) {
        return reply.status(409).send({ code: error.code ?? "CONFLICT", message: error.message ?? "Conflict" });
      }
      throw err;
    }
  });

  app.patch("/component-groups/:id", {
    preHandler: [app.verifySession, requireRole("componentGroup:update")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parsed = updateComponentGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }

    try {
      const group = await updateComponentGroup(id, parsed.data, toActor(req));
      if (!group) {
        return reply.status(404).send({ code: "NOT_FOUND", message: "Component group not found" });
      }
      return reply.status(200).send({ group });
    } catch (err) {
      const error = err as { statusCode?: number; code?: string; message?: string };
      if (error.statusCode === 409) {
        return reply.status(409).send({ code: error.code ?? "CONFLICT", message: error.message ?? "Conflict" });
      }
      throw err;
    }
  });

  app.delete("/component-groups/:id", {
    preHandler: [app.verifySession, requireRole("componentGroup:delete")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const group = await deleteComponentGroup(id, toActor(req));
    if (!group) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Component group not found" });
    }
    return reply.status(204).send();
  });
}
