import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, ProxyAgent } from "undici";
import {
  enrollAgent,
  EnrollError,
  persistToken,
  readPersistedToken,
} from "../src/enroll.js";
import type { AgentConfig } from "../src/config.js";

// Spec 025 US5 AS3 / T073: the enrollment HTTP leg must honor the same
// CA_BUNDLE/proxy env as the WS leg, and persist the durable credential
// owner-only.

function cfg(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    hubUrl: "https://hub.corp.internal",
    streamUrl: "wss://hub.corp.internal/api/v1/agent/stream",
    stateDir: mkdtempSync(join(tmpdir(), "agent-enroll-")),
    maxJobs: 1,
    ...overrides,
  };
}

function okFetch(agentToken = "agent-tok") {
  let captured: { url: unknown; init: Record<string, unknown> } | undefined;
  const fetchImpl = (async (url: unknown, init: Record<string, unknown>) => {
    captured = { url, init };
    return {
      ok: true,
      json: async () => ({ agentToken }),
    } as unknown as Response;
  }) as typeof fetch;
  return { fetchImpl, captured: () => captured };
}

describe("enrollAgent", () => {
  it("POSTs the enrollment token and returns the durable credential", async () => {
    const { fetchImpl, captured } = okFetch();
    const token = await enrollAgent(cfg(), "enroll-tok", fetchImpl);
    expect(token).toBe("agent-tok");
    expect(captured()!.url).toBe(
      "https://hub.corp.internal/api/v1/agent/enroll",
    );
    expect(JSON.parse(String(captured()!.init.body))).toEqual({
      token: "enroll-tok",
    });
    expect(captured()!.init.dispatcher).toBeUndefined();
  });

  it("builds a CA-aware dispatcher when CA_BUNDLE is set", async () => {
    const caFile = join(mkdtempSync(join(tmpdir(), "agent-ca-")), "ca.pem");
    writeFileSync(
      caFile,
      "-----BEGIN CERTIFICATE-----\nZm9v\n-----END CERTIFICATE-----\n",
    );
    const { fetchImpl, captured } = okFetch();
    await enrollAgent(cfg({ caBundle: caFile }), "t", fetchImpl);
    const d = captured()!.init.dispatcher;
    expect(d).toBeInstanceOf(Agent);
    expect(d).not.toBeInstanceOf(ProxyAgent);
  });

  it("routes through ProxyAgent when HTTPS_PROXY is set", async () => {
    const { fetchImpl, captured } = okFetch();
    await enrollAgent(
      cfg({ httpsProxy: "http://proxy.corp:3128" }),
      "t",
      fetchImpl,
    );
    expect(captured()!.init.dispatcher).toBeInstanceOf(ProxyAgent);
  });

  it("skips the proxy when NO_PROXY matches the hub host", async () => {
    const { fetchImpl, captured } = okFetch();
    await enrollAgent(
      cfg({
        httpsProxy: "http://proxy.corp:3128",
        noProxy: "hub.corp.internal,localhost",
      }),
      "t",
      fetchImpl,
    );
    expect(captured()!.init.dispatcher).not.toBeInstanceOf(ProxyAgent);
  });

  it("rejects non-200 responses with the hub status", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 401 }) as unknown as Response) as typeof fetch;
    await expect(enrollAgent(cfg(), "t", fetchImpl)).rejects.toMatchObject({
      name: "EnrollError",
      statusCode: 401,
    });
  });

  it("wraps transport failures without leaking internals", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(enrollAgent(cfg(), "t", fetchImpl)).rejects.toBeInstanceOf(
      EnrollError,
    );
  });

  it("rejects a 200 that omits agentToken", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(enrollAgent(cfg(), "t", fetchImpl)).rejects.toThrow(
      /agentToken/,
    );
  });
});

describe("persistToken / readPersistedToken", () => {
  it("round-trips the credential under the state dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-state-"));
    const path = persistToken(dir, "durable-token");
    expect(readPersistedToken(dir)).toBe("durable-token");
    expect(readFileSync(path, "utf8")).toBe("durable-token");
  });

  it("writes the token file owner-only on POSIX", () => {
    if (process.platform === "win32") return;
    const dir = mkdtempSync(join(tmpdir(), "agent-state-"));
    const path = persistToken(dir, "durable-token");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("returns undefined when no token file exists", () => {
    expect(
      readPersistedToken(mkdtempSync(join(tmpdir(), "agent-state-"))),
    ).toBeUndefined();
  });
});
