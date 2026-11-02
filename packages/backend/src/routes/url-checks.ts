import { isDeepStrictEqual } from "node:util";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  createUrlCheckSchema,
  updateUrlCheckSchema,
  updateMonitoringSetupSchema,
  urlCheckMetricsQuerySchema,
  urlCheckObservationsQuerySchema,
} from "@componode/core";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole, hasPermission } from "../plugins/rbac.js";
import { toActor } from "../services/actor.js";
import { sendServiceError } from "./route-helpers.js";
import { getSetup, upsertSetup } from "../services/monitoring-setup-service.js";
import {
  listChecks,
  getCheck,
  getCheckDetail,
  createCheck,
  updateCheck,
  deleteCheck,
  getMetrics,
  listObservations,
} from "../services/url-check-service.js";

const componentIdParam = z.object({
  componentId: z.string().uuid(),
});
const checkIdParam = z.object({ id: z.string().uuid() });

const badParams = (reply: FastifyReply) =>
  reply.status(400).send({
    code: "VALIDATION_FAILED",
    message: "Invalid path parameters",
  });

const validationFailed = (reply: FastifyReply, issues: unknown) =>
  reply.status(400).send({
    code: "VALIDATION_FAILED",
    message: "Invalid input",
    details: issues,
  });

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
      if (!params.success) return badParams(reply);
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
      if (!params.success) return badParams(reply);
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
      if (!params.success) return badParams(reply);
      try {
        const result = await listChecks(params.data.componentId);
        return reply.status(200).send(result);
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.post(
    "/components/:componentId/url-checks",
    { preHandler: [app.verifySession, requireRole("urlCheck:create")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const params = componentIdParam.safeParse(req.params);
      if (!params.success) return badParams(reply);
      const parsed = createUrlCheckSchema.safeParse(req.body);
      if (!parsed.success) return validationFailed(reply, parsed.error.issues);
      if (parsed.data.credentialId != null && !can(req, "credential:read")) {
        return forbidden(reply);
      }
      try {
        const check = await createCheck(
          params.data.componentId,
          parsed.data,
          toActor(req),
        );
        return reply.status(201).send({ check });
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.get(
    "/url-checks/:id",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = checkIdParam.safeParse(req.params);
      if (!params.success) return badParams(reply);
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
    { preHandler: [app.verifySession, requireRole("urlCheck:update")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const params = checkIdParam.safeParse(req.params);
      if (!params.success) return badParams(reply);
      const parsed = updateUrlCheckSchema.safeParse(req.body);
      if (!parsed.success) return validationFailed(reply, parsed.error.issues);
      try {
        const existing = await getCheck(params.data.id);
        const effectiveAuthMode = parsed.data.authMode ?? existing.authMode;
        const credentialChanged =
          (parsed.data.credentialId !== undefined &&
            parsed.data.credentialId !== existing.credentialId &&
            (parsed.data.credentialId !== null ||
              effectiveAuthMode !== "NONE")) ||
          (parsed.data.authMode !== undefined &&
            parsed.data.authMode !== existing.authMode &&
            parsed.data.authMode !== "NONE") ||
          (parsed.data.authConfig !== undefined &&
            !isDeepStrictEqual(parsed.data.authConfig, existing.authConfig) &&
            (parsed.data.authConfig !== null || effectiveAuthMode !== "NONE"));
        if (credentialChanged && !can(req, "credential:read")) {
          return forbidden(reply);
        }
        if (
          effectiveAuthMode === "NONE" &&
          (parsed.data.credentialId != null || parsed.data.authConfig != null)
        ) {
          return validationFailed(reply, [
            {
              message:
                "credentialId and authConfig are only allowed with an auth mode",
            },
          ]);
        }
        const check = await updateCheck(
          params.data.id,
          parsed.data,
          toActor(req),
        );
        return reply.status(200).send({ check });
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.delete(
    "/url-checks/:id",
    { preHandler: [app.verifySession, requireRole("urlCheck:delete")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const params = checkIdParam.safeParse(req.params);
      if (!params.success) return badParams(reply);
      try {
        await deleteCheck(params.data.id, toActor(req));
        return reply.status(204).send();
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.get(
    "/url-checks/:id/metrics",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = checkIdParam.safeParse(req.params);
      if (!params.success) return badParams(reply);
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
      if (!params.success) return badParams(reply);
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
