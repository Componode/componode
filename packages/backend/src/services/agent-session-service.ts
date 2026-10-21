import type { WebSocket } from "ws";
import { uuidv7 } from "uuidv7";
import {
  AGENT_CREDENTIAL_TEST_TIMEOUT_MS,
  AGENT_ERROR_CODES,
  AGENT_HELLO_TIMEOUT_MS,
  AGENT_HEARTBEAT_INTERVAL_MS,
  AGENT_PROTOCOL_VERSION,
  AGENT_SESSION_SWEEP_MS,
  AGENT_STALE_AFTER_MS,
  helloPayloadSchema,
  parseAgentMessage,
  type AgentCredentialTestPayload,
  type AgentCredentialTestResultPayload,
  type AgentDisconnectReason,
  type AgentHelloPayload,
} from "@componode/core";
import type { Selectable } from "kysely";
import type { ImportAgentRow } from "../db/types.js";
import { db } from "../db/connection.js";
import { toJsonb } from "../db/json.js";
import { getManifests } from "./importer-registry.js";
import { metrics } from "../plugins/metrics.js";

// Agent stream session service (spec 025 US2, ADR-116). Holds live sockets in
// memory, validates the lockstep hello handshake, tracks heartbeats, and
// closes stale sessions on a sweep. Connection telemetry lands in
// `agent_sessions` — operational data, not audit rows.

export type HandshakeRejection = {
  ok: false;
  reason: "invalid_hello" | "protocol_mismatch" | "importer_mismatch";
  detail: string;
};

// Lockstep parity check (ADR-116 #7): protocol version must equal the hub's
// and the agent's compiled importer set must match the hub manifest set
// exactly — no runtime negotiation.
export function validateHello(
  raw: unknown,
  hubImporters: { name: string; version: string }[],
): { ok: true } | HandshakeRejection {
  const parsed = helloPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_hello",
      detail: "malformed hello payload",
    };
  }
  const hello = parsed.data;
  if (hello.protocolVersion !== AGENT_PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: "protocol_mismatch",
      detail: `agent protocol ${hello.protocolVersion}, hub expects ${AGENT_PROTOCOL_VERSION}`,
    };
  }
  const hubSet = new Map(hubImporters.map((i) => [i.name, i.version]));
  const agentSet = new Map(hello.importers.map((i) => [i.name, i.version]));
  if (hubSet.size !== agentSet.size) {
    return {
      ok: false,
      reason: "importer_mismatch",
      detail: `agent compiled ${agentSet.size} importers, hub has ${hubSet.size}`,
    };
  }
  for (const [name, version] of hubSet) {
    const agentVersion = agentSet.get(name);
    if (agentVersion !== version) {
      return {
        ok: false,
        reason: "importer_mismatch",
        detail:
          agentVersion === undefined
            ? `agent is missing importer "${name}"`
            : `importer "${name}" version ${agentVersion} != hub ${version}`,
      };
    }
  }
  return { ok: true };
}

interface LiveSession {
  sessionId: string;
  agentId: string;
  agentName: string;
  socket: WebSocket;
  lastContactAt: number;
  /** Set once closeSession runs — makes hub-driven close re-entry a no-op
   *  (the socket's own 'close' event re-fires closeSession afterwards). */
  closed?: boolean;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

interface PendingTest {
  session: LiveSession;
  resolve: (result: AgentCredentialTestResultPayload) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AgentSessionService {
  private live = new Map<string, LiveSession>();
  private pendingTests = new Map<string, PendingTest>();
  private credentialTestTimeoutMs = envInt(
    "AGENT_CREDENTIAL_TEST_TIMEOUT_MS",
    AGENT_CREDENTIAL_TEST_TIMEOUT_MS,
  );
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private staleAfterMs = envInt("AGENT_STALE_AFTER_MS", AGENT_STALE_AFTER_MS);
  private sweepMs = envInt("AGENT_SESSION_SWEEP_MS", AGENT_SESSION_SWEEP_MS);
  private helloTimeoutMs = envInt(
    "AGENT_HELLO_TIMEOUT_MS",
    AGENT_HELLO_TIMEOUT_MS,
  );
  private log: {
    warn: (o: object, msg: string) => void;
    info: (o: object, msg: string) => void;
  };

  constructor(log?: {
    warn: (o: object, msg: string) => void;
    info: (o: object, msg: string) => void;
  }) {
    // Default silent — app.ts always injects app.log; a console fallback would
    // violate the no-console-in-production rule (constitution VII).
    this.log = log ?? { warn: () => {}, info: () => {} };
  }

  start(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => void this.sweep(), this.sweepMs);
    this.sweepTimer.unref?.();
    void this.reconcileOrphans();
  }

  // Crash-safe startup: the live-session map is memory-only, so a hub restart
  // leaves stale CONNECTED agents and open agent_sessions rows. Reconcile on
  // boot — close orphaned rows as `shutdown` and downgrade status (US2/FR-009:
  // offline visibility must hold even when no close frame ever fired).
  async reconcileOrphans(): Promise<void> {
    const now = new Date().toISOString();
    try {
      const closed = await db
        .updateTable("agent_sessions")
        .set({ disconnectedAt: now, disconnectReason: "shutdown" })
        .where("disconnectedAt", "is", null)
        .execute();
      const downgraded = await db
        .updateTable("import_agents")
        .set({ status: "OFFLINE", updatedAt: now })
        .where("status", "=", "CONNECTED")
        .execute();
      const sessions = Number(closed[0]?.numUpdatedRows ?? 0);
      const agents = Number(downgraded[0]?.numUpdatedRows ?? 0);
      if (sessions > 0 || agents > 0) {
        this.log.warn(
          { orphanedSessions: sessions, orphanedAgents: agents },
          "reconciled orphaned agent sessions after restart",
        );
      }
    } catch (err) {
      this.log.warn({ err }, "orphaned-session reconciliation failed");
    }
  }

  async stop(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    const sessions = [...this.live.values()];
    await Promise.allSettled(
      sessions.map((s) => this.closeSession(s, "shutdown")),
    );
  }

  // Forcibly drop the live session for an agent (revoke/delete). Sends the
  // close frame first so the agent learns the reason before the socket dies —
  // `revoked` is terminal and must not be retried.
  async dropAgent(
    agentId: string,
    reason: AgentDisconnectReason,
  ): Promise<void> {
    const session = this.live.get(agentId);
    if (session) {
      this.send(session.socket, "close", {
        reason,
        detail: `session ended: ${reason}`,
      });
      await this.closeSession(session, reason);
    }
  }

  // Attach a freshly upgraded socket whose credential already authenticated.
  // Runs the hello handshake; returns true when the session was accepted.
  async attach(
    socket: WebSocket,
    agent: Selectable<ImportAgentRow>,
    remoteAddress: string | null,
  ): Promise<boolean> {
    const hello = await this.awaitHello(socket, agent.name);
    if (hello === null) {
      return false; // socket already closed/timed out inside awaitHello
    }

    const hubImporters = (await getManifests()).map((m) => ({
      name: m.name,
      version: m.version,
    }));
    const verdict = validateHello(hello, hubImporters);
    if (!verdict.ok) {
      this.send(socket, "error", {
        code:
          verdict.reason === "invalid_hello"
            ? AGENT_ERROR_CODES.INVALID_HELLO
            : AGENT_ERROR_CODES.AGENT_VERSION_MISMATCH,
        message: verdict.detail,
      });
      this.send(socket, "close", {
        reason: verdict.reason,
        detail: verdict.detail,
        supportedVersions: [AGENT_PROTOCOL_VERSION],
      });
      socket.close();
      metrics.agentStreamRejectedTotal.inc({ reason: verdict.reason });
      this.log.warn(
        { agent: agent.name, reason: verdict.reason, detail: verdict.detail },
        "agent handshake rejected",
      );
      return false;
    }

    const sessionId = uuidv7();
    const now = new Date().toISOString();
    const importerVersions = hello.importers;

    const session: LiveSession = {
      sessionId,
      agentId: agent.id,
      agentName: agent.name,
      socket,
      lastContactAt: Date.now(),
    };

    // Claim the session slot synchronously — a concurrent attach for the
    // same agent must supersede THIS session, not both pass live.get()
    // before either set() (FR-010: single active session per identity).
    const incumbent = this.live.get(agent.id);
    this.live.set(agent.id, session);
    metrics.importAgentsConnected.set(this.live.size);

    if (incumbent) {
      // Supersede any incumbent session for this agent.
      this.send(incumbent.socket, "close", {
        reason: "superseded",
        detail: "new session established",
      });
      await this.closeSession(incumbent, "superseded");
    }

    try {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto("agent_sessions")
          .values({
            id: sessionId,
            agentId: agent.id,
            connectedAt: now,
            remoteAddress,
            agentVersion: hello.agentVersion,
            protocolVersion: hello.protocolVersion,
            importerVersions: toJsonb(importerVersions),
          })
          .execute();

        await trx
          .updateTable("import_agents")
          .set({
            status: "CONNECTED",
            agentVersion: hello.agentVersion,
            protocolVersion: hello.protocolVersion,
            importerVersions: toJsonb(importerVersions),
            maxConcurrentJobs: hello.capabilities.maxConcurrentJobs,
            lastSeenAt: now,
            updatedAt: now,
          })
          .where("id", "=", agent.id)
          .execute();
      });
    } catch (err) {
      // Release the claim on persistence failure — no phantom live session.
      if (this.live.get(agent.id)?.sessionId === session.sessionId) {
        this.live.delete(agent.id);
        metrics.importAgentsConnected.set(this.live.size);
      }
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      throw err;
    }

    socket.on("message", (raw) => void this.onFrame(session, raw));
    socket.on("close", () => void this.closeSession(session, "client_close"));
    socket.on("error", () => void this.closeSession(session, "client_close"));

    // A socket that died during the session-row transaction never re-fires
    // 'close' — without this check it would linger as a phantom live session
    // until the ~90 s sweep.
    if (socket.readyState !== socket.OPEN) {
      void this.closeSession(session, "client_close");
      return false;
    }

    this.send(socket, "hello.ok", {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      agentId: agent.id,
      name: agent.name,
      allowedImporters: agent.allowedImporters,
      heartbeatIntervalMs: AGENT_HEARTBEAT_INTERVAL_MS,
      maxConcurrentJobs: hello.capabilities.maxConcurrentJobs,
      serverTime: now,
    });
    this.log.info(
      { agent: agent.name, sessionId },
      "agent session established",
    );
    return true;
  }

  // Wait for the first frame to be a valid hello; on timeout or malformed
  // input sends a terminal `close` frame (invalid_hello) so the agent exits
  // rather than retrying forever. Returns null when the attempt failed.
  private awaitHello(
    socket: WebSocket,
    agentName: string,
  ): Promise<AgentHelloPayload | null> {
    const reject = (message: string) => {
      this.send(socket, "error", {
        code: AGENT_ERROR_CODES.INVALID_HELLO,
        message,
      });
      this.send(socket, "close", { reason: "invalid_hello", detail: message });
      socket.close();
      metrics.agentStreamRejectedTotal.inc({ reason: "invalid_hello" });
      // FR-014: rejected attempts are logged AND counted — the post-parse
      // attach() path logs; the pre-parse path must too.
      this.log.warn(
        { agent: agentName, detail: message },
        "agent handshake rejected",
      );
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        reject("hello timeout");
        resolve(null);
      }, this.helloTimeoutMs);

      socket.once("message", (raw: unknown) => {
        clearTimeout(timer);
        try {
          const msg = parseAgentMessage(JSON.parse(String(raw)));
          if (msg.type !== "hello") {
            reject("expected hello");
            return resolve(null);
          }
          resolve(helloPayloadSchema.parse(msg.payload));
        } catch {
          reject("malformed hello");
          resolve(null);
        }
      });

      // Socket dies before hello → stop waiting; an unhandled 'error'
      // listener-less would also crash the process.
      socket.once("close", () => {
        clearTimeout(timer);
        resolve(null);
      });
      socket.once("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  // Dispatch a remote credential test to a connected agent (spec 026 US3).
  // The payload carries secret *references*, never values (ADR-117).
  // Rejects with AGENT_OFFLINE when the agent has no live session and
  // AGENT_TEST_TIMEOUT when no result arrives in the window. `onDispatched`
  // fires the moment the frame is on the wire — the caller stamps its
  // dispatch audit/lastUsedAt there so a timeout or mid-test disconnect
  // still leaves an audit trail (FR-018).
  dispatchCredentialTest(
    agentId: string,
    payload: AgentCredentialTestPayload,
    onDispatched?: () => void,
  ): Promise<AgentCredentialTestResultPayload> {
    const session = this.live.get(agentId);
    if (!session) {
      return Promise.reject(
        Object.assign(new Error("Agent has no connected session"), {
          statusCode: 503,
          code: "AGENT_OFFLINE",
        }),
      );
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTests.delete(payload.testId);
        reject(
          Object.assign(
            new Error(
              `Agent did not answer the credential test within ${this.credentialTestTimeoutMs} ms`,
            ),
            { statusCode: 504, code: "AGENT_TEST_TIMEOUT" },
          ),
        );
      }, this.credentialTestTimeoutMs);
      timer.unref?.();

      this.pendingTests.set(payload.testId, {
        session,
        resolve,
        reject,
        timer,
      });
      this.send(session.socket, "credential.test", payload);
      onDispatched?.();
      this.log.info(
        { agent: session.agentName, testId: payload.testId },
        "credential test dispatched to agent",
      );
    });
  }

  private settleTest(
    entry: PendingTest,
    settle: (e: PendingTest) => void,
  ): void {
    clearTimeout(entry.timer);
    settle(entry);
  }

  private async onFrame(session: LiveSession, raw: unknown): Promise<void> {
    let msg;
    try {
      msg = parseAgentMessage(JSON.parse(String(raw)));
    } catch {
      this.send(session.socket, "error", {
        code: AGENT_ERROR_CODES.BAD_FRAME,
        message: "unparseable frame",
      });
      session.socket.close(1008);
      return;
    }

    if (msg.type === "credential.test.result") {
      // Correlate by testId — results with no pending test are ignored
      // (a late answer after timeout must not reject the session).
      const payload = msg.payload as AgentCredentialTestResultPayload;
      const pending = this.pendingTests.get(payload.testId);
      if (pending) {
        this.pendingTests.delete(payload.testId);
        this.settleTest(pending, (e) => e.resolve(payload));
      }
      session.lastContactAt = Date.now();
      return;
    }

    if (msg.type !== "heartbeat" && msg.type !== "close") {
      // Reserved-but-unhandled types (job.* land in 027): a peer sending one
      // now is on a different protocol — error + close (1008 policy
      // violation) per contract, never silently ignored.
      this.send(session.socket, "error", {
        code: AGENT_ERROR_CODES.UNSUPPORTED_FRAME,
        message: `frame type "${msg.type}" is not implemented by this build`,
      });
      session.socket.close(1008);
      return;
    }

    // lastSeenAt is "last ACCEPTED frame" (data-model) — only handled types
    // refresh it; malformed/reserved frames must not keep a session alive.
    session.lastContactAt = Date.now();
    const now = new Date().toISOString();
    await db
      .updateTable("import_agents")
      .set({ lastSeenAt: now })
      .where("id", "=", session.agentId)
      .execute();

    if (msg.type === "close") {
      const reason = (msg.payload as { reason?: string })?.reason;
      await this.closeSession(
        session,
        reason === "shutdown" ? "shutdown" : "client_close",
      );
    }
    // heartbeats need no response — the lastContactAt bump is the signal.
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const session of [...this.live.values()]) {
      if (now - session.lastContactAt > this.staleAfterMs) {
        this.log.warn(
          { agent: session.agentName, sessionId: session.sessionId },
          "agent session heartbeat timeout",
        );
        this.send(session.socket, "close", {
          reason: "shutdown",
          detail: "heartbeat timeout",
        });
        await this.closeSession(session, "heartbeat_timeout");
      }
    }
  }

  private send(socket: WebSocket, type: string, payload: unknown): void {
    try {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type, payload }));
      }
    } catch {
      /* socket already gone */
    }
  }

  private async closeSession(
    session: LiveSession,
    reason: AgentDisconnectReason,
  ): Promise<void> {
    // Fully idempotent: the socket.close() below re-fires this same method
    // via the 'close' listener — bail before double-counting the metric.
    if (session.closed) return;
    session.closed = true;
    // Remove first so a concurrent attach() sees the agent as free.
    if (this.live.get(session.agentId)?.sessionId === session.sessionId) {
      this.live.delete(session.agentId);
      metrics.importAgentsConnected.set(this.live.size);
    }

    // A disconnect must not leave a credential test hanging — fail every
    // pending dispatch on this session.
    for (const [testId, pending] of [...this.pendingTests.entries()]) {
      if (pending.session.sessionId === session.sessionId) {
        this.pendingTests.delete(testId);
        this.settleTest(pending, (e) =>
          e.reject(
            Object.assign(new Error("Agent disconnected during the credential test"), {
              statusCode: 503,
              code: "AGENT_OFFLINE",
            }),
          ),
        );
      }
    }

    const now = new Date().toISOString();
    try {
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable("agent_sessions")
          .set({ disconnectedAt: now, disconnectReason: reason })
          .where("id", "=", session.sessionId)
          .where("disconnectedAt", "is", null)
          .execute();

        // Only downgrade status when this agent has no other live session.
        if (!this.live.has(session.agentId)) {
          await trx
            .updateTable("import_agents")
            .set({ status: "OFFLINE", updatedAt: now })
            .where("id", "=", session.agentId)
            .where("status", "=", "CONNECTED")
            .execute();
        }
      });
      metrics.agentSessionsTotal.inc({ agent: session.agentName, reason });
    } catch (err) {
      this.log.warn({ err }, "failed to record agent session close");
    }

    try {
      session.socket.close();
    } catch {
      /* already closed */
    }
  }
}
