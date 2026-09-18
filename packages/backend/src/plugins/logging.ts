import type { FastifyInstance } from "fastify";
import pino from "pino";

const logLevel = process.env.LOG_LEVEL ?? "info";

const redactPaths = [
  "password",
  "passwordHash",
  "clientSecret",
  "secretRefs",
  "secrets",
  "secrets.*",
  "encryptedPayload",
  "sessionToken",
  "sessionId",
  "authorization",
  "cookie",
  "oidcSubject",
  "email",
  "*.password",
  "*.passwordHash",
  "*.clientSecret",
  "*.secretRefs",
  "*.secrets",
  "*.secrets.*",
  "*.encryptedPayload",
  "*.sessionToken",
  "*.authorization",
];

export const loggerOptions = {
  level: logLevel,
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
};

export const logger = pino(loggerOptions);

export async function loggingPlugin(app: FastifyInstance): Promise<void> {
  app.decorate("logger", logger);
}
