import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from "fastify";
import {
  createProblem,
  type ErrorCode,
  type InvalidParam,
  isErrorCode,
} from "@componode/core";

const debugErrorDetails = process.env.DEBUG_ERROR_DETAILS === "true";
const typeBase = process.env.PROBLEM_TYPE_BASE ?? "https://componode.io";

function buildInvalidParams(details: unknown): InvalidParam[] | undefined {
  if (!Array.isArray(details) || details.length === 0) {
    return undefined;
  }

  const params: InvalidParam[] = [];

  for (const item of details) {
    if (!item || typeof item !== "object") {
      continue;
    }

    // Zod-style issues: { path: ["field"], message: "..." }
    if ("path" in item && Array.isArray(item.path) && "message" in item) {
      const name = item.path.join(".");
      if (name) {
        params.push({ name, reason: String(item.message) });
      }
      continue;
    }

    // AJV / Fastify-style validation: { instancePath: "/field", message: "..." }
    if ("instancePath" in item && "message" in item) {
      const name = String(item.instancePath).replace(/^\//, "") || "body";
      params.push({ name, reason: String(item.message) });
      continue;
    }

    // Fastify keyword params: { params: { missingProperty: "field" }, message: "..." }
    if ("params" in item && item.params && typeof item.params === "object") {
      if ("missingProperty" in item.params) {
        params.push({ name: String(item.params.missingProperty), reason: String(item.message) });
        continue;
      }
      if ("unknownProperty" in item.params) {
        params.push({ name: String(item.params.unknownProperty), reason: String(item.message) });
        continue;
      }
    }
  }

  return params.length > 0 ? params : undefined;
}

function toErrorCode(err: FastifyError): ErrorCode {
  if (err.code && isErrorCode(err.code)) {
    return err.code;
  }
  return "INTERNAL_ERROR";
}

export async function errorHandler(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    request.log.error({ err, url: request.url, method: request.method }, "Request error");

    let code: ErrorCode;
    let status = err.statusCode ?? 500;
    let message = err.message;
    let details: unknown | undefined;
    let invalidParams: InvalidParam[] | undefined;

    // Validation errors (from Zod or Fastify schema validation)
    if (err.validation) {
      code = "VALIDATION_FAILED";
      status = 400;
      message = "Request validation failed";
      details = err.validation;
      invalidParams = buildInvalidParams(err.validation);
    } else if (err.statusCode === 429 || err.code === "AUTH_RATE_LIMITED") {
      code = "AUTH_RATE_LIMITED";
      status = 429;
      message = err.message || "Too many requests. Please try again later.";
      const retryAfter = (err as { details?: { retryAfter?: number } }).details?.retryAfter;
      details = retryAfter ? { retryAfter } : undefined;
    } else if (err.statusCode === 401) {
      code = toErrorCode(err);
      status = 401;
      message = err.message || "Authentication required";
    } else if (err.statusCode === 403) {
      code = toErrorCode(err);
      status = 403;
      message = err.message || "Insufficient permissions";
    } else if (err.statusCode === 404) {
      code = err.code && isErrorCode(err.code) ? err.code : "NOT_FOUND";
      status = 404;
      message = err.message || "Resource not found";
    } else if (err.statusCode === 409) {
      code = toErrorCode(err);
      status = 409;
      message = err.message || "Conflict";
      // Domain conflicts may carry safe structured details (e.g.
      // CREDENTIAL_IN_USE lists the dependent entities blocking deletion).
      const conflictDetails = (err as { details?: unknown }).details;
      if (conflictDetails !== undefined) details = conflictDetails;
    } else if (err.statusCode === 422) {
      code = toErrorCode(err);
      status = 422;
      message = err.message || "Unprocessable entity";
    } else if (err.statusCode === 503) {
      code = toErrorCode(err);
      status = 503;
      message = err.message || "Service unavailable";
    } else {
      code = toErrorCode(err);
      status = err.statusCode ?? 500;
      message = err.statusCode === 500 || !err.statusCode ? "An internal error occurred" : err.message;
    }

    // Internal errors — never leak details unless debugging
    if (status >= 500 && code === "INTERNAL_ERROR") {
      if (debugErrorDetails) {
        details = {
          error: err.message,
          stack: err.stack,
        };
      }
      message = "An internal error occurred";
    }

    const problem = createProblem(code, {
      message,
      details,
      invalidParams,
      baseUrl: typeBase,
      status,
    });

    return reply.status(status).type("application/problem+json").send(problem);
  });

  app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const accept = request.headers.accept ?? "";
    const wantsHtml =
      (request.method === "GET" || request.method === "HEAD") &&
      (accept.includes("text/html") || accept === "*/*" || accept === "");

    if (
      wantsHtml &&
      !request.url.startsWith("/api/") &&
      request.url !== "/metrics" &&
      typeof (reply as unknown as { sendFile?: (file: string) => Promise<void> }).sendFile === "function"
    ) {
      try {
        return await (reply as unknown as { sendFile: (file: string) => Promise<void> }).sendFile("index.html");
      } catch {
        // fall through to problem response
      }
    }

    const problem = createProblem("NOT_FOUND", {
      message: `Route ${request.method} ${request.url} not found`,
      baseUrl: typeBase,
    });
    return reply.status(404).type("application/problem+json").send(problem);
  });

  // Wrap legacy direct error responses that did not use the central error handler.
  const wrapLegacyError = async (_request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (reply.statusCode < 400) {
      return payload;
    }

    if (typeof payload !== "string") {
      return payload;
    }

    try {
      const parsed = JSON.parse(payload);
      if (
        parsed &&
        typeof parsed === "object" &&
        "code" in parsed &&
        "message" in parsed &&
        !("type" in parsed)
      ) {
        const code = isErrorCode(parsed.code) ? parsed.code : "INTERNAL_ERROR";
        const invalidParams = buildInvalidParams(parsed.details);
        const problem = createProblem(code, {
          message: parsed.message,
          details: parsed.details,
          invalidParams,
          baseUrl: typeBase,
          status: reply.statusCode,
        });
        reply.type("application/problem+json");
        return JSON.stringify(problem);
      }
    } catch {
      // Not JSON; leave as-is.
    }

    return payload;
  };

  app.addHook("onSend", wrapLegacyError);
}
