import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomBytes } from "crypto";

const CSRF_COOKIE_NAME = "componode_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";

// State-changing methods that require CSRF protection
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function csrfPlugin(app: FastifyInstance): Promise<void> {
  // Decorate reply with a method to set the CSRF cookie
  app.decorateReply("setCsrfCookie", function (this: FastifyReply) {
    const token = randomBytes(32).toString("base64url");
    this.setCookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false, // Frontend needs to read this
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return token;
  });

  // preHandler: verify double-submit cookie matches header on state-changing requests
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!STATE_CHANGING_METHODS.has(req.method)) return;

    // Agent endpoints authenticate with bearer tokens, not browser sessions —
    // agents hold no cookie/CSRF header (ADR-087 amendment, spec 025).
    if (req.raw.url?.startsWith("/api/v1/agent/")) return;

    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return reply.status(403).send({
        code: "CSRF_TOKEN_MISMATCH",
        message: "CSRF token validation failed",
      });
    }
  });

  // Issue a CSRF cookie on safe requests that don't already have one, so the
  // frontend has a token before its first state-changing request (e.g. login).
  app.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (
      (req.method === "GET" || req.method === "HEAD") &&
      !req.cookies?.[CSRF_COOKIE_NAME] &&
      typeof (reply as unknown as { setCsrfCookie?: () => string }).setCsrfCookie === "function"
    ) {
      (reply as unknown as { setCsrfCookie: () => string }).setCsrfCookie();
    }
    return payload;
  });
}
