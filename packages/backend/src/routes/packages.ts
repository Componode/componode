import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  listPackagesQuerySchema,
  listPackageConsumersQuerySchema,
  addToCatalogPreviewQuerySchema,
  addToCatalogBodySchema,
  linkPackageBodySchema,
  listPackageVersionsQuerySchema,
} from "@componode/core";
import { listPackages, listPackageConsumers, listPackageVersions } from "../services/packages-service.js";
import {
  previewAddToCatalog,
  addPackageToCatalog,
  linkPackageToComponent,
} from "../services/bom-curation-service.js";
import { requireRole } from "../plugins/rbac.js";
import { toActor } from "../services/actor.js";
import { sendServiceError, validationFailed } from "./route-helpers.js";

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

  // Spec 075 — every reported version for one identity (Library detail
  // "versions in use" + preview payload reuse).
  app.get(
    "/packages/versions",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = listPackageVersionsQuerySchema.safeParse(req.query);
      if (!query.success) {
        return validationFailed(reply, query.error.issues);
      }
      return reply.status(200).send(await listPackageVersions(query.data));
    },
  );

  // Spec 075 / UX-ADD — curation preview: derived mapping, consumers,
  // and any existing component covering the identity.
  app.get(
    "/packages/add-to-catalog/preview",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = addToCatalogPreviewQuerySchema.safeParse(req.query);
      if (!query.success) {
        return validationFailed(reply, query.error.issues);
      }
      try {
        return reply
          .status(200)
          .send(await previewAddToCatalog(query.data.purl));
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  // Spec 075 — atomic curation writes, Editor-only (component:edge:add).
  app.post(
    "/packages/add-to-catalog",
    { preHandler: [app.verifySession, requireRole("component:edge:add")] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = addToCatalogBodySchema.safeParse(req.body);
      if (!body.success) {
        return validationFailed(reply, body.error.issues);
      }
      try {
        return reply
          .status(200)
          .send(await addPackageToCatalog(body.data, toActor(req)));
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.post(
    "/packages/link",
    { preHandler: [app.verifySession, requireRole("component:edge:add")] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = linkPackageBodySchema.safeParse(req.body);
      if (!body.success) {
        return validationFailed(reply, body.error.issues);
      }
      try {
        return reply
          .status(200)
          .send(await linkPackageToComponent(body.data, toActor(req)));
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );
}
