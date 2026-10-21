import { describe, it, expect, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

// Session service pulls the global `db` — stub it; the dispatch paths under
// test never reach the database (same pattern as agent-service.test.ts).
vi.mock("../../src/db/connection.js", () => ({ db: {} }));

const { AgentSessionService } = await import(
  "../../src/services/agent-session-service.js"
);

// Pending-dispatch mechanics for remote credential tests (spec 026 US3).
// Session-driven paths (result resolution, disconnect rejection) are covered
// end-to-end by test/integration/credential-test-remote.test.ts against a
// real ws peer; these unit tests pin the parts reachable without a socket.
describe("AgentSessionService credential test dispatch", () => {
  const payload = {
    testId: "018c5e60-0000-7000-8000-000000000001",
    credentialId: "018c5e60-0000-7000-8000-000000000002",
    importerName: "github",
    secretRefMap: { token: { env: "GH_TOKEN" } },
  };

  // Fake ws peer — send() guards on readyState === OPEN.
  const fakeSocket = () => {
    const s = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
    };
    return s;
  };
  const fakeSession = (agentId: string, socket = fakeSocket()) => ({
    sessionId: "sess-1",
    agentId,
    agentName: "edge-agent",
    socket: socket as never,
    lastContactAt: Date.now(),
  });
  // Private internals are reachable through a cast — this is a mechanics
  // unit test, not an API test (integration covers the wire path).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internals = (svc: unknown) => svc as any;

  it("rejects dispatch with AGENT_OFFLINE when the agent has no live session", async () => {
    const svc = new AgentSessionService();
    await expect(
      svc.dispatchCredentialTest("018c5e60-0000-7000-8000-000000000009", payload),
    ).rejects.toMatchObject({ statusCode: 503, code: "AGENT_OFFLINE" });
  });

  it("sends credential.test and resolves on the matching result frame", async () => {
    const svc = new AgentSessionService();
    const socket = fakeSocket();
    const session = fakeSession("agent-1", socket);
    internals(svc).live.set("agent-1", session);

    const result = svc.dispatchCredentialTest("agent-1", payload);
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "credential.test", payload }),
    );
    expect(internals(svc).pendingTests.has(payload.testId)).toBe(true);

    await internals(svc).onFrame(
      session,
      JSON.stringify({
        type: "credential.test.result",
        payload: { testId: payload.testId, ok: true },
      }),
    );
    await expect(result).resolves.toMatchObject({ ok: true });
    expect(internals(svc).pendingTests.size).toBe(0);
  });

  it("ignores result frames with an unknown testId", async () => {
    const svc = new AgentSessionService();
    const session = fakeSession("agent-1");
    internals(svc).live.set("agent-1", session);

    await internals(svc).onFrame(
      session,
      JSON.stringify({
        type: "credential.test.result",
        payload: { testId: "018c5e60-0000-7000-8000-ffffffffffff", ok: false },
      }),
    );
    expect(internals(svc).pendingTests.size).toBe(0);
  });

  it("rejects with AGENT_TEST_TIMEOUT when no result arrives", async () => {
    const svc = new AgentSessionService();
    internals(svc).credentialTestTimeoutMs = 20;
    const session = fakeSession("agent-1");
    internals(svc).live.set("agent-1", session);

    await expect(
      svc.dispatchCredentialTest("agent-1", payload),
    ).rejects.toMatchObject({ statusCode: 504, code: "AGENT_TEST_TIMEOUT" });
    expect(internals(svc).pendingTests.size).toBe(0);
  });

  it("fires onDispatched once the frame is on the wire — not when offline", async () => {
    const svc = new AgentSessionService();
    const session = fakeSession("agent-1");
    internals(svc).live.set("agent-1", session);
    internals(svc).credentialTestTimeoutMs = 20;

    const onDispatched = vi.fn();
    await expect(
      svc.dispatchCredentialTest("agent-1", payload, onDispatched),
    ).rejects.toMatchObject({ code: "AGENT_TEST_TIMEOUT" });
    expect(onDispatched).toHaveBeenCalledTimes(1);

    const offline = vi.fn();
    await expect(
      svc.dispatchCredentialTest("no-such-agent", payload, offline),
    ).rejects.toMatchObject({ code: "AGENT_OFFLINE" });
    expect(offline).not.toHaveBeenCalled();
  });

  it("rejects all pending dispatches when the session closes", async () => {
    const svc = new AgentSessionService();
    const session = fakeSession("agent-1");
    internals(svc).live.set("agent-1", session);

    const p = svc.dispatchCredentialTest("agent-1", payload);
    const assertion = expect(p).rejects.toMatchObject({
      statusCode: 503,
      code: "AGENT_OFFLINE",
    });
    await internals(svc).closeSession(session, "client_close");
    await assertion;
    expect(internals(svc).pendingTests.size).toBe(0);
  });
});
