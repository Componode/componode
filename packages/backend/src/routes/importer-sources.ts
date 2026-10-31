import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { importerSourceListQuerySchema } from "@componode/core";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole } from "../plugins/rbac.js";
import {
  listSources,
  getSource,
  listSourceRuns,
  listSourceMemberships,
  retireSource,
  reactivateSource,
} from "../services/importer-source-service.js";
import { toActor } from "../services/actor.js";
import { sendServiceError, validationFailed } from "./route-helpers.js";

const idParamsSchema = z.object({ id: z.string().uuid() });



// ImporterSource lifecycle surface (spec 044, contracts/source-api.md).
export async function importerSourceRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/importer-sources", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = importerSourceListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }
    const sources = await listSources(parsed.data);
    return reply.status(200).send({ sources });
  });

  app.get("/importer-sources/:id", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = idParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }
    const { id } = parsed.data;
    const source = await getSource(id);
    if (!source) {
      return reply.status(404).send({ code: "SOURCE_NOT_FOUND", message: "Importer source not found" });
    }
    return reply.status(200).send({ source });
  });

  app.get("/importer-sources/:id/runs", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = idParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }
    const { id } = parsed.data;
    const source = await getSource(id);
    if (!source) {
      return reply.status(404).send({ code: "SOURCE_NOT_FOUND", message: "Importer source not found" });
    }
    const runs = await listSourceRuns(id);
    return reply.status(200).send({ runs });
  });

  app.get("/importer-sources/:id/memberships", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = idParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }
    const { id } = parsed.data;
    const source = await getSource(id);
    if (!source) {
      return reply.status(404).send({ code: "SOURCE_NOT_FOUND", message: "Importer source not found" });
    }
    const memberships = await listSourceMemberships(id);
    return reply.status(200).send(memberships);
  });

  app.post("/importer-sources/:id/retire", {
    preHandler: [app.verifySession, requireRole("importer:source:retire")],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = idParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }
    const { id } = parsed.data;
    try {
      const source = await retireSource(id, toActor(req as AuthenticatedRequest));
      return reply.status(200).send({ source });
    } catch (err) {
      return sendServiceError(reply, err);
    }
  });

  app.post("/importer-sources/:id/reactivate", {
    preHandler: [app.verifySession, requireRole("importer:source:reactivate")],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = idParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }
    const { id } = parsed.data;
    try {
      const source = await reactivateSource(id, toActor(req as AuthenticatedRequest));
      return reply.status(200).send({ source });
    } catch (err) {
      return sendServiceError(reply, err);
    }
  });
}
