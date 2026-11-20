import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  listPackagesQuerySchema,
  listPackageConsumersQuerySchema,
} from "@componode/core";
import { listPackages, listPackageConsumers } from "../services/packages-service.js";
import { validationFailed } from "./route-helpers.js";

// Spec 074 — /packages where-used reads. Authenticated for every signed-in
// user (no role gate: inventory is catalog-visible); strict Zod schemas
// reject unknown params (ADR-095). Both GETs are side-effect-free (ADR-094).
export async function packageRoutes(app: FastifyInstance) {
  app.get(
    "/packages",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = listPackagesQuerySchema.safeParse(req.query);
      if (!query.success) {
        return validationFailed(reply, query.error.issues);
      }
      return reply.status(200).send(await listPackages(query.data));
    },
  );

  app.get(
    "/packages/consumers",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = listPackageConsumersQuerySchema.safeParse(req.query);
      if (!query.success) {
        return validationFailed(reply, query.error.issues);
      }
      return reply.status(200).send(await listPackageConsumers(query.data));
    },
  );
}
