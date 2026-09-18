import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  createImporterConfigSchema,
  updateImporterConfigSchema,
} from "@componode/core";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole } from "../plugins/rbac.js";
import { getManifests, getManifest } from "../services/importer-registry.js";
import {
  listImporterConfigs,
  getImporterConfig,
  createImporterConfig,
  updateImporterConfig,
  deleteImporterConfig,
  convertLegacySecrets,
} from "../services/importer-config-service.js";
import { toActor } from "../services/actor.js";
import {
  startRun,
  cancelRun,
  getRun,
  listRunsForConfig,
  listRunErrors,
} from "../services/import-run-service.js";
import { getRunChanges } from "../services/audit-query-service.js";

export async function importerRoutes(app: FastifyInstance): Promise<void> {
  // Registry
  app.get("/importers", {
    preHandler: [app.verifySession],
  }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const manifests = await getManifests();
    return reply.status(200).send({ importers: manifests });
  });

  app.get("/importers/:name/schema", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const manifest = await getManifest(name);
    return reply.status(200).send({ name: manifest.name, configSchema: manifest.configSchema });
  });

  // Configs
  app.get("/importer-configs", {
    preHandler: [app.verifySession],
  }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const configs = await listImporterConfigs();
    return reply.status(200).send({ configs });
  });

  app.get("/importer-configs/:id", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const config = await getImporterConfig(id);
    if (!config) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Importer config not found" });
    }
    return reply.status(200).send({ config });
  });

  app.post("/importer-configs", {
    preHandler: [app.verifySession, requireRole("importer:config:create")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const parsed = createImporterConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    const config = await createImporterConfig(parsed.data, toActor(req));
    return reply.status(201).send({ config });
  });

  app.patch("/importer-configs/:id", {
    preHandler: [app.verifySession, requireRole("importer:config:update")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const parsed = updateImporterConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    const config = await updateImporterConfig(id, parsed.data, toActor(req));
    if (!config) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Importer config not found" });
    }
    return reply.status(200).send({ config });
  });

  app.delete("/importer-configs/:id", {
    preHandler: [app.verifySession, requireRole("importer:config:delete")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const config = await deleteImporterConfig(id, toActor(req));
    if (!config) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Importer config not found" });
    }
    return reply.status(204).send();
  });

  // One-click legacy migration (spec 013 US5): converts env/file secretRefs
  // into a stored credential, links it, and clears the refs.
  app.post("/importer-configs/:id/convert-secrets", {
    preHandler: [app.verifySession, requireRole("importer:config:update")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const result = await convertLegacySecrets(id, toActor(req));
    if (!result) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Importer config not found" });
    }
    return reply.status(201).send(result);
  });

  // Runs
  app.post("/importer-configs/:id/trigger", {
    preHandler: [app.verifySession, requireRole("importer:run:trigger")],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
      const { runId } = await startRun(id, req.user?.id ?? null);
      return reply.status(202).send({ runId });
    } catch (err) {
      const error = err as { statusCode?: number; code?: string; message?: string };
      if (error.statusCode === 409) {
        return reply.status(409).send({ code: error.code ?? "CONFLICT", message: error.message ?? "Conflict" });
      }
      throw err;
    }
  });

  app.get("/importer-configs/:id/runs", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const runs = await listRunsForConfig(id);
    return reply.status(200).send({ runs });
  });

  app.get("/importer-configs/:configId/runs/:runId", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { runId } = req.params as { configId: string; runId: string };
    const run = await getRun(runId);
    if (!run) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Run not found" });
    }
    return reply.status(200).send({ run });
  });

  app.get("/importer-configs/:configId/runs/:runId/errors", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { runId } = req.params as { configId: string; runId: string };
    const errors = await listRunErrors(runId);
    return reply.status(200).send({ errors });
  });

  app.get("/importer-configs/:configId/runs/:runId/changes", {
    preHandler: [app.verifySession],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { runId } = req.params as { configId: string; runId: string };
    const run = await getRun(runId);
    if (!run) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Run not found" });
    }
    const result = await getRunChanges(runId);
    return reply.status(200).send(result);
  });

  app.post("/importer-configs/:configId/runs/:runId/cancel", {
    preHandler: [app.verifySession, requireRole("importer:run:cancel")],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { runId } = req.params as { configId: string; runId: string };
    const run = await getRun(runId);
    if (!run) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Run not found" });
    }
    if (run.status !== "RUNNING" && run.status !== "PENDING") {
      return reply.status(409).send({ code: "RUN_NOT_ACTIVE", message: "Run is not active" });
    }
    await cancelRun(runId);
    return reply.status(204).send();
  });
}
