import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";

export async function rateLimitPlugin(app: FastifyInstance): Promise<void> {
  const envMax = Number(process.env.RATE_LIMIT_MAX);
  await app.register(rateLimit, {
    global: true,
    max: Number.isInteger(envMax) && envMax > 0 ? envMax : 300,
    timeWindow: "1 minute",
    // Key by user ID if authenticated, otherwise by IP
    keyGenerator: (req) => {
      const user = (req as unknown as { user?: { id: string } }).user;
      return user?.id ?? req.ip;
    },
    errorResponseBuilder: (_req, context) => {
      return {
        code: "AUTH_RATE_LIMITED",
        message: `Too many requests. Please try again in ${context.after}.`,
        details: { retryAfter: context.ttl },
      };
    },
  });
}
