import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Selectable } from "kysely";
import type { ImportAgentRow } from "../db/types.js";
import { db } from "../db/connection.js";
import { hashToken } from "../utils/crypto.js";
import { metrics } from "./metrics.js";

// Agent bearer authentication (spec 025, ADR-116). Distinct from browser
// sessions: agents present `Authorization: Bearer <durable credential>`,
// resolved by SHA-256 hash. Rejections log + count metrics but never write
// audit rows.

export interface AgentRequest extends FastifyRequest {
  agent?: Selectable<ImportAgentRow>;
}

declare module "fastify" {
  interface FastifyInstance {
    verifyAgentCredential: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    agentSessions: import("../services/agent-session-service.js").AgentSessionService;
  }
}

export async function agentAuthPlugin(app: FastifyInstance): Promise<void> {
  app.decorate("verifyAgentCredential", async (req: AgentRequest, reply: FastifyReply) => {
    const reject = (message: string) => {
      metrics.agentStreamRejectedTotal.inc({ reason: "credential" });
      req.log.warn({ remoteAddress: req.ip }, `agent credential rejected: ${message}`);
      return reply.status(401).send({ code: "AGENT_CREDENTIAL_INVALID", message });
    };

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reject("missing bearer credential");
    }
    const hash = hashToken(header.slice("Bearer ".length).trim());
    const agent = await db
      .selectFrom("import_agents")
      .selectAll()
      .where("credentialHash", "=", hash)
      .executeTakeFirst();
    if (!agent) {
      return reject("unknown credential");
    }
    if (agent.revokedAt !== null) {
      return reject("credential revoked");
    }
    req.agent = agent;
  });
}
