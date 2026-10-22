import {
  Counter,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import type { AgentOpsSnapshot, RunCompletePayload } from "@componode/core";

// Agent-local operations metrics (spec 028, ADR-116 Amendment 3). One
// registry feeds both the /metrics ops surface and the heartbeat `ops`
// snapshot — a single source of truth for process-lifetime counters.
// Numeric counters only: no paths, env names, or values (spec FR-008).

export type JobResult = RunCompletePayload["result"];

export class AgentOpsMetrics {
  readonly registry = new Registry();
  private readonly startedAt = Date.now();

  private readonly connectedGauge = new Gauge({
    name: "agent_stream_connected",
    help: "Agent holds an established stream session with the hub",
    registers: [this.registry],
  });

  private readonly sessionsTotal = new Counter({
    name: "agent_sessions_total",
    help: "Agent stream sessions ended, by close reason",
    labelNames: ["reason"] as const,
    registers: [this.registry],
  });

  private readonly reconnectsTotal = new Counter({
    name: "agent_reconnects_total",
    help: "Agent reconnect attempts after a session ended, by outcome",
    labelNames: ["outcome"] as const,
    registers: [this.registry],
  });

  private readonly jobsReceivedTotal = new Counter({
    name: "agent_jobs_received_total",
    help: "Jobs assigned to this agent by the hub",
    registers: [this.registry],
  });

  private readonly jobsCompletedTotal = new Counter({
    name: "agent_jobs_completed_total",
    help: "Jobs finished on this agent, by result",
    labelNames: ["result"] as const,
    registers: [this.registry],
  });

  private readonly jobsActiveGauge = new Gauge({
    name: "agent_jobs_active",
    help: "Jobs currently executing on this agent",
    registers: [this.registry],
  });

  private readonly assetsStreamedTotal = new Counter({
    name: "agent_assets_streamed_total",
    help: "Discovered assets streamed to the hub",
    labelNames: ["importer"] as const,
    registers: [this.registry],
  });

  private readonly credentialTestsTotal = new Counter({
    name: "agent_credential_tests_total",
    help: "Remote credential tests executed on this agent, by result",
    labelNames: ["result"] as const,
    registers: [this.registry],
  });

  private readonly secretResolutionFailuresTotal = new Counter({
    name: "agent_secret_resolution_failures_total",
    help: "Secret reference resolutions that failed on this agent",
    registers: [this.registry],
  });

  // Plain mirrors of the prom counters so snapshot() stays synchronous —
  // prom-client reads are async and the heartbeat tick is not.
  private jobsAssigned = 0;
  private jobsDone: Record<JobResult, number> = {
    COMPLETED: 0,
    FAILED: 0,
    CANCELLED: 0,
  };
  private jobsActive = 0;
  private assetsStreamed = 0;
  private testsDispatched = 0;
  private testsSucceeded = 0;
  private testsFailed = 0;
  private secretFailures = 0;
  private reconnects = 0;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  markConnected(): void {
    this.connectedGauge.set(1);
  }

  markDisconnected(reason?: string): void {
    this.connectedGauge.set(0);
    if (reason) this.sessionsTotal.inc({ reason });
  }

  // Retry decision — the snapshot counts attempts (FR-007 "reconnects
  // since process start"); the Prom series labels each attempt by how it
  // resolved once the next connect settles (FR-003 "by outcome").
  markReconnect(): void {
    this.reconnects += 1;
  }

  reconnectOutcome(established: boolean): void {
    this.reconnectsTotal.inc({
      outcome: established ? "established" : "failed",
    });
  }

  // Every non-duplicate job.assign — refused jobs (NACK) count here only.
  jobReceived(): void {
    this.jobsReceivedTotal.inc();
  }

  // The job was registered into the executor's active map — counts as
  // `assigned` and keeps activeJobs in lockstep with currentJobs
  // (data-model: ops.activeJobs mirrors currentJobs).
  jobAccepted(): void {
    this.jobsAssigned += 1;
    this.jobsActive += 1;
    this.jobsActiveGauge.inc();
  }

  // The job left the executor's active map (completion, NACK, or abort).
  jobReleased(): void {
    this.jobsActive = Math.max(0, this.jobsActive - 1);
    this.jobsActiveGauge.dec();
  }

  jobCompleted(result: JobResult): void {
    this.jobsDone[result] += 1;
    this.jobsCompletedTotal.inc({ result: result.toLowerCase() });
  }

  assetsSent(importer: string, count: number): void {
    this.assetsStreamed += count;
    this.assetsStreamedTotal.inc({ importer }, count);
  }

  credentialTestDone(ok: boolean): void {
    this.testsDispatched += 1;
    if (ok) this.testsSucceeded += 1;
    else this.testsFailed += 1;
    this.credentialTestsTotal.inc({ result: ok ? "ok" : "failed" });
  }

  secretResolutionFailed(): void {
    this.secretFailures += 1;
    this.secretResolutionFailuresTotal.inc();
  }

  activeJobs(): number {
    return this.jobsActive;
  }

  // The heartbeat `ops` payload — process-lifetime counters; uptime lets
  // readers contextualize resets (spec FR-007, US2-AS4).
  snapshot(): AgentOpsSnapshot {
    return {
      reportedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      activeJobs: this.jobsActive,
      jobs: {
        assigned: this.jobsAssigned,
        completed: this.jobsDone.COMPLETED,
        failed: this.jobsDone.FAILED,
        cancelled: this.jobsDone.CANCELLED,
      },
      assetsStreamed: this.assetsStreamed,
      credentialTests: {
        dispatched: this.testsDispatched,
        succeeded: this.testsSucceeded,
        failed: this.testsFailed,
      },
      secretResolutionFailures: this.secretFailures,
      reconnects: this.reconnects,
    };
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
