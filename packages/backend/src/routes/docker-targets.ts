import type { FastifyInstance, FastifyReply } from "fastify";
import { createDockerTargetSchema, listDockerTargetsQuerySchema, probeDockerTargetSchema, testDockerTargetSchema, updateDockerTargetSchema } from "@componode/core";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole } from "../plugins/rbac.js";
import { toActor } from "../services/actor.js";
import * as svc from "../services/docker-target-service.js";

const invalid = (reply: FastifyReply, details: unknown) => reply.status(400).send({ code: "VALIDATION_FAILED", message: "Invalid input", details });
const missing = (reply: FastifyReply) => reply.status(404).send({ code: "TARGET_NOT_FOUND", message: "Docker target not found" });
const id = (req: unknown) => (req as { params: { id: string } }).params.id;

export async function dockerTargetRoutes(app: FastifyInstance) {
  app.get("/docker-targets", { preHandler: [app.verifySession, requireRole("importer:target:read")] }, async (req, reply) => {
    const p = listDockerTargetsQuerySchema.safeParse(req.query);
    if (!p.success) return invalid(reply, p.error.issues);
    return svc.listDockerTargets(p.data);
  });
  app.post("/docker-targets", { preHandler: [app.verifySession, requireRole("importer:target:create")] }, async (req: AuthenticatedRequest, reply) => { const p = createDockerTargetSchema.safeParse(req.body); if (!p.success) return invalid(reply, p.error.issues); return reply.status(201).send({ target: await svc.createDockerTarget(p.data, toActor(req)) }); });
  app.get("/docker-targets/:id", { preHandler: [app.verifySession, requireRole("importer:target:read")] }, async (req, reply) => { const target = await svc.getDockerTarget(id(req)); return target ? { target } : missing(reply); });
  app.patch("/docker-targets/:id", { preHandler: [app.verifySession, requireRole("importer:target:update")] }, async (req: AuthenticatedRequest, reply) => { const p = updateDockerTargetSchema.safeParse(req.body); if (!p.success) return invalid(reply, p.error.issues); const target = await svc.updateDockerTarget(id(req), p.data, toActor(req)); return target ? { target } : missing(reply); });
  app.post("/docker-targets/:id/enable", { preHandler: [app.verifySession, requireRole("importer:target:update")] }, async (req: AuthenticatedRequest, reply) => { const target = await svc.enableDockerTarget(id(req), toActor(req)); return target ? { target } : missing(reply); });
  app.post("/docker-targets/:id/disable", { preHandler: [app.verifySession, requireRole("importer:target:update")] }, async (req: AuthenticatedRequest, reply) => { const target = await svc.disableDockerTarget(id(req), toActor(req)); return target ? { target } : missing(reply); });
  app.post("/docker-targets/probe", { preHandler: [app.verifySession, requireRole("importer:target:test")] }, async (req: AuthenticatedRequest, reply) => { const p = probeDockerTargetSchema.safeParse(req.body); if (!p.success) return invalid(reply, p.error.issues); return svc.probeDockerTarget(p.data); });
  app.post("/docker-targets/:id/test", { preHandler: [app.verifySession, requireRole("importer:target:test")] }, async (req: AuthenticatedRequest, reply) => { const p = testDockerTargetSchema.safeParse(req.body ?? {}); if (!p.success) return invalid(reply, p.error.issues); return svc.testDockerTarget(id(req), p.data, toActor(req)); });
  app.delete("/docker-targets/:id", { preHandler: [app.verifySession, requireRole("importer:target:delete")] }, async (req: AuthenticatedRequest, reply) => { const target = await svc.deleteDockerTarget(id(req), toActor(req)); return target ? reply.status(204).send() : missing(reply); });
}
