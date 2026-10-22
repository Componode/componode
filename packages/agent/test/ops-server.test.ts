import { describe, it, expect, afterEach } from "vitest";
import { AgentOpsMetrics } from "../src/metrics.js";
import { startOpsServer, type OpsServer } from "../src/ops-server.js";
import type { OpsReadiness } from "../src/ops-server.js";

// Spec 028 US1 / T007: agent-local ops listener — liveness, readiness,
// metrics exposition, and unknown/method handling.

const silent = { warn: () => {}, info: () => {} };

async function serve(
  readiness: OpsReadiness,
): Promise<{ server: OpsServer; base: string; metrics: AgentOpsMetrics }> {
  const metrics = new AgentOpsMetrics();
  const server = await startOpsServer({
    host: "127.0.0.1",
    port: 0,
    metrics,
    getReadiness: () => readiness,
    log: silent,
  });
  if (!server) throw new Error("ops server failed to bind");
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}`, metrics };
}

let active: OpsServer | null = null;
afterEach(async () => {
  await active?.close();
  active = null;
});

describe("ops server", () => {
  it("/healthz is 200 with ok status even before connect", async () => {
    const s = await serve({ ready: false, state: "connecting" });
    active = s.server;
    const res = await fetch(`${s.base}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptimeSeconds: number };
    expect(body.status).toBe("ok");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("/readyz is 503 while connecting and 200 once established", async () => {
    const s = await serve({ ready: false, state: "backoff" });
    active = s.server;
    const res = await fetch(`${s.base}/readyz`);
    expect(res.status).toBe(503);
    expect((await res.json()) as { ready: boolean }).toMatchObject({
      ready: false,
      state: "backoff",
    });
    active = null;
    await s.server.close();

    const s2 = await serve({ ready: true, state: "connected" });
    active = s2.server;
    const res2 = await fetch(`${s2.base}/readyz`);
    expect(res2.status).toBe(200);
    expect((await res2.json()) as { ready: boolean }).toMatchObject({
      ready: true,
      state: "connected",
    });
  });

  it("/metrics exposes agent_* and process series after counters tick", async () => {
    const s = await serve({ ready: true, state: "connected" });
    active = s.server;
    s.metrics.markConnected();
    s.metrics.jobReceived();
    s.metrics.jobAccepted();
    s.metrics.assetsSent("github", 7);
    s.metrics.jobCompleted("COMPLETED");
    s.metrics.jobReleased();
    s.metrics.credentialTestDone(true);
    s.metrics.secretResolutionFailed();
    s.metrics.markDisconnected("client_close");
    s.metrics.markReconnect();
    s.metrics.reconnectOutcome(true);

    const res = await fetch(`${s.base}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    for (const series of [
      "agent_stream_connected",
      "agent_sessions_total",
      "agent_reconnects_total",
      "agent_jobs_received_total",
      "agent_jobs_completed_total",
      "agent_jobs_active",
      "agent_assets_streamed_total",
      "agent_credential_tests_total",
      "agent_secret_resolution_failures_total",
      "process_",
    ]) {
      expect(text).toContain(series);
    }
    expect(text).toContain('agent_assets_streamed_total{importer="github"} 7');
    expect(text).toContain('agent_jobs_completed_total{result="completed"} 1');
    expect(text).toContain(
      'agent_reconnects_total{outcome="established"} 1',
    );
  });

  it("snapshot() mirrors the same counters for the heartbeat ops payload", () => {
    const m = new AgentOpsMetrics();
    m.jobReceived();
    m.jobAccepted();
    m.assetsSent("aws", 3);
    m.jobCompleted("FAILED");
    m.jobReleased();
    m.markReconnect();
    const snap = m.snapshot();
    expect(snap.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(snap.jobs).toEqual({
      assigned: 1,
      completed: 0,
      failed: 1,
      cancelled: 0,
    });
    expect(snap.assetsStreamed).toBe(3);
    expect(snap.reconnects).toBe(1);
    expect(snap.activeJobs).toBe(0);
  });

  it("returns 404 for unknown paths and 405 for non-GET", async () => {
    const s = await serve({ ready: true, state: "connected" });
    active = s.server;
    expect((await fetch(`${s.base}/nope`)).status).toBe(404);
    expect(
      (await fetch(`${s.base}/healthz`, { method: "POST" })).status,
    ).toBe(405);
  });
});
