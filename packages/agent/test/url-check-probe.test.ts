import { describe, it, expect, vi } from "vitest";
import type { UrlCheckProbePayload } from "@componode/core";
import { handleUrlCheckProbe, createProbeRunner } from "../src/probe.js";
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
    send: (type: string, payload: unknown) => frames.push({ type, payload }),
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

// Spec 052 US1 — agent-side defensive cap: frames beyond URL_CHECK_MAX_PROBES
// get an explicit SATURATED refusal, never unbounded concurrency.
describe("probe runner in-flight cap (spec 052)", () => {
  const payloadFor = (id: string): UrlCheckProbePayload => ({
    ...basePayload,
    probeId: id,
  });
  const id = (n: number) =>
    `018c5e60-0000-7000-8000-0000000000${String(n).padStart(2, "0")}`;

  it("runs at most `maxProbes` fetches and refuses the rest with SATURATED", async () => {
    const { log } = makeLog();
    const tx = captureSend();
    let inFlight = 0;
    let maxSeen = 0;
    const gates: Array<() => void> = [];
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      maxSeen = Math.max(maxSeen, inFlight);
      await new Promise<void>((r) => gates.push(r));
      inFlight -= 1;
      return okResponse(200);
    });
    const runner = createProbeRunner({
      log,
      send: tx.send,
      fetchImpl,
      maxProbes: 2,
    });

    runner.handleProbe(payloadFor(id(1)));
    runner.handleProbe(payloadFor(id(2)));
    runner.handleProbe(payloadFor(id(3)));

    // Synchronous admission: third frame is refused before any await.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(runner.inFlightCount()).toBe(2);
    const refusal = tx.last();
    expect(refusal.type).toBe("url_check.probe.result");
    expect(refusal.payload).toEqual({
      probeId: id(3),
      outcome: "FAILURE",
      errorType: "SATURATED",
    });

    for (const g of gates.splice(0)) g();
    await vi.waitFor(() => expect(runner.inFlightCount()).toBe(0));
    expect(maxSeen).toBe(2);
  });

  it("admits a later probe once capacity frees", async () => {
    const { log } = makeLog();
    const tx = captureSend();
    const gates: Array<() => void> = [];
    const fetchImpl = vi.fn(async () => {
      await new Promise<void>((r) => gates.push(r));
      return okResponse(200);
    });
    const runner = createProbeRunner({
      log,
      send: tx.send,
      fetchImpl,
      maxProbes: 1,
    });

    runner.handleProbe(payloadFor(id(1)));
    runner.handleProbe(payloadFor(id(2))); // refused
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(tx.last().payload.errorType).toBe("SATURATED");

    for (const g of gates.splice(0)) g();
    await vi.waitFor(() => expect(runner.inFlightCount()).toBe(0));

    runner.handleProbe(payloadFor(id(3))); // now admitted
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const g of gates.splice(0)) g();
    await vi.waitFor(() => expect(runner.inFlightCount()).toBe(0));
    expect(tx.last().payload).toMatchObject({
      probeId: id(3),
      outcome: "SUCCESS",
    });
  });
});

// Spec 052 US2 — cancellation: a hub cancel frame aborts the in-flight
// fetch, unknown ids are a no-op, and teardown aborts everything.
describe("probe runner cancellation (spec 052)", () => {
  const payloadFor = (id: string): UrlCheckProbePayload => ({
    ...basePayload,
    probeId: id,
  });
  const id = (n: number) =>
    `018c5e60-0000-7000-8000-0000000000${String(n).padStart(2, "0")}`;

  // fetchImpl honoring the composed abort signal like real fetch.
  const abortableFetch = () =>
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );

  it("aborts the in-flight fetch on cancel — result reports ABORTED", async () => {
    const { log } = makeLog();
    const tx = captureSend();
    const runner = createProbeRunner({
      log,
      send: tx.send,
      fetchImpl: abortableFetch(),
      maxProbes: 2,
    });

    runner.handleProbe(payloadFor(id(1)));
    runner.handleProbe(payloadFor(id(2)));
    expect(runner.inFlightCount()).toBe(2);

    runner.cancel(id(1));
    await vi.waitFor(() => expect(runner.inFlightCount()).toBe(1));

    const aborted = tx.frames.find((f) => f.payload.probeId === id(1))!;
    expect(aborted.payload).toMatchObject({
      outcome: "FAILURE",
      errorType: "ABORTED",
    });
    // The sibling probe is untouched and still running.
    runner.abortAll();
    await vi.waitFor(() => expect(runner.inFlightCount()).toBe(0));
  });

  it("ignores a duplicate probeId — cap bypass and lost cancel handle prevented", async () => {
    const { log } = makeLog();
    const tx = captureSend();
    const fetchImpl = abortableFetch();
    const runner = createProbeRunner({
      log,
      send: tx.send,
      fetchImpl,
      maxProbes: 1,
    });

    runner.handleProbe(payloadFor(id(1)));
    runner.handleProbe(payloadFor(id(1))); // dup — must not replace/run
    expect(runner.inFlightCount()).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    runner.cancel(id(1));
    await vi.waitFor(() => expect(runner.inFlightCount()).toBe(0));
    expect(tx.frames.filter((f) => f.payload.probeId === id(1))).toHaveLength(
      1,
    );
  });

  it("is a safe no-op for unknown or already-settled probeIds", async () => {
    const { log } = makeLog();
    const tx = captureSend();
    const runner = createProbeRunner({
      log,
      send: tx.send,
      fetchImpl: abortableFetch(),
      maxProbes: 1,
    });

    expect(() => runner.cancel(id(9))).not.toThrow();
    runner.handleProbe(payloadFor(id(1)));
    runner.cancel(id(1));
    await vi.waitFor(() => expect(runner.inFlightCount()).toBe(0));
    expect(() => runner.cancel(id(1))).not.toThrow(); // already settled
  });

  it("abortAll stops every in-flight probe on session teardown", async () => {
    const { log } = makeLog();
    const tx = captureSend();
    const runner = createProbeRunner({
      log,
      send: tx.send,
      fetchImpl: abortableFetch(),
      maxProbes: 4,
    });

    runner.handleProbe(payloadFor(id(1)));
    runner.handleProbe(payloadFor(id(2)));
    runner.handleProbe(payloadFor(id(3)));
    expect(runner.inFlightCount()).toBe(3);

    runner.abortAll();
    await vi.waitFor(() => expect(runner.inFlightCount()).toBe(0));
    const aborted = tx.frames.filter((f) => f.payload.errorType === "ABORTED");
    expect(aborted).toHaveLength(3);
  });
});
