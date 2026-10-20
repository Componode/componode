import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { listComponentsQuerySchema, updateComponentSchema } from "@componode/core";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole } from "../plugins/rbac.js";
import { listComponents, getComponentById } from "../services/component-catalog-service.js";
import { updateComponent } from "../services/component-group-service.js";
import { toActor } from "../services/actor.js";
import {
  listPlatformCandidates,
  listComponentDependents,
  promoteComponentToPlatform,
} from "../services/platform-promotion-service.js";
import { sendServiceError } from "./route-helpers.js";

export async function componentRoutes(app: FastifyInstance): Promise<void> {
  // Static route — find-my-way resolves it ahead of /components/:id.
  app.get("/components/platform-candidates", {
    preHandler: [app.verifySession],
  }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const candidates = await listPlatformCandidates();
    return reply.status(200).send({ candidates });
  });

  app.get("/components/:id/dependents", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const component = await getComponentById(id);
    if (!component) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Component not found" });
    }
    return reply.status(200).send({ dependents: await listComponentDependents(id) });
  });

  app.post("/components/:id/promote-to-platform", {
    preHandler: [app.verifySession, requireRole("product:create")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await promoteComponentToPlatform(id, req.body, toActor(req));
      return reply.status(201).send(result);
    } catch (err) {
      return sendServiceError(reply, err);
    }
  });

  app.get("/components/:id", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const component = await getComponentById(id);
    if (!component) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Component not found" });
    }
    return reply.status(200).send({ component });
  });

  app.patch("/components/:id", {
    preHandler: [app.verifySession, requireRole("component:update")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parsed = updateComponentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    try {
      const result = await updateComponent(id, parsed.data, toActor(req));
      return reply.status(200).send({ component: result });
    } catch (err) {
      const error = err as { statusCode?: number; code?: string; message?: string };
      if (error.statusCode === 404) {
        return reply.status(404).send({ code: error.code ?? "NOT_FOUND", message: error.message ?? "Not found" });
      }
      throw err;
    }
  });

  app.get("/components", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = listComponentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid query parameters",
        details: parsed.error.issues,
      });
    }

    const result = await listComponents(parsed.data);
    return reply.status(200).send(result);
  });
}
