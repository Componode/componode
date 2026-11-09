import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  createUserSchema,
  updateUserSchema,
  updateSelfSchema,
  listUsersQuerySchema,
} from "@componode/core";
import { createUser, listUsers, getUserById, updateUser } from "../services/user-service.js";
import { requireRole } from "../plugins/rbac.js";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { toActor } from "../services/actor.js";
import { validationFailed } from "./route-helpers.js";

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // GET /users — admin only. Spec 068 / ADR-130: strict query validation
  // at the boundary; response is the {data, pagination} envelope.
  app.get("/users", {
    preHandler: [app.verifySession, requireRole("user:list")],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = listUsersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return validationFailed(reply, parsed.error.issues);
    }
    const result = await listUsers(parsed.data);
    return reply.status(200).send(result);
  });

  // GET /users/me — all authenticated users
  app.get("/users/me", {
    preHandler: [app.verifySession],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    if (!req.user) {
      return reply.status(401).send({ code: "AUTH_NO_SESSION", message: "Not authenticated" });
    }
    const user = await getUserById(req.user.id);
    if (!user) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "User not found" });
    }
    return reply.status(200).send({ user });
  });

  // PATCH /users/me — all authenticated users (self-service profile, spec 030).
  // Self-bound to req.user.id; the strict self schema rejects privileged keys.
  app.patch("/users/me", {
    preHandler: [app.verifySession],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    if (!req.user) {
      return reply.status(401).send({ code: "AUTH_NO_SESSION", message: "Not authenticated" });
    }
    const parsed = updateSelfSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    const user = await updateUser(req.user.id, parsed.data, toActor(req));
    if (!user) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "User not found" });
    }
    return reply.status(200).send({ user });
  });

  // GET /users/:id — admin only
  app.get("/users/:id", {
    preHandler: [app.verifySession, requireRole("user:list")],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const user = await getUserById(id);
    if (!user) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "User not found" });
    }
    return reply.status(200).send({ user });
  });

  // POST /users — admin only
  app.post("/users", {
    preHandler: [app.verifySession, requireRole("user:create")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    try {
      const user = await createUser(parsed.data, toActor(req));
      return reply.status(201).send({ user });
    } catch (err) {
      const error = err as { statusCode?: number; code?: string; message?: string };
      if (error.statusCode === 409) {
        return reply.status(409).send({
          code: error.code ?? "AUTH_USERNAME_TAKEN",
          message: error.message ?? "Username already taken",
        });
      }
      throw err;
    }
  });

  // PATCH /users/:id — admin only
  app.patch("/users/:id", {
    preHandler: [app.verifySession, requireRole("user:update")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    const user = await updateUser(id, parsed.data, toActor(req));
    if (!user) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "User not found" });
    }
    return reply.status(200).send({ user });
  });
}
