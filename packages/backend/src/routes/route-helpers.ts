import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { isErrorCode } from "@componode/core";

/** Shape service-layer errors carry: HTTP status + optional controlled code. */
export type ServiceError = {
  statusCode?: number;
  code?: string;
  message?: string;
  details?: unknown;
};

/** Actor attribution: use `toActor` from `services/actor.ts` (ADR-054) —
 * the one canonical implementation, shared by every route file. */

const STATUS_CODE_FALLBACKS: Record<number, string> = {
  400: "VALIDATION_FAILED",
  403: "AUTH_FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "INVALID_EDGE_TYPE",
};

/**
 * Map a service error to the {code, message, details?} envelope (ADR-071/096).
 * Unknown/missing codes fall back per status so `code` never contradicts the
 * HTTP status; ≥500 (and non-service) errors rethrow to Fastify's handler.
 */
export function sendServiceError(reply: FastifyReply, err: unknown) {
  if (err instanceof ZodError) {
    return validationFailed(reply, err.issues);
  }
  const error = err as ServiceError;
  if (error.statusCode && error.statusCode < 500) {
    return reply.status(error.statusCode).send({
      code:
        error.code && isErrorCode(error.code)
          ? error.code
          : (STATUS_CODE_FALLBACKS[error.statusCode] ?? "VALIDATION_FAILED"),
      message: error.message ?? "Request failed",
      ...(error.details ? { details: error.details } : {}),
    });
  }
  throw err;
}

export function validationFailed(reply: FastifyReply, issues: unknown) {
  return reply
    .status(400)
    .send({
      code: "VALIDATION_FAILED",
      message: "Invalid input",
      details: issues,
    });
}
