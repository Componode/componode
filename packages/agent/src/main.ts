import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import pino from "pino";
import {
  loadConfig,
  resolveAgentToken,
  resolveEnrollmentToken,
  type AgentConfig,
} from "./config.js";
import { enrollAgent, persistToken, readPersistedToken } from "./enroll.js";
import {
  runSession,
  TERMINAL_CLOSE_EXIT_CODES,
  type SessionDeps,
} from "./client.js";
import { Backoff } from "./backoff.js";
import { agentLoggerOptions } from "./logging.js";

// Agent entrypoint (spec 025 US5, ADR-116): resolve a durable credential
// (env file > env var > persisted state > enrollment-token exchange), then
// hold the outbound stream with bounded backoff. Secrets never reach logs.

export interface AgentDeps extends SessionDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Bound the reconnect loop (tests; undef = retry forever). */
  maxReconnects?: number;
}

type Log = {
  info: (o: object, m: string) => void;
  warn: (o: object, m: string) => void;
  error: (o: object, m: string) => void;
};

export async function runAgent(
  cfg: AgentConfig,
  deps: AgentDeps = {},
  log: Log = pino(agentLoggerOptions),
): Promise<number> {
  // 1. Credential: explicit file > env var > persisted state > enrollment.
  let token = resolveAgentToken(cfg) ?? readPersistedToken(cfg.stateDir);
  if (!token) {
    const enrollmentToken = resolveEnrollmentToken(cfg);
    if (!enrollmentToken) {
      log.error(
        {},
        "no credential material: set AGENT_TOKEN(_FILE) or AGENT_ENROLLMENT_TOKEN(_FILE)",
      );
      return 1;
    }
    try {
      token = await enrollAgent(cfg, enrollmentToken, deps.fetchImpl);
    } catch (err) {
      log.error(
        { statusCode: (err as { statusCode?: number }).statusCode },
        "enrollment failed",
      );
      return 1;
    }
    try {
      persistToken(cfg.stateDir, token);
    } catch (err) {
      log.error(
        { err: (err as Error).message, stateDir: cfg.stateDir },
        "cannot persist agent credential — state dir must be writable",
      );
      return 1;
    }
    log.info({ stateDir: cfg.stateDir }, "enrolled; credential persisted");
  }

  // 2. Session loop.
  const backoff = new Backoff();
  let attempts = 0;
  const maxReconnects = deps.maxReconnects ?? Number.POSITIVE_INFINITY;
  const sessionDeps: SessionDeps = {
    WebSocketImpl: deps.WebSocketImpl,
    heartbeatMs: deps.heartbeatMs,
    loadImporters: deps.loadImporters,
    log,
  };

  for (;;) {
    const end = await runSession(cfg, token, sessionDeps);
    if (end.established !== false) {
      // A session that completed the handshake resets the backoff budget.
      backoff.reset();
    }
    if (end.terminal) {
      if (end.kind === "connect-failed") {
        log.error({ reason: end.reason }, "credential rejected — exiting");
        return 1;
      }
      // `detail` carries the operator-actionable cause (e.g. which importer
      // drifted) from the hub's close frame — US2-AS2 requires the reason
      // be visible in agent logs, not just the code.
      log.info(
        { reason: end.reason, detail: end.detail },
        "session ended terminally — exiting",
      );
      return TERMINAL_CLOSE_EXIT_CODES[end.reason] ?? 0;
    }
    if (attempts++ >= maxReconnects) {
      log.warn({ attempts }, "reconnect budget exhausted — exiting");
      return 0;
    }
    const delay = backoff.next();
    log.warn(
      {
        reason: end.reason,
        detail: end.kind === "closed" ? end.detail : undefined,
        retryInMs: delay,
      },
      "session ended; reconnecting",
    );
    await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(
      delay,
    );
  }
}

async function main(): Promise<void> {
  // Logger exists before config load so startup failures still go through
  // pino — no console.* anywhere in the process (constitution VII).
  const log = pino(agentLoggerOptions);
  let cfg: AgentConfig;
  try {
    cfg = loadConfig();
  } catch (err) {
    log.error({ err: (err as Error).message }, "agent config invalid");
    process.exit(1);
  }
  const code = await runAgent(cfg, {}, log);
  process.exit(code);
}

// Auto-run only when executed directly (tests import runAgent).
const invokedAs = process.argv[1];
if (
  invokedAs &&
  import.meta.url === pathToFileURL(realpathSync(invokedAs)).href
) {
  void main();
}
