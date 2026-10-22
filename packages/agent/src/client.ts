import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { HttpsProxyAgent } from "https-proxy-agent";
import {
  AGENT_ERROR_CODES,
  AGENT_HEARTBEAT_INTERVAL_MS,
  AGENT_PROTOCOL_VERSION,
  IMPORTER_PACKAGES,
  createImporterRegistry,
  parseAgentMessage,
  type AgentCredentialTestPayload,
  type ImporterRegistry,
} from "@componode/core";
import { proxyForUrl, type AgentConfig } from "./config.js";
import {
  maskSecretValues,
  SecretRefError,
  SecretResolutionError,
} from "@componode/core/secrets";
import { createAgentResolver, resolveRefMap, type AgentLog } from "./secrets.js";
import { createRequire } from "node:module";

// One outbound agent session (spec 025 US2/US5): bearer upgrade → hello →
// hello.ok → heartbeats. Returns a SessionEnd verdict so the caller knows
// whether to retry or exit.

export type SessionEnd =
  | {
      kind: "closed";
      terminal: boolean;
      reason: string;
      detail?: string;
      established: boolean;
    }
  | {
      kind: "connect-failed";
      terminal: boolean;
      reason: string;
      established: false;
    };

/**
 * Exit codes for terminal close reasons (spec 025 supersede clarification —
 * a displaced agent must be distinguishable from both clean exits and
 * credential failures). The map is the single enumeration of terminal
 * reasons: `Object.hasOwn(TERMINAL_CLOSE_EXIT_CODES, reason)` is the check.
 *   0 = clean end (normal close, reconnect budget exhausted)
 *   1 = credential rejected / startup failure
 *   2 = protocol or importer mismatch — rebuild the agent
 *   3 = superseded / replaced — a newer credential took over; do not restart
 */
export const TERMINAL_CLOSE_EXIT_CODES: Record<string, number> = {
  superseded: 3,
  replaced: 3,
  revoked: 1,
  invalid_hello: 2,
  protocol_mismatch: 2,
  importer_mismatch: 2,
};

// Heartbeats stop mattering once the session is established for this reason.
type MinimalSocket = EventEmitter & {
  readyState: number;
  send(data: string): void;
  close(): void;
};

export interface SessionDeps {
  WebSocketImpl?: new (
    url: string,
    options?: Record<string, unknown>,
  ) => MinimalSocket;
  heartbeatMs?: number;
  loadImporters?: () => Promise<{ name: string; version: string }[]>;
  registry?: ImporterRegistry;
  log?: {
    info: (o: object, m: string) => void;
    warn: (o: object, m: string) => void;
  };
}

const nodeRequire = createRequire(import.meta.url);
const agentPkg = nodeRequire("../package.json") as { version: string };

// Default importer loader — evaluated HERE (agent package context), because
// core is a leaf and cannot resolve @componode/importer-* itself. The package
// list itself lives in core (IMPORTER_PACKAGES) — one source for lockstep.
async function defaultLoadImporters(): Promise<
  { name: string; version: string }[]
> {
  const { createImporterRegistry } = await import("@componode/core");
  const registry = createImporterRegistry(
    IMPORTER_PACKAGES,
    (spec) => import(spec),
  );
  const manifests = await registry.getManifests();
  return manifests.map((m) => ({ name: m.name, version: m.version }));
}

// Remote credential test handler (spec 026 US4): resolve the reference map
// against the agent's own env/SECRETS_DIR, run the importer's probe, reply.
// Failures produce {ok:false} naming the key + source — never values, never
// filesystem paths (SecretResolutionError/SecretRefError messages are
// sanitized by construction; ADR-096).
export async function handleCredentialTest(
  payload: AgentCredentialTestPayload,
  deps: {
    secretsDir?: string;
    registry: ImporterRegistry;
    log: AgentLog;
    send: (type: string, frame: unknown) => void;
  },
): Promise<void> {
  const reply = (ok: boolean, error?: string) =>
    deps.send("credential.test.result", { testId: payload.testId, ok, error });

  // Held so a thrown importer error can be scrubbed of resolved values
  // before it touches the agent log (FR-012).
  let resolved: Record<string, string> = {};
  try {
    const secrets = await resolveRefMap(
      payload.secretRefMap,
      createAgentResolver(deps.secretsDir),
      deps.log,
    );
    resolved = secrets;
    const importer = await deps.registry.getImporter(payload.importerName);
    if (typeof importer.testSecrets !== "function") {
      return reply(
        false,
        `MANIFEST_NO_TEST: importer "${payload.importerName}" does not support credential testing`,
      );
    }
    const result = await importer.testSecrets(secrets, payload.scope);
    return reply(result.ok, result.error);
  } catch (err) {
    // Resolution failures are sanitized by construction — they name key +
    // source and never a path. Any other throw (importer bug, registry
    // failure) can embed absolute paths or internals: log it locally and
    // send only a generic failure across the wire (ADR-096).
    if (err instanceof SecretResolutionError || err instanceof SecretRefError) {
      return reply(false, err.message);
    }
    deps.log.warn(
      {
        err: maskSecretValues(
          err instanceof Error ? err.message : String(err),
          resolved,
        ),
      },
      "credential test failed on agent",
    );
    return reply(
      false,
      `credential test failed on agent for importer "${payload.importerName}"`,
    );
  }
}

function wsOptions(cfg: AgentConfig, token: string): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    headers: { authorization: `Bearer ${token}` },
  };
  if (cfg.caBundle) {
    opts.ca = readFileSync(cfg.caBundle);
  }
  const proxy = proxyForUrl(cfg, cfg.streamUrl);
  if (proxy) {
    opts.agent = new HttpsProxyAgent(proxy);
  }
  return opts;
}

export async function runSession(
  cfg: AgentConfig,
  token: string,
  deps: SessionDeps = {},
): Promise<SessionEnd> {
  const log = deps.log ?? { info: () => {}, warn: () => {} };
  const importers = await (deps.loadImporters ?? defaultLoadImporters)();
  const registry =
    deps.registry ??
    createImporterRegistry(IMPORTER_PACKAGES, (spec) => import(spec));
  const heartbeatMs = deps.heartbeatMs ?? AGENT_HEARTBEAT_INTERVAL_MS;

  const WS =
    deps.WebSocketImpl ??
    ((await import("ws"))
      .WebSocket as unknown as SessionDeps["WebSocketImpl"])!;
  const socket = new WS(cfg.streamUrl, wsOptions(cfg, token));

  return new Promise<SessionEnd>((resolve) => {
    let established = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let resolved = false;
    // Terminal verdict from a hub `close` frame, captured before 'close' fires.
    let closeVerdict: {
      terminal: boolean;
      reason: string;
      detail?: string;
    } | null = null;

    const done = (end: SessionEnd) => {
      if (resolved) return;
      resolved = true;
      if (heartbeat) clearInterval(heartbeat);
      resolve(end);
    };

    const sendFrame = (type: string, payload: unknown) => {
      try {
        socket.send(JSON.stringify({ type, payload }));
      } catch {
        /* socket gone; 'close' will fire */
      }
    };

    // Drift signal (contract): a peer speaking a newer/foreign protocol sends
    // frames this build can't handle — respond `error`, close, and exit
    // terminally (protocol_mismatch → exit 2) rather than silently ignoring.
    const rejectFrame = (code: string, message: string) => {
      sendFrame("error", { code, message });
      closeVerdict = { terminal: true, reason: "protocol_mismatch" };
      socket.close();
    };

    socket.on("open", () => {
      sendFrame("hello", {
        protocolVersion: AGENT_PROTOCOL_VERSION,
        agentVersion: agentPkg.version,
        importers,
        capabilities: { maxConcurrentJobs: cfg.maxJobs },
      });
    });

    socket.on(
      "unexpected-response",
      (_req: unknown, res: { statusCode?: number }) => {
        const status = res?.statusCode ?? 0;
        const terminal = status === 401 || status === 403;
        done({
          kind: "connect-failed",
          terminal,
          established: false,
          reason: terminal
            ? `credential rejected (${status}) — the agent was revoked or deleted`
            : `upgrade rejected (${status})`,
        });
      },
    );

    socket.on("message", (raw: unknown) => {
      let msg;
      try {
        msg = parseAgentMessage(JSON.parse(String(raw)));
      } catch {
        rejectFrame(AGENT_ERROR_CODES.BAD_FRAME, "unparseable frame");
        return;
      }
      if (msg.type === "hello.ok") {
        established = true;
        log.info({}, "connected to hub");
        // The hub advertises its expected cadence in hello.ok — honor it so
        // a hub running a different interval doesn't strand sessions into
        // heartbeat_timeout. An explicitly injected cadence (tests) wins.
        const hubInterval = (msg.payload as { heartbeatIntervalMs?: number })
          ?.heartbeatIntervalMs;
        const cadence =
          deps.heartbeatMs ??
          (Number.isFinite(hubInterval) && hubInterval! > 0
            ? hubInterval!
            : heartbeatMs);
        heartbeat = setInterval(() => {
          sendFrame("heartbeat", {
            currentJobs: 0,
            maxConcurrentJobs: cfg.maxJobs,
            activeRunIds: [],
          });
        }, cadence);
        heartbeat.unref?.();
        return;
      }
      if (msg.type === "close") {
        const payload = msg.payload as
          { reason?: string; detail?: string } | undefined;
        const reason = String(payload?.reason ?? "unknown");
        closeVerdict = {
          terminal: Object.hasOwn(TERMINAL_CLOSE_EXIT_CODES, reason),
          reason,
          detail: payload?.detail,
        };
        // The detail carries the operator-actionable bit (which importer
        // drifted, why the session ended) — log it, not just the reason.
        log.warn({ reason, detail: payload?.detail }, "hub sent close frame");
        return;
      }
      if (msg.type === "error") {
        const payload = msg.payload as
          { code?: string; message?: string } | undefined;
        log.warn(
          { code: payload?.code, message: payload?.message },
          "hub sent error frame",
        );
        return;
      }
      if (msg.type === "credential.test") {
        // Remote credential test (spec 026): refs resolve HERE against the
        // agent's own env/SECRETS_DIR — values never cross the stream.
        void handleCredentialTest(msg.payload as AgentCredentialTestPayload, {
          secretsDir: cfg.secretsDir,
          registry,
          log,
          send: sendFrame,
        });
        return;
      }
      // Any other frame type (job.* reserved for 027, or unknown) means a
      // drifted hub — flag it, don't ignore it.
      rejectFrame(
        AGENT_ERROR_CODES.UNSUPPORTED_FRAME,
        `frame type "${msg.type}" is not implemented by this build`,
      );
    });

    socket.on("error", (err: Error) => {
      if (!established && !resolved) {
        done({
          kind: "connect-failed",
          terminal: false,
          established: false,
          reason: `connect failed: ${err.message}`,
        });
      }
    });

    socket.on("close", () => {
      if (closeVerdict) {
        done({ kind: "closed", established, ...closeVerdict });
      } else {
        done({
          kind: "closed",
          established,
          terminal: false,
          reason: established ? "connection lost" : "closed before handshake",
        });
      }
    });
  });
}
