import { describe, it, expect, vi } from "vitest";
import type { UrlCheckProbePayload } from "@componode/core";
import { handleUrlCheckProbe } from "../src/probe.js";
import type { AgentLog } from "../src/secrets.js";

// Agent-side url_check.probe handling (spec 051): refs resolve locally,
// the shared probe runs, only status fields cross the wire.

const probeId = "018c5e60-0000-7000-8000-0000000000aa";

function makeLog() {
  const events: Array<{ level: string; fields: object; msg: string }> = [];
  const log: AgentLog = {
    debug: (o, m) => events.push({ level: "debug", fields: o, msg: m }),
    info: (o, m) => events.push({ level: "info", fields: o, msg: m }),
    warn: (o, m) => events.push({ level: "warn", fields: o, msg: m }),
    error: (o, m) => events.push({ level: "error", fields: o, msg: m }),
  };
  return { log, events };
}

function captureSend() {
  const frames: Array<{ type: string; payload: any }> = [];
  return {
    frames,
    send: (type: string, payload: unknown) =>
      frames.push({ type, payload }),
    last: () => frames[frames.length - 1]!,
  };
}

const basePayload: UrlCheckProbePayload = {
  probeId,
  url: "https://api.example.test/health",
  method: "GET",
  timeoutMs: 5000,
  authMode: "NONE",
};

const okResponse = (status: number) =>
  ({ status, body: { cancel: vi.fn(async () => {}) } }) as unknown as Response;

describe("agent url_check.probe handling", () => {
  it("runs the probe and replies SUCCESS for a received response", async () => {
    const { log } = makeLog();
    const tx = captureSend();
    const fetchImpl = vi.fn(async () => okResponse(200));

    await handleUrlCheckProbe(basePayload, {
      log,
      send: tx.send,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/health",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    const frame = tx.last();
    expect(frame.type).toBe("url_check.probe.result");
    expect(frame.payload).toEqual({
      probeId,
      outcome: "SUCCESS",
      httpStatus: 200,
      durationMs: expect.any(Number),
      errorType: null,
    });
  });

  it("replies FAILURE with the transport errorType when fetch rejects", async () => {
    const { log } = makeLog();
    const tx = captureSend();
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("nope"), {
        cause: { code: "ECONNREFUSED" },
      });
    });

    await handleUrlCheckProbe(basePayload, {
      log,
      send: tx.send,
      fetchImpl,
    });

    expect(tx.last().payload).toEqual({
      probeId,
      outcome: "FAILURE",
      httpStatus: null,
      durationMs: expect.any(Number),
      errorType: "CONNECT",
    });
  });

  it("sends the Bearer header built from a resolved env ref — never the value", async () => {
    process.env.AGENT_PROBE_TOKEN = "agent-secret-token";
    try {
      const { log, events } = makeLog();
      const tx = captureSend();
      const fetchImpl = vi.fn(async () => okResponse(204));

      await handleUrlCheckProbe(
        {
          ...basePayload,
          authMode: "BEARER",
          authKeyNames: { tokenKey: "token" },
          secretRefMap: { token: { env: "AGENT_PROBE_TOKEN" } },
        },
        { log, send: tx.send, fetchImpl },
      );

      const init = fetchImpl.mock.calls[0]![1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer agent-secret-token",
      );
      expect(tx.last().payload.outcome).toBe("SUCCESS");
      expect(JSON.stringify(tx.frames)).not.toContain("agent-secret-token");
      expect(events).toContainEqual({
        level: "info",
        fields: { key: "token", source: "env" },
        msg: "resolved secret reference",
      });
    } finally {
      delete process.env.AGENT_PROBE_TOKEN;
    }
  });

  it("sends custom headers mapped per authKeyNames", async () => {
    process.env.AGENT_PROBE_KEY = "custom-value";
    try {
      const { log } = makeLog();
      const tx = captureSend();
      const fetchImpl = vi.fn(async () => okResponse(200));

      await handleUrlCheckProbe(
        {
          ...basePayload,
          authMode: "CUSTOM_HEADERS",
          authKeyNames: { headers: [{ name: "X-Api-Key", key: "apikey" }] },
          secretRefMap: { apikey: { env: "AGENT_PROBE_KEY" } },
        },
        { log, send: tx.send, fetchImpl },
      );

      const init = fetchImpl.mock.calls[0]![1] as RequestInit;
      expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe(
        "custom-value",
      );
      expect(JSON.stringify(tx.frames)).not.toContain("custom-value");
    } finally {
      delete process.env.AGENT_PROBE_KEY;
    }
  });

  it("replies FAILURE/OTHER when a referenced key cannot be resolved", async () => {
    const { log } = makeLog();
    const tx = captureSend();
    const fetchImpl = vi.fn(async () => okResponse(200));

    await handleUrlCheckProbe(
      {
        ...basePayload,
        authMode: "BEARER",
        authKeyNames: { tokenKey: "token" },
        secretRefMap: { token: { env: "AGENT_PROBE_MISSING" } },
      },
      { log, send: tx.send, fetchImpl },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(tx.last().payload).toEqual({
      probeId,
      outcome: "FAILURE",
      errorType: "OTHER",
    });
  });
});
