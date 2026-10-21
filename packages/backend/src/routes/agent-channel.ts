import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { enrollAgentRequestSchema } from "@componode/core";
import { exchangeEnrollmentToken } from "../services/agent-service.js";
import { AgentSessionService } from "../services/agent-session-service.js";
import type { AgentRequest } from "../plugins/agent-auth.js";
import { metrics } from "../plugins/metrics.js";

// Agent-facing channel (spec 025 US2, ADR-116): single-use enrollment
// exchange + the bearer-authenticated outbound WebSocket stream. These routes
// are CSRF-exempt (ADR-087 amendment) — agents hold no browser cookies.
export async function agentChannelRoutes(
  app: FastifyInstance,
  opts: { sessions: AgentSessionService },
): Promise<void> {
  const { sessions } = opts;

  app.post(
    "/agent/enroll",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = enrollAgentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          code: "VALIDATION_FAILED",
          message: "Invalid input",
          details: parsed.error.issues,
        });
      }
      const result = await exchangeEnrollmentToken(parsed.data.token, sessions);
      if (!result) {
        metrics.agentStreamRejectedTotal.inc({ reason: "enroll_invalid" });
        req.log.warn(
          "agent enrollment rejected: unknown, used, or expired token",
        );
        return reply.status(401).send({
          code: "AGENT_ENROLLMENT_INVALID",
          message: "Enrollment token is invalid, used, or expired",
        });
      }
      return reply.status(200).send(result);
    },
  );

  app.get(
    "/agent/stream",
    {
      websocket: true,
      preHandler: [app.verifyAgentCredential],
    },
    (socket, req: FastifyRequest) => {
      const agent = (req as AgentRequest).agent!;
      const remoteAddress = req.ip ?? null;
      void sessions.attach(socket, agent, remoteAddress).catch((err) => {
        req.log.warn({ err, agent: agent.name }, "agent session attach failed");
        socket.close();
      });
    },
  );
}
