import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  createCredentialSchema,
  testCredentialSchema,
  updateCredentialSchema,
} from "@componode/core";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole } from "../plugins/rbac.js";
import {
  listCredentials,
  getCredential,
  createCredential,
  deleteCredential,
  testCredential,
  updateCredential,
} from "../services/credential-service.js";
import { toActor } from "../services/actor.js";

export async function credentialRoutes(app: FastifyInstance): Promise<void> {
  app.get("/credentials", {
    preHandler: [app.verifySession, requireRole("credential:read")],
  }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const credentials = await listCredentials();
    return reply.status(200).send({ credentials });
  });

  app.post("/credentials", {
    preHandler: [app.verifySession, requireRole("credential:create")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const parsed = createCredentialSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    const credential = await createCredential(parsed.data, toActor(req));
    return reply.status(201).send({ credential });
  });

  app.get("/credentials/:id", {
    preHandler: [app.verifySession, requireRole("credential:read")],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const result = await getCredential(id);
    if (!result) {
      return reply.status(404).send({
        code: "CREDENTIAL_NOT_FOUND",
        message: "Credential not found",
      });
    }
    return reply.status(200).send(result);
  });

  app.post("/credentials/:id/test", {
    preHandler: [app.verifySession, requireRole("credential:update")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parsed = testCredentialSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    const result = await testCredential(id, parsed.data, toActor(req));
    return reply.status(200).send(result);
  });

  app.patch("/credentials/:id", {
    preHandler: [app.verifySession, requireRole("credential:update")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parsed = updateCredentialSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    const credential = await updateCredential(id, parsed.data, toActor(req));
    if (!credential) {
      return reply.status(404).send({
        code: "CREDENTIAL_NOT_FOUND",
        message: "Credential not found",
      });
    }
    return reply.status(200).send({ credential });
  });

  app.delete("/credentials/:id", {
    preHandler: [app.verifySession, requireRole("credential:delete")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    await deleteCredential(id, toActor(req));
    return reply.status(204).send();
  });
}
