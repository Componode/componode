import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  createOrgEntitySchema,
  updateOrgEntitySchema,
  createTeamSchema,
  updateTeamSchema,
} from "@componode/core";

import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole } from "../plugins/rbac.js";
import {
  listOrgEntities,
  getOrgEntity,
  getTeamMembers,
  createOrgEntity,
  updateOrgEntity,
  deleteOrgEntity,
} from "../services/org-service.js";
import { toActor } from "../services/actor.js";
import { sendServiceError } from "./route-helpers.js";

const detailParamsSchema = z.object({ id: z.string().min(1).max(200) });

type OrgTable = "line_of_businesses" | "teams";

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  const register = (
    base: "/lobs" | "/teams",
    table: OrgTable,
    prefix: "lob" | "team",
  ) => {
    // ADR-095 — Zod at the route boundary; teams accept lobId, LOBs reject it.
    const createSchema =
      table === "teams" ? createTeamSchema : createOrgEntitySchema;
    const updateSchema =
      table === "teams" ? updateTeamSchema : updateOrgEntitySchema;
    app.get(
      base,
      { preHandler: [app.verifySession] },
      async (_req: FastifyRequest, reply: FastifyReply) => {
        const rows = await listOrgEntities(table);
        const key = base === "/lobs" ? "lobs" : "teams";
        return reply.status(200).send({ [key]: rows });
      },
    );

    app.get(
      `${base}/:id`,
      { preHandler: [app.verifySession] },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const parsed = detailParamsSchema.safeParse(req.params);
        if (!parsed.success) {
          return reply.status(400).send({
            code: "VALIDATION_FAILED",
            message: "Invalid path parameters",
          });
        }
        const row = await getOrgEntity(table, parsed.data.id);
        if (!row) {
          return reply
            .status(404)
            .send({ code: "NOT_FOUND", message: "Not found" });
        }
        return reply.status(200).send({ [prefix]: row });
      },
    );

    app.post(
      base,
      { preHandler: [app.verifySession, requireRole(`${prefix}:create`)] },
      async (req: AuthenticatedRequest, reply: FastifyReply) => {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.status(400).send({
            code: "VALIDATION_FAILED",
            message: "Invalid request body",
          });
        }
        try {
          const row = await createOrgEntity(table, parsed.data, toActor(req));
          return reply.status(201).send({ [prefix]: row });
        } catch (err) {
          return sendServiceError(reply, err);
        }
      },
    );

    app.patch(
      `${base}/:id`,
      { preHandler: [app.verifySession, requireRole(`${prefix}:update`)] },
      async (req: AuthenticatedRequest, reply: FastifyReply) => {
        const { id } = req.params as { id: string };
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.status(400).send({
            code: "VALIDATION_FAILED",
            message: "Invalid request body",
          });
        }
        try {
          const row = await updateOrgEntity(table, id, parsed.data, toActor(req));
          if (!row) {
            return reply
              .status(404)
              .send({ code: "NOT_FOUND", message: "Not found" });
          }
          return reply.status(200).send({ [prefix]: row });
        } catch (err) {
          return sendServiceError(reply, err);
        }
      },
    );

    app.delete(
      `${base}/:id`,
      { preHandler: [app.verifySession, requireRole(`${prefix}:delete`)] },
      async (req: AuthenticatedRequest, reply: FastifyReply) => {
        const { id } = req.params as { id: string };
        try {
          const row = await deleteOrgEntity(table, id, toActor(req));
          if (!row) {
            return reply
              .status(404)
              .send({ code: "NOT_FOUND", message: "Not found" });
          }
          return reply.status(204).send();
        } catch (err) {
          return sendServiceError(reply, err);
        }
      },
    );
  };

  register("/lobs", "line_of_businesses", "lob");
  register("/teams", "teams", "team");

  app.get(
    "/teams/:id/members",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = detailParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_FAILED",
          message: "Invalid path parameters",
        });
      }
      const result = await getTeamMembers(parsed.data.id);
      if (!result) {
        return reply
          .status(404)
          .send({ code: "NOT_FOUND", message: "Team not found" });
      }
      return reply.status(200).send(result);
    },
  );
}
