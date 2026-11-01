import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

// The default store hits the global db — unit tests inject a fake store so
// the dispatcher mechanics (queueing, capacity, session-loss) run without
// Postgres. Integration tests cover the real store end to end.
vi.mock("../../src/db/connection.js", () => ({ db: {} }));

const { RemoteRunService } = await import(
  "../../src/services/remote-run-service.js"
);
import type { RemoteJobContext } from "../../src/services/remote-run-service.js";

function makeJob(runId: string, agentId: string): RemoteJobContext {
  return {
    runId,
    runStatus: "PENDING",
    configId: "cfg-1",
    configLabel: "Test config",
    importerName: "web-url",
    triggeredBy: null,
    scope: {},
    secretRefMap: null,
    credentialIds: [],
    revokedCredentialLabel: null,
    missingSecretKeys: [],
    cancelRequestedAt: null,
    runCreatedAt: new Date().toISOString(),
    agent: {
      id: agentId,
      name: "edge-agent",
      revokedAt: null,
      allowedImporters: [],
      maxConcurrentJobs: 1,
    },
  };
}

function fakeStore(jobs: Record<string, RemoteJobContext>) {
  const updates: { runId: string; patch: Record<string, unknown> }[] = [];
  return {
    updates,
    loadJob: vi.fn(async (runId: string) => jobs[runId] ?? null),
    updateRun: vi.fn(async (runId: string, patch: Record<string, unknown>) => {
      updates.push({ runId, patch });
    }),
    insertRunError: vi.fn(async () => {}),
    processAsset: vi.fn(async () => ({
      componentId: "comp-1",
      created: true,
      instancesOrphaned: 0,
    })),
    reconcile: vi.fn(async () => 0),
    stageSuggestions: vi.fn(async () => {}),
    touchCredentials: vi.fn(async () => {}),
    markRunRunning: vi.fn(async () => true),
    recordSourceIdentity: vi.fn(async () => "src-1"),
  };
}

function fakeSessions() {
  const connected = new Set<string>();
  const sent: { agentId: string; type: string; runId?: string; payload: unknown }[] = [];
  return {
    connected,
    sent,
    isConnected: (agentId: string) => connected.has(agentId),
    sendToAgent: (agentId: string, type: string, runId: string | undefined, payload: unknown) => {
      if (!connected.has(agentId)) return false;
      sent.push({ agentId, type, runId, payload });
      return true;
    },
  };
}

describe("RemoteRunService dispatch mechanics", () => {
  let sessions: ReturnType<typeof fakeSessions>;
  beforeEach(() => {
    sessions = fakeSessions();
  });

  it("leaves a run queued when its agent is offline (no job.assign sent)", async () => {
    const store = fakeStore({ "run-1": makeJob("run-1", "agent-1") });
    const svc = new RemoteRunService(sessions, { store });
    await svc.enqueue("run-1");
    expect(sessions.sent).toHaveLength(0);
    expect(svc.isQueued("run-1")).toBe(true);
  });

  it("onSessionLost fails in-flight runs AGENT_LOST; queued runs survive", async () => {
    const store = fakeStore({
      "run-1": makeJob("run-1", "agent-1"),
      "run-2": makeJob("run-2", "agent-1"),
    });
    const svc = new RemoteRunService(sessions, { store });
    sessions.connected.add("agent-1");

    await svc.enqueue("run-1"); // capacity 1 → assigned
    await svc.enqueue("run-2"); // stays queued
    expect(sessions.sent.map((f) => f.type)).toEqual(["job.assign"]);
    expect(svc.isQueued("run-2")).toBe(true);

    // Mirrors closeSession ordering: the session leaves `live` before the
    // dispatcher is notified, so isConnected is already false.
    sessions.connected.delete("agent-1");
    await svc.onSessionLost("agent-1");

    const failed = store.updates.filter(
      (u) => u.runId === "run-1" && u.patch.status === "FAILED",
    );
    expect(failed).toHaveLength(1);
    expect(failed[0].patch.errorType).toBe("AGENT_LOST");
    // The queued run was not failed — it keeps waiting for a reconnect
    // within its dispatch window.
    expect(store.updates.filter((u) => u.runId === "run-2")).toHaveLength(0);
    expect(svc.isQueued("run-2")).toBe(true);
  });

  it("fails fast CREDENTIAL_REVOKED when a linked credential was revoked", async () => {
    const job = makeJob("run-1", "agent-1");
    job.revokedCredentialLabel = "prod-keys";
    const store = fakeStore({ "run-1": job });
    const svc = new RemoteRunService(sessions, { store });
    sessions.connected.add("agent-1");

    await svc.enqueue("run-1");

    expect(sessions.sent).toHaveLength(0); // no job.assign
    expect(store.touchCredentials).not.toHaveBeenCalled();
    const failed = store.updates.filter((u) => u.patch.status === "FAILED");
    expect(failed[0].patch.errorType).toBe("CREDENTIAL_REVOKED");
  });

  it("fails fast CREDENTIAL_MISSING_KEY when required secrets are uncovered", async () => {
    const job = makeJob("run-1", "agent-1");
    job.missingSecretKeys = ["token"];
    const store = fakeStore({ "run-1": job });
    const svc = new RemoteRunService(sessions, { store });
    sessions.connected.add("agent-1");

    await svc.enqueue("run-1");

    expect(sessions.sent).toHaveLength(0);
    const failed = store.updates.filter((u) => u.patch.status === "FAILED");
    expect(failed[0].patch.errorType).toBe("CREDENTIAL_MISSING_KEY");
  });

  it("ack timeout cancels the zombie job and dead-runs the run", async () => {
    const store = fakeStore({ "run-1": makeJob("run-1", "agent-1") });
    const svc = new RemoteRunService(sessions, { store, ackTimeoutMs: 40 });
    sessions.connected.add("agent-1");

    await svc.enqueue("run-1");
    expect(sessions.sent.map((f) => f.type)).toEqual(["job.assign"]);

    await new Promise((r) => setTimeout(r, 120));

    // The agent got a cancel for the job it never acked.
    expect(sessions.sent.map((f) => f.type)).toEqual(["job.assign", "cancel"]);
    const failed = store.updates.filter((u) => u.patch.status === "FAILED");
    expect(failed[0].patch.errorType).toBe("AGENT_UNAVAILABLE");

    // A late frame from the zombie lands on the dead-run registry —
    // discarded, not a protocol violation.
    expect(svc.isDeadRun("agent-1", "run-1")).toBe(true);
    await expect(
      svc.onAssetBatch("agent-1", "run-1", { assets: [] }),
    ).resolves.toBe(false);
  });

  it("cancel during ASSIGNED maps a later COMPLETED confirmation to CANCELLED", async () => {
    const store = fakeStore({ "run-1": makeJob("run-1", "agent-1") });
    const svc = new RemoteRunService(sessions, { store });
    sessions.connected.add("agent-1");

    await svc.enqueue("run-1");
    await svc.onJobAck("agent-1", "run-1", { accepted: true });
    await svc.cancelRemoteRun("run-1");
    expect(sessions.sent.map((f) => f.type)).toEqual(["job.assign", "cancel"]);

    // The agent still completes its generator — COMPLETED must not stick.
    await svc.onRunComplete("agent-1", "run-1", { result: "COMPLETED" });
    const done = store.updates.at(-1)!;
    expect(done.patch.status).toBe("CANCELLED");
  });

  it("bounds cancellation confirmation — unresponsive agent fails AGENT_LOST", async () => {
    const store = fakeStore({ "run-1": makeJob("run-1", "agent-1") });
    const svc = new RemoteRunService(sessions, { store, ackTimeoutMs: 40 });
    sessions.connected.add("agent-1");

    await svc.enqueue("run-1");
    await svc.onJobAck("agent-1", "run-1", { accepted: true });
    await svc.cancelRemoteRun("run-1");

    await new Promise((r) => setTimeout(r, 120));

    const failed = store.updates.filter((u) => u.patch.status === "FAILED");
    expect(failed[0].patch.errorType).toBe("AGENT_LOST");
  });

  it("rejects run.complete while the job is still ASSIGNED", async () => {
    const store = fakeStore({ "run-1": makeJob("run-1", "agent-1") });
    const svc = new RemoteRunService(sessions, { store });
    sessions.connected.add("agent-1");

    await svc.enqueue("run-1");
    await expect(
      svc.onRunComplete("agent-1", "run-1", { result: "COMPLETED" }),
    ).resolves.toBe(false);
    expect(store.updates).toHaveLength(0);
  });

  it("ack arriving after the run left PENDING sends cancel, no FAILED write", async () => {
    const store = fakeStore({ "run-1": makeJob("run-1", "agent-1") });
    store.markRunRunning.mockResolvedValue(false);
    const svc = new RemoteRunService(sessions, { store });
    sessions.connected.add("agent-1");

    await svc.enqueue("run-1");
    await svc.onJobAck("agent-1", "run-1", { accepted: true });

    expect(sessions.sent.map((f) => f.type)).toEqual(["job.assign", "cancel"]);
    expect(store.updates).toHaveLength(0); // no blind write to a dead row
    expect(svc.isDeadRun("agent-1", "run-1")).toBe(true);
  });

  it("maps a capacity NACK to AGENT_UNAVAILABLE, not AGENT_INCOMPATIBLE", async () => {
    const store = fakeStore({ "run-1": makeJob("run-1", "agent-1") });
    const svc = new RemoteRunService(sessions, { store });
    sessions.connected.add("agent-1");

    await svc.enqueue("run-1");
    await svc.onJobAck("agent-1", "run-1", {
      accepted: false,
      reason: "AGENT_UNAVAILABLE: agent at capacity (1/1 jobs)",
    });

    const failed = store.updates.filter((u) => u.patch.status === "FAILED");
    expect(failed[0].patch.errorType).toBe("AGENT_UNAVAILABLE");
  });

  it("honors a cancel stamped before enqueue — never dispatches", async () => {
    const job = makeJob("run-1", "agent-1");
    job.cancelRequestedAt = new Date().toISOString();
    const store = fakeStore({ "run-1": job });
    const svc = new RemoteRunService(sessions, { store });
    sessions.connected.add("agent-1");

    await svc.enqueue("run-1");

    expect(sessions.sent).toHaveLength(0);
    const done = store.updates.at(-1)!;
    expect(done.patch.status).toBe("CANCELLED");
    expect(svc.isQueued("run-1")).toBe(false);
  });

  it("a NACK landing after a cancel request finalizes CANCELLED", async () => {
    const store = fakeStore({ "run-1": makeJob("run-1", "agent-1") });
    const svc = new RemoteRunService(sessions, { store });
    sessions.connected.add("agent-1");

    await svc.enqueue("run-1");
    await svc.cancelRemoteRun("run-1");
    await svc.onJobAck("agent-1", "run-1", {
      accepted: false,
      reason: "AGENT_UNAVAILABLE: agent at capacity (1/1 jobs)",
    });

    const done = store.updates.at(-1)!;
    expect(done.patch.status).toBe("CANCELLED");
  });

  it("ignores a source.identity frame on a non-adopting job (FR-013)", async () => {
    const job = makeJob("run-1", "agent-1");
    job.reportsSourceIdentity = false;
    const store = fakeStore({ "run-1": job });
    const svc = new RemoteRunService(sessions, { store });
    sessions.connected.add("agent-1");

    await svc.enqueue("run-1");
    await svc.onJobAck("agent-1", "run-1", { accepted: true });

    const handled = await svc.onSourceIdentity("agent-1", "run-1", {
      externalIdentity: "test-src",
    });
    expect(handled).toBe(true);
    expect(store.recordSourceIdentity).not.toHaveBeenCalled();
    expect(job.sourceId).toBeUndefined();

    // A COMPLETED confirmation still reconciles config-scoped — no
    // CONTRACT_VIOLATION for the ignored frame.
    await svc.onRunComplete("agent-1", "run-1", { result: "COMPLETED" });
    const failed = store.updates.filter((u) => u.patch.status === "FAILED");
    expect(failed).toHaveLength(0);
  });
});
