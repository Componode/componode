import type { LoggerOptions } from "pino";

// Agent logger options (spec 026 FR-013, ADR-090). Mirrors the hub's pino
// redaction discipline: resolved secret values must never reach agent logs,
// even if a future code path accidentally attaches them to a structured
// field. Resolution events log {key, source} only — key names are not
// secret material.
export const agentLoggerOptions: LoggerOptions = {
  name: "componode-agent",
  redact: {
    paths: [
      "secrets",
      "secrets.*",
      "secretRefs",
      "token",
      "password",
      "clientSecret",
      "encryptedPayload",
      "authorization",
      "cookie",
      "*.secrets",
      "*.secrets.*",
      "*.secretRefs",
      "*.token",
      "*.password",
      "*.clientSecret",
      "*.encryptedPayload",
      "*.authorization",
      "*.cookie",
    ],
    censor: "[REDACTED]",
  },
};
