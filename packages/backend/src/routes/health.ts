import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db/connection.js";
import { loadKeyring } from "../utils/credential-crypto.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_req: FastifyRequest, reply: FastifyReply) => {
    let databaseStatus = "connected";
    try {
      await db.selectFrom("persons").select("persons.id").limit(1).execute();
    } catch {
      databaseStatus = "disconnected";
    }

    // Credential store availability (spec 013 US6): false when no master key
    // is configured — the app runs degraded until one is provided.
    const credentialsAvailable = (await loadKeyring()) !== null;

    const status = databaseStatus === "connected" ? "healthy" : "unhealthy";
    const statusCode = databaseStatus === "connected" ? 200 : 503;

    return reply.status(statusCode).send({
      status,
      database: databaseStatus,
      credentialsAvailable,
      uptime: process.uptime(),
      version: process.env.npm_package_version ?? "1.0.0",
    });
  });
}
