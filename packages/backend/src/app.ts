import Fastify, { type FastifyInstance, type FastifyLoggerOptions, type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import staticPlugin from "@fastify/static";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { errorHandler } from "./plugins/error-handler.js";
import { loggerOptions } from "./plugins/logging.js";
import { helmetPlugin } from "./plugins/helmet.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { corsPlugin } from "./plugins/cors.js";
import { csrfPlugin } from "./plugins/csrf.js";
import { sessionPlugin } from "./plugins/session.js";
import { metricsPlugin } from "./plugins/metrics.js";
import { tracingPlugin } from "./plugins/tracing.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { metricsRoutes } from "./routes/metrics.js";
import { userRoutes } from "./routes/users.js";
import { settingsRoutes } from "./routes/settings.js";
import { sessionRoutes } from "./routes/sessions.js";
import { importerRoutes } from "./routes/importers.js";
import { credentialRoutes } from "./routes/credentials.js";
import { componentRoutes } from "./routes/components.js";
import { componentGroupRoutes } from "./routes/component-groups.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { searchRoutes } from "./routes/search.js";
import { productRoutes } from "./routes/products.js";
import { orgRoutes } from "./routes/org.js";
import { auditRoutes } from "./routes/audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the Fastify `trustProxy` option from TRUSTED_PROXY_IP (ADR-093).
 * Accepts a single IP, a comma-separated IP list, or an integer hop count.
 * Defaults to `false` — X-Forwarded-* headers are only honored when an
 * operator explicitly configures trusted proxies.
 */
export function resolveTrustProxy(): FastifyServerOptions["trustProxy"] {
  const raw = process.env.TRUSTED_PROXY_IP?.trim();
  if (!raw) return false;
  // proxy-addr (Fastify's trustProxy implementation) accepts a numeric hop
  // count, but the FastifyServerOptions type omits `number` — cast it.
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10) as unknown as boolean;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length === 1 ? parts[0]! : parts;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Pass Pino options so Fastify creates a compatible internal logger.
    // The exported `logger` instance is used by services outside of Fastify.
    logger: loggerOptions as unknown as FastifyLoggerOptions,
    trustProxy: resolveTrustProxy(),
    bodyLimit: 1024 * 1024, // 1MB max request body (FR-022)
  });

  // Register cookie plugin first (needed by session + CSRF)
  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET,
  });

  // Security plugins
  await helmetPlugin(app);
  await corsPlugin(app);
  await rateLimitPlugin(app);
  await csrfPlugin(app);

  // Observability plugins
  await metricsPlugin(app);
  await tracingPlugin(app);

  // Error handling
  await errorHandler(app);

  // Session plugin (decorates app with verifySession)
  await sessionPlugin(app);

  // Register routes
  await app.register(authRoutes, { prefix: "/api/v1" });
  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(userRoutes, { prefix: "/api/v1" });
  await app.register(settingsRoutes, { prefix: "/api/v1" });
  await app.register(sessionRoutes, { prefix: "/api/v1" });
  await app.register(importerRoutes, { prefix: "/api/v1" });
  await app.register(credentialRoutes, { prefix: "/api/v1" });
  await app.register(componentRoutes, { prefix: "/api/v1" });
  await app.register(componentGroupRoutes, { prefix: "/api/v1" });
  await app.register(dashboardRoutes, { prefix: "/api/v1" });
  await app.register(searchRoutes, { prefix: "/api/v1" });
  await app.register(productRoutes, { prefix: "/api/v1" });
  await app.register(orgRoutes, { prefix: "/api/v1" });
  await app.register(auditRoutes, { prefix: "/api/v1" });

  // Metrics endpoint — unauthenticated, no prefix (ADR-069)
  await app.register(metricsRoutes);

  // Serve frontend static assets in production
  if (process.env.NODE_ENV === "production") {
    const frontendDist = join(__dirname, "..", "..", "frontend", "dist");
    await app.register(staticPlugin, {
      root: frontendDist,
      prefix: "/",
    });
  }

  return app;
}
