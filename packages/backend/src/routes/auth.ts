import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { loginSchema, registerSchema, passwordChangeSchema, passwordResetConfirmSchema } from "@componode/core";
import type { CreateUserInput } from "@componode/core";
import { login, logout, changePassword } from "../services/auth-service.js";
import { generatePasswordReset, confirmPasswordReset } from "../services/password-reset-service.js";
import { initiateLogin, handleCallback, isOidcEnabled } from "../services/oidc-service.js";
import { createSession } from "../services/session-service.js";
import { getSetting } from "../services/settings-service.js";
import { createUser } from "../services/user-service.js";
import { writeAuthEvent } from "../services/audit-service.js";
import { requireRole } from "../plugins/rbac.js";
import { SESSION_COOKIE_NAME, type AuthenticatedRequest } from "../plugins/session.js";
import { toActor } from "../services/actor.js";

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

// Type augmentation for the verifySession decorator
declare module "fastify" {
  interface FastifyInstance {
    verifySession: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /auth/login
  app.post("/auth/login", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    const { user, sessionToken } = await login(parsed.data.username, parsed.data.password);

    reply.setCookie(SESSION_COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
    // Set CSRF cookie (double-submit pattern)
    const csrfToken = (reply as unknown as { setCsrfCookie: () => string }).setCsrfCookie();

    return reply.status(200).send({
      user,
      csrfToken,
    });
  });

  // POST /auth/logout
  app.post("/auth/logout", async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const sessionToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (sessionToken) {
      await logout(sessionToken, toActor(req));
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    reply.clearCookie("componode_csrf", { path: "/" });
    return reply.status(204).send();
  });

  // GET /auth/session
  app.get("/auth/session", {
    preHandler: [app.verifySession],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      user: req.user,
    });
  });

  // POST /auth/password/change — all authenticated users
  app.post("/auth/password/change", {
    preHandler: [app.verifySession],
  }, async (req: AuthenticatedRequest, reply: FastifyReply) => {
    const parsed = passwordChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    if (!req.user) {
      return reply.status(401).send({ code: "AUTH_NO_SESSION", message: "Not authenticated" });
    }

    try {
      await changePassword(req.user.id, parsed.data.currentPassword, parsed.data.newPassword, toActor(req));
      return reply.status(204).send();
    } catch (err) {
      const error = err as { statusCode?: number; code?: string; message?: string };
      if (error.statusCode === 401) {
        return reply.status(401).send({ code: error.code ?? "AUTH_INVALID_CREDENTIALS", message: error.message ?? "Invalid credentials" });
      }
      throw err;
    }
  });

  // POST /auth/password/reset — admin only, generates reset token
  app.post("/auth/password/reset", {
    preHandler: [app.verifySession, requireRole("password:reset:generate")],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { userId?: string };
    if (!body?.userId) {
      return reply.status(400).send({ code: "VALIDATION_FAILED", message: "userId is required" });
    }

    const token = await generatePasswordReset(body.userId, toActor(req));
    return reply.status(200).send({ token });
  });

  // POST /auth/password/reset/confirm — public (uses token, no session needed)
  app.post("/auth/password/reset/confirm", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = passwordResetConfirmSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    try {
      await confirmPasswordReset(parsed.data.token, parsed.data.newPassword, { id: null, name: null });
      return reply.status(204).send();
    } catch (err) {
      const error = err as { statusCode?: number; code?: string; message?: string };
      if (error.statusCode === 400) {
        return reply.status(400).send({
          code: error.code ?? "AUTH_RESET_TOKEN_INVALID",
          message: error.message ?? "Invalid reset token",
        });
      }
      throw err;
    }
  });

  // POST /auth/register — public self-registration (only if allowSelfRegistration is enabled)
  app.post("/auth/register", {
    config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const allowSelfRegistration = Boolean(await getSetting("allowSelfRegistration"));
    if (!allowSelfRegistration) {
      return reply.status(404).send({ code: "NOT_FOUND", message: "Self-registration is not enabled" });
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: "VALIDATION_FAILED",
        message: "Invalid input",
        details: parsed.error.issues,
      });
    }

    const defaultRole = String(await getSetting("defaultUserRole") ?? "VIEWER");
    // Self-registration must never provision ADMIN. Settings validation
    // rejects the combination, but env overrides can still force it — clamp.
    const safeRole = defaultRole === "ADMIN" ? "VIEWER" : defaultRole;
    if (safeRole !== defaultRole) {
      req.log.warn("defaultUserRole=ADMIN is not permitted for self-registration; clamped to VIEWER");
    }
    const userInput: CreateUserInput = {
      ...parsed.data,
      role: safeRole as CreateUserInput["role"],
    };

    try {
      const user = await createUser(userInput, { id: null, name: userInput.username });
      if (!user) {
        return reply.status(500).send({ code: "INTERNAL_ERROR", message: "Failed to create user" });
      }

      const sessionToken = await createSession(user.id);
      reply.setCookie(SESSION_COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
      const csrfToken = (reply as unknown as { setCsrfCookie: () => string }).setCsrfCookie();

      await writeAuthEvent("login", null, { id: user.id, name: user.displayName ?? user.username });

      return reply.status(201).send({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          displayName: user.displayName,
        },
        csrfToken,
      });
    } catch (err) {
      const error = err as { statusCode?: number; code?: string; message?: string };
      if (error.statusCode === 409) {
        return reply.status(409).send({ code: error.code ?? "AUTH_USERNAME_TAKEN", message: error.message ?? "Username already taken" });
      }
      throw err;
    }
  });

  // GET /auth/oidc/status — public endpoint for login page to check if OIDC is enabled
  app.get("/auth/oidc/status", async (_req: FastifyRequest, reply: FastifyReply) => {
    const enabled = await isOidcEnabled();
    return reply.status(200).send({ enabled });
  });

  // POST /auth/oidc/login — initiate OIDC login, redirect to IdP
  app.post("/auth/oidc/login", async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { redirect_uri?: string };
    try {
      const baseUrl = process.env.PUBLIC_URL ?? `${req.protocol}://${req.host}`;
      const redirectUrl = await initiateLogin(query.redirect_uri ?? "/", baseUrl);
      return reply.status(302).redirect(redirectUrl);
    } catch (err) {
      const error = err as { statusCode?: number; code?: string; message?: string };
      if (error.statusCode === 503) {
        return reply.status(503).send({ code: "OIDC_NOT_CONFIGURED", message: "OIDC is not configured" });
      }
      throw err;
    }
  });

  // GET /auth/oidc/callback — OIDC callback, exchange code, create session, redirect
  app.get("/auth/oidc/callback", async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { code?: string; state?: string; error?: string };
    
    if (query.error) {
      return reply.status(302).redirect(`/login?error=oidc_${query.error}`);
    }

    if (!query.code || !query.state) {
      return reply.status(400).send({ code: "OIDC_INVALID_CODE", message: "Missing code or state parameter" });
    }

    try {
      const baseUrl = process.env.PUBLIC_URL ?? `${req.protocol}://${req.host}`;
      const callbackUrl = new URL(req.url, baseUrl);
      const { sessionToken, redirectUri } = await handleCallback(callbackUrl);
      reply.setCookie(SESSION_COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);
      const csrfToken = (reply as unknown as { setCsrfCookie: () => string }).setCsrfCookie();
      // Pass CSRF token as query param for the frontend to store (since this is a redirect, not JSON)
      return reply.status(302).redirect(`${redirectUri}?csrf=${csrfToken}`);
    } catch (err) {
      const error = err as { statusCode?: number; code?: string; message?: string };
      const status = error.statusCode ?? 400;
      const code = error.code ?? "OIDC_INVALID_CODE";
      const message = error.message ?? "OIDC callback failed";
      if (status === 302) {
        return reply.status(302).redirect(`/login?error=${code.toLowerCase()}`);
      }
      return reply.status(status).send({ code, message });
    }
  });
}
