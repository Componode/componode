import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_PROTOCOL_VERSION } from "@componode/core";
import type { AgentConfig } from "../src/config.js";

// Spec 025 US5 / T039: session orchestration against a mocked ws client.
// Covers enroll → persist(0600) → connect → hello → heartbeat, plus every
// terminal/retryable close path.

type AutoEnd = { mode: "drop" } | { mode: "close-frame"; reason: string };

class FakeWebSocket extends EventEmitter {
  static instances: FakeWebSocket[] = [];
  /** What the fake does ~30ms after hello.ok (or after open if autoOk off). */
  static autoEnd: AutoEnd | null = { mode: "drop" };
  static autoOk = true;
  /** Frames the fake hub sends ~15ms after receiving hello. */
  static hubFrames: string[] = [];
  static nextOpenBehavior:
    | { kind: "open" }
    | { kind: "unexpected"; statusCode: number }
    | { kind: "network-error" } = { kind: "open" };

  readyState = 0;
  sent: string[] = [];
  url: string;
  options: Record<string, unknown>;

  constructor(url: string, options?: Record<string, unknown>) {
    super();
    this.url = url;
    this.options = options ?? {};
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.simulateOpen());
  }

  private simulateOpen() {
    const b = FakeWebSocket.nextOpenBehavior;
    FakeWebSocket.nextOpenBehavior = { kind: "open" };
    if (b.kind === "open") {
      this.readyState = 1; // OPEN
      this.emit("open");
    } else if (b.kind === "unexpected") {
      this.emit("unexpected-response", {}, { statusCode: b.statusCode });
      this.emit("close");
    } else {
      this.emit("error", new Error("ECONNREFUSED"));
      this.emit("close");
    }
  }

  private scheduleAutoEnd() {
    const end = FakeWebSocket.autoEnd;
    if (!end) return;
    setTimeout(() => {
      if (end.mode === "drop") {
        this.readyState = 3;
        this.emit("close");
      } else {
        this.emit(
          "message",
          JSON.stringify({ type: "close", payload: { reason: end.reason } }),
        );
        this.readyState = 3;
        this.emit("close");
      }
    }, 30);
  }

  send(data: string) {
    this.sent.push(data);
    const frame = JSON.parse(data);
    if (frame.type === "hello") {
      if (FakeWebSocket.autoOk) {
        queueMicrotask(() =>
          this.emit(
            "message",
            JSON.stringify({
              type: "hello.ok",
              payload: {
                protocolVersion: AGENT_PROTOCOL_VERSION,
                agentId: "00000000-0000-7000-8000-000000000001",
                name: "edge-agent",
                allowedImporters: [],
                heartbeatIntervalMs: 30_000,
                maxConcurrentJobs: 1,
                serverTime: new Date().toISOString(),
              },
            }),
          ),
        );
      }
      // Simulated inbound frames from a drifted hub (reserved/malformed).
      for (const f of FakeWebSocket.hubFrames) {
        setTimeout(() => this.emit("message", f), 15);
      }
      this.scheduleAutoEnd();
    }
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

vi.mock("ws", () => ({ WebSocket: FakeWebSocket }));

const { runAgent } = await import("../src/main.js");

let stateDir: string;
let cfg: AgentConfig;
let fetchMock: ReturnType<typeof vi.fn>;
let sleeps: number[];

function makeConfig(env: Partial<AgentConfig> = {}): AgentConfig {
  return {
    hubUrl: "https://hub.corp",
    streamUrl: "wss://hub.corp/api/v1/agent/stream",
    stateDir,
    maxJobs: 1,
    ...env,
  } as AgentConfig;
}

function makeDeps() {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ agentToken: "durable-cred-1" }),
  });
  sleeps = [];
  return {
    fetchImpl: fetchMock as unknown as typeof fetch,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    heartbeatMs: 10,
    loadImporters: async () => [{ name: "github", version: "1.0.0" }],
    WebSocketImpl: FakeWebSocket,
    maxReconnects: 1, // tests bound the retry loop
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  FakeWebSocket.autoOk = true;
  FakeWebSocket.autoEnd = { mode: "drop" };
  FakeWebSocket.hubFrames = [];
  FakeWebSocket.nextOpenBehavior = { kind: "open" };
  stateDir = mkdtempSync(join(tmpdir(), "agent-state-"));
  cfg = makeConfig({ enrollmentToken: "enroll-tok" });
});

describe("agent session (runAgent)", () => {
  it("enrolls, persists the token 0600, connects, and heartbeats", async () => {
    const code = await runAgent(cfg, makeDeps());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://hub.corp/api/v1/agent/enroll",
    );

    const tokenFile = join(stateDir, "agent-token");
    expect(readFileSync(tokenFile, "utf8")).toBe("durable-cred-1");
    // 0600 — owner read/write only (mode bits enforced on POSIX).
    if (process.platform !== "win32") {
      expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
    }

    const ws = FakeWebSocket.instances[0];
    expect((ws.options.headers as Record<string, string>).authorization).toBe(
      "Bearer durable-cred-1",
    );
    const hello = JSON.parse(ws.sent[0]);
    expect(hello.type).toBe("hello");
    expect(hello.payload.protocolVersion).toBe(AGENT_PROTOCOL_VERSION);
    expect(hello.payload.importers).toEqual([
      { name: "github", version: "1.0.0" },
    ]);
    expect(ws.sent.some((f) => JSON.parse(f).type === "heartbeat")).toBe(true);
    expect(code).toBe(0);
  });

  it("dies hard when the state dir is unwritable", async () => {
    const bad = join(stateDir, "blocked");
    writeFileSync(bad, "not a dir"); // file where a dir must be
    cfg = makeConfig({ enrollmentToken: "tok", stateDir: bad });
    const code = await runAgent(cfg, makeDeps());
    expect(code).not.toBe(0);
    expect(existsSync(join(bad, "agent-token"))).toBe(false);
  });

  it("retries with backoff on a network drop", async () => {
    cfg = makeConfig({ agentToken: "durable-cred-1" });
    const code = await runAgent(cfg, makeDeps());
    expect(FakeWebSocket.instances.length).toBe(2);
    expect(sleeps.length).toBe(1);
    expect(code).toBe(0);
  });

  it.each(["superseded", "replaced"])(
    "does not retry on close reason '%s' and exits with status 3",
    async (reason) => {
      cfg = makeConfig({ agentToken: "durable-cred-1" });
      FakeWebSocket.autoEnd = { mode: "close-frame", reason };
      const code = await runAgent(cfg, makeDeps());
      expect(FakeWebSocket.instances.length).toBe(1);
      expect(sleeps.length).toBe(0);
      expect(code).toBe(3);
    },
  );

  it("exits 2 on close reason 'invalid_hello' (hub rejected the first frame)", async () => {
    cfg = makeConfig({ agentToken: "durable-cred-1" });
    FakeWebSocket.autoEnd = { mode: "close-frame", reason: "invalid_hello" };
    const code = await runAgent(cfg, makeDeps());
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(sleeps.length).toBe(0);
    expect(code).toBe(2);
  });

  it("flags a reserved hub frame as protocol drift (error + exit 2)", async () => {
    cfg = makeConfig({ agentToken: "durable-cred-1" });
    FakeWebSocket.hubFrames = [
      JSON.stringify({ type: "job.assign", payload: { runId: "r1" } }),
    ];
    const code = await runAgent(cfg, makeDeps());
    const ws = FakeWebSocket.instances[0];
    const error = ws.sent
      .map((f) => JSON.parse(f))
      .find((f) => f.type === "error");
    expect(error?.payload.code).toBe("UNSUPPORTED_FRAME");
    expect(code).toBe(2);
    expect(sleeps.length).toBe(0);
  });

  it("flags an unparseable hub frame as protocol drift (BAD_FRAME + exit 2)", async () => {
    cfg = makeConfig({ agentToken: "durable-cred-1" });
    FakeWebSocket.hubFrames = ["{not json"];
    const code = await runAgent(cfg, makeDeps());
    const ws = FakeWebSocket.instances[0];
    const error = ws.sent
      .map((f) => JSON.parse(f))
      .find((f) => f.type === "error");
    expect(error?.payload.code).toBe("BAD_FRAME");
    expect(code).toBe(2);
  });

  it("does not retry on handshake rejections (protocol_mismatch)", async () => {
    cfg = makeConfig({ agentToken: "durable-cred-1" });
    FakeWebSocket.autoEnd = {
      mode: "close-frame",
      reason: "protocol_mismatch",
    };
    const code = await runAgent(cfg, makeDeps());
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(sleeps.length).toBe(0);
    expect(code).toBe(2);
  });

  it("retries on a hub 'shutdown' close", async () => {
    cfg = makeConfig({ agentToken: "durable-cred-1" });
    FakeWebSocket.autoEnd = { mode: "close-frame", reason: "shutdown" };
    const code = await runAgent(cfg, makeDeps());
    expect(FakeWebSocket.instances.length).toBe(2);
    expect(sleeps.length).toBe(1);
    expect(code).toBe(0);
  });

  it("treats a 401 at upgrade as terminal (deleted/revoked credential)", async () => {
    cfg = makeConfig({ agentToken: "durable-cred-1" });
    FakeWebSocket.nextOpenBehavior = { kind: "unexpected", statusCode: 401 };
    const code = await runAgent(cfg, makeDeps());
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(sleeps.length).toBe(0);
    expect(code).not.toBe(0);
  });

  it("loads a persisted token on restart without re-enrolling", async () => {
    writeFileSync(join(stateDir, "agent-token"), "persisted-cred", {
      mode: 0o600,
    });
    cfg = makeConfig(); // no env token, no enrollment token
    const code = await runAgent(cfg, makeDeps());
    expect(fetchMock).not.toHaveBeenCalled();
    const ws = FakeWebSocket.instances[0];
    expect((ws.options.headers as Record<string, string>).authorization).toBe(
      "Bearer persisted-cred",
    );
    expect(code).toBe(0);
  });

  it("fails closed when no credential material exists at all", async () => {
    cfg = makeConfig();
    const code = await runAgent(cfg, makeDeps());
    expect(code).not.toBe(0);
    expect(FakeWebSocket.instances.length).toBe(0);
  });
});
