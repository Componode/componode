import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { updateComponentInstanceSchema } from "@componode/core";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole } from "../plugins/rbac.js";
import { toActor } from "../services/actor.js";
import { updateComponentInstanceEnvironment } from "../services/component-instance-service.js";
import { sendServiceError, validationFailed } from "./route-helpers.js";

const instanceIdParam = z.object({ id: z.string().uuid() });

// Spec 071: human environment override on ComponentInstances — the only
// instance write besides spec-054 first-instance recovery. `environment`
// non-null sets the override; explicit null clears it back to the
// importer-reported value.
export async function componentInstanceRoutes(app: FastifyInstance): Promise<void> {
  app.patch(
    "/component-instances/:id",
    {
      preHandler: [app.verifySession, requireRole("component:update")],
    },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const params = instanceIdParam.safeParse(req.params);
      if (!params.success) return validationFailed(reply, params.error.issues);
      const parsed = updateComponentInstanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return validationFailed(reply, parsed.error.issues);
      }
      try {
        const instance = await updateComponentInstanceEnvironment(
          params.data.id,
          parsed.data,
          toActor(req),
        );
        return reply.status(200).send({ instance });
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );
}
