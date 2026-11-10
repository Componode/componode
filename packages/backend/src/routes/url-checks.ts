import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  updateMonitoringSetupSchema,
  urlCheckMetricsQuerySchema,
  urlCheckObservationsQuerySchema,
} from "@componode/core";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole, hasPermission } from "../plugins/rbac.js";
import { toActor } from "../services/actor.js";
import { sendServiceError, validationFailed } from "./route-helpers.js";
import { getSetup, upsertSetup } from "../services/monitoring-setup-service.js";
import {
  listChecks,
  getCheckDetail,
  getMetrics,
  listObservations,
} from "../services/url-check-service.js";

const componentIdParam = z.object({
  componentId: z.string().uuid(),
});
const checkIdParam = z.object({ id: z.string().uuid() });


const forbidden = (reply: FastifyReply) =>
  reply.status(403).send({ code: "AUTH_FORBIDDEN", message: "Forbidden" });
const can = (req: AuthenticatedRequest, permission: string) =>
  hasPermission(req.user?.role ?? "VIEWER", permission);

export async function urlCheckRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/components/:componentId/monitoring-setup",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = componentIdParam.safeParse(req.params);
      if (!params.success) return validationFailed(reply, params.error.issues);
      const setup = await getSetup(params.data.componentId);
      if (!setup) {
        return reply.status(404).send({
          code: "MONITORING_SETUP_NOT_FOUND",
          message: "Monitoring setup not found",
        });
      }
      return reply.status(200).send({ setup });
    },
  );

  app.put(
    "/components/:componentId/monitoring-setup",
    {
      preHandler: [app.verifySession, requireRole("monitoringSetup:update")],
    },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const params = componentIdParam.safeParse(req.params);
      if (!params.success) return validationFailed(reply, params.error.issues);
      const parsed = updateMonitoringSetupSchema.safeParse(req.body);
      if (!parsed.success) return validationFailed(reply, parsed.error.issues);
      try {
        const existing = await getSetup(params.data.componentId);
        const existingAgentId = existing?.agentId ?? null;
        const effectiveVantage =
          parsed.data.vantage ?? existing?.vantage ?? "HUB";
        const agentSelectionChanged =
          (parsed.data.vantage === "AGENT" &&
            parsed.data.vantage !== existing?.vantage) ||
          (parsed.data.agentId !== undefined &&
            parsed.data.agentId !== existingAgentId &&
            (effectiveVantage === "AGENT" || parsed.data.agentId !== null));
        if (agentSelectionChanged && !can(req, "agent:read")) {
          return forbidden(reply);
        }
        const setup = await upsertSetup(
          params.data.componentId,
          parsed.data,
          toActor(req),
        );
        return reply.status(200).send({ setup });
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.get(
    "/components/:componentId/url-checks",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = componentIdParam.safeParse(req.params);
      if (!params.success) return validationFailed(reply, params.error.issues);
      try {
        const result = await listChecks(params.data.componentId);
        return reply.status(200).send(result);
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  // Spec 058 (ADR-126): direct check-definition writes are deprecated —
  // importer-managed definitions change only through ImporterConfig.
  const deprecatedWrite = (reply: FastifyReply) =>
    reply.status(410).send({
      code: "URL_CHECK_WRITE_DEPRECATED",
      message:
        "Direct URL check writes are deprecated — manage checks through the ImporterConfig",
    });

  app.post(
    "/components/:componentId/url-checks",
    { preHandler: [app.verifySession] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      return deprecatedWrite(reply);
    },
  );

  app.get(
    "/url-checks/:id",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = checkIdParam.safeParse(req.params);
      if (!params.success) return validationFailed(reply, params.error.issues);
      try {
        const check = await getCheckDetail(params.data.id);
        return reply.status(200).send({ check });
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.patch(
    "/url-checks/:id",
    { preHandler: [app.verifySession] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      return deprecatedWrite(reply);
    },
  );

  app.delete(
    "/url-checks/:id",
    { preHandler: [app.verifySession] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      return deprecatedWrite(reply);
    },
  );

  app.get(
    "/url-checks/:id/metrics",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = checkIdParam.safeParse(req.params);
      if (!params.success) return validationFailed(reply, params.error.issues);
      const query = urlCheckMetricsQuerySchema.safeParse(req.query);
      if (!query.success) return validationFailed(reply, query.error.issues);
      try {
        const metrics = await getMetrics(
          params.data.id,
          query.data.window as "24h" | "7d" | "30d",
        );
        return reply.status(200).send(metrics);
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.get(
    "/url-checks/:id/observations",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = checkIdParam.safeParse(req.params);
      if (!params.success) return validationFailed(reply, params.error.issues);
      const query = urlCheckObservationsQuerySchema.safeParse(req.query);
      if (!query.success) return validationFailed(reply, query.error.issues);
      try {
        const result = await listObservations(params.data.id, query.data);
        return reply.status(200).send(result);
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );
}
