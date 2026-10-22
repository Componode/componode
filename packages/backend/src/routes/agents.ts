import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  createImportAgentSchema,
  listAgentSessionsQuerySchema,
  updateImportAgentSchema,
} from "@componode/core";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole } from "../plugins/rbac.js";
import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgentConfigs,
  listAgentRuns,
  listAgentSessions,
  listAgents,
  revokeAgent,
  rotateAgentCredential,
  updateAgent,
} from "../services/agent-service.js";
import { toActor } from "../services/actor.js";

// Import Agent management routes (spec 025, ADR-116) — admin-only, browser
// session auth. Agent-facing bearer routes live in agent-channel.ts.
export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/agents",
    {
      preHandler: [app.verifySession, requireRole("agent:read")],
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const agents = await listAgents(app.remoteRuns);
      return reply.status(200).send({ agents });
    },
  );

  app.post(
    "/agents",
    {
      preHandler: [app.verifySession, requireRole("agent:create")],
    },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const parsed = createImportAgentSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_FAILED",
          message: "Invalid input",
          details: parsed.error.issues,
        });
      }

      const result = await createAgent(parsed.data, toActor(req));
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/agents/:id",
    {
      preHandler: [app.verifySession, requireRole("agent:read")],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const agent = await getAgent(id, app.remoteRuns);
      if (!agent) {
        return reply.status(404).send({
          code: "AGENT_NOT_FOUND",
          message: "Agent not found",
        });
      }
      return reply.status(200).send({ agent });
    },
  );

  app.patch(
    "/agents/:id",
    {
      preHandler: [app.verifySession, requireRole("agent:update")],
    },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const parsed = updateImportAgentSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_FAILED",
          message: "Invalid input",
          details: parsed.error.issues,
        });
      }
      const agent = await updateAgent(id, parsed.data, toActor(req));
      return reply.status(200).send({ agent });
    },
  );

  // Issue a fresh single-use enrollment token (rotation). The old credential
  // stays valid until the new token is exchanged.
  app.post(
    "/agents/:id/enroll",
    {
      preHandler: [app.verifySession, requireRole("agent:update")],
    },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const result = await rotateAgentCredential(id, toActor(req));
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/agents/:id/revoke",
    {
      preHandler: [app.verifySession, requireRole("agent:update")],
    },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const agent = await revokeAgent(id, toActor(req), app.agentSessions);
      return reply.status(200).send({ agent });
    },
  );

  // Configs bound to this agent, with the read-time incompatibility flag
  // (spec 027 US5/US6).
  app.get(
    "/agents/:id/configs",
    {
      preHandler: [app.verifySession, requireRole("agent:read")],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const configs = await listAgentConfigs(id);
      return reply.status(200).send({ configs });
    },
  );

  // Runs this agent executed — durable history (spec 027 US5).
  app.get(
    "/agents/:id/runs",
    {
      preHandler: [app.verifySession, requireRole("agent:read")],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const parsed = listAgentSessionsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_FAILED",
          message: "Invalid query",
          details: parsed.error.issues,
        });
      }
      const runs = await listAgentRuns(id, parsed.data.limit);
      return reply.status(200).send({ runs });
    },
  );

  app.get(
    "/agents/:id/sessions",
    {
      preHandler: [app.verifySession, requireRole("agent:read")],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const parsed = listAgentSessionsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_FAILED",
          message: "Invalid query",
          details: parsed.error.issues,
        });
      }
      const sessions = await listAgentSessions(id, parsed.data.limit);
      return reply.status(200).send({ sessions });
    },
  );

  app.delete(
    "/agents/:id",
    {
      preHandler: [app.verifySession, requireRole("agent:delete")],
    },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      await deleteAgent(id, toActor(req), app.agentSessions);
      return reply.status(204).send();
    },
  );
}
