import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { updateSettingsSchema, updateOidcConfigSchema } from "@componode/core";
import { getSettings, updateSettings, getOidcConfig, updateOidcConfig } from "../services/settings-service.js";
import { requireRole } from "../plugins/rbac.js";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { toActor } from "../services/actor.js";
import { validationFailed } from "./route-helpers.js";

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /settings — admin only
  app.get("/settings", {
    preHandler: [app.verifySession, requireRole("settings:update")],
  }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const settings = await getSettings();
    return reply.status(200).send({ settings });
  });

  // PATCH /settings — admin only
  app.patch("/settings", {
    preHandler: [app.verifySession, requireRole("settings:update")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }
    const settings = await updateSettings(parsed.data, toActor(req));
    return reply.status(200).send({ settings });
  });

  // GET /settings/oidc — admin only
  app.get("/settings/oidc", {
    preHandler: [app.verifySession, requireRole("oidc:configure")],
  }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const oidcConfig = await getOidcConfig();
    return reply.status(200).send({ oidcConfig });
  });

  // PUT /settings/oidc — admin only
  app.put("/settings/oidc", {
    preHandler: [app.verifySession, requireRole("oidc:configure")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const parsed = updateOidcConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }
    const oidcConfig = await updateOidcConfig(parsed.data, toActor(req));
    return reply.status(200).send({ oidcConfig });
  });
}
