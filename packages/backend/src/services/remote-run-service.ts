import {
  AGENT_DISPATCH_TIMEOUT_MS,
  AGENT_JOB_ACK_TIMEOUT_MS,
  AGENT_NACK_SECRET_RESOLUTION_PREFIX,
  AGENT_NACK_TARGET_RESOLUTION_PREFIX,
  AGENT_NACK_UNAVAILABLE_PREFIX,
  canonicalizeSourceIdentity,
  validateDiscoveredAssetDetailed,
  type AgentActiveRun,
  type AssetBatchPayload,
  type DiscoveredAsset,
  type JobAckPayload,
  type JobAssignPayload,
  type PhasePayload,
  type RunCompletePayload,
  type RunErrorPayload,
  type SecretRefMap,
  type SourceIdentityPayload,
} from "@componode/core";
import { db } from "../db/connection.js";
import { toJsonb } from "../db/json.js";
import { envInt } from "../utils/env.js";
import { getManifest } from "./importer-registry.js";
import { metrics } from "../plugins/metrics.js";
import { logger as appLogger } from "../plugins/logging.js";
import { traceDbQuery } from "../plugins/tracing.js";
import {
  insertRunError,
  processAsset,
  reconcileRetiredComponents,
  updateRun,
} from "./import-run-service.js";
import { runSuggestionPass } from "./edge-suggestion-service.js";
import { recordRunSourceIdentity } from "./importer-source-service.js";
import { runActor } from "./import-run-service.js";

// Remote run dispatch (spec 027, ADR-116): the hub-side owner of remote job
// state. In-process execution never touches this module — bound configs take
// this branch inside `startRun`, and the agent session service routes the
// job.* frames here. The WebSocket session is the run lifeline: disconnect
// fails every in-flight run on that agent AGENT_LOST and no run is resumed
// or re-dispatched (v1).

/** Everything the dispatcher needs to know about one remote run — loaded
 *  once per dispatch decision so a stale context can never dispatch a job
 *  whose run/config/agent changed underneath it. */
export interface RemoteJobContext {
  runId: string;
  runStatus: string;
  configId: string;
  configLabel: string;
  importerName: string;
  triggeredBy: string | null;
  scope: Record<string, unknown>;
  // Merged AGENT_MANAGED reference map across the config's linked
  // credentials — names, never values (ADR-117).
  secretRefMap: SecretRefMap | null;
  credentialIds: string[];
  /** Label of a linked credential revoked after binding — dispatch must
   *  fail the run fast (in-process parity: CREDENTIAL_REVOKED). */
  revokedCredentialLabel: string | null;
  /** Manifest-required secret keys the merged refs don't cover. */
  missingSecretKeys: string[];
  /** Manifest `targetRefKey` — names the scope key carrying a targetId
   *  (ADR-116 A6). null when the importer takes no remote target. */
  targetRefKey: string | null;
  /** targetRefKey declared but scope[key] missing/non-string — fails the
   *  run at the gate before dispatch (agent preflight stays authoritative). */
  missingTarget: boolean;
  /** Manifest `reportsSourceIdentity` — adopting importer contract. */
  reportsSourceIdentity: boolean;
  /** Durable source attribution once the source.identity frame lands. */
  sourceId: string | null;
  /** Canonical externalIdentity of the reported Source — drives
   *  adopt-on-report legacy matching in processAsset (ADR-120). */
  sourceIdentity: string | null;
  /** Set when a cancel lands between row-commit and enqueue — the run
   *  must finalize CANCELLED without ever dispatching (in-process parity:
   *  the worker honors cancelRequestedAt). */
  cancelRequestedAt: string | null;
  /** Run-row creation time — feeds the dispatch-wait histogram (spec 028). */
  runCreatedAt: string;
  agent: {
    id: string;
    name: string;
    revokedAt: string | null;
    allowedImporters: string[];
    maxConcurrentJobs: number | null;
  };
}

export interface RemoteRunStore {
  loadJob(runId: string): Promise<RemoteJobContext | null>;
  updateRun(runId: string, patch: Record<string, unknown>): Promise<void>;
  insertRunError(
    runId: string,
    assetExternalId: string | null,
    errorType: string,
    errorMessage: string,
  ): Promise<void>;
  processAsset(
    job: RemoteJobContext,
    asset: DiscoveredAsset,
  ): Promise<{ componentId: string; created: boolean; instancesOrphaned: number }>;
  /** Register-or-match the reported Source, bind the config, stamp
   *  `import_runs.sourceId`. Returns the source id. */
  recordSourceIdentity(
    job: RemoteJobContext,
    identity: SourceIdentityPayload,
  ): Promise<string>;
  reconcile(
    job: RemoteJobContext,
    yieldedComponentIds: Set<string>,
  ): Promise<number>;
  stageSuggestions(componentIds: string[], runId: string): Promise<void>;
  touchCredentials(credentialIds: string[]): Promise<void>;
  /** Conditional PENDING→RUNNING transition; false = the run left PENDING
   *  underneath us (a cancel that raced dispatch). */
  markRunRunning(runId: string): Promise<boolean>;
}

// Narrow view of AgentSessionService the dispatcher depends on — injected
// so the mechanics stay unit-testable without sockets.
export interface AgentSessionAdapter {
  isConnected(agentId: string): boolean;
  sendToAgent(
    agentId: string,
    type: string,
    runId: string | undefined,
    payload: unknown,
  ): boolean;
}

// Frame entry point AgentSessionService delegates to. Handlers return
// false for a runId the dispatcher does not own — the session service
// treats that as a protocol violation for stream frames and as a late
// (ignorable) frame for job.ack.
export interface RemoteRunHandler {
  onJobAck(agentId: string, runId: string, payload: JobAckPayload): Promise<boolean>;
  onSourceIdentity(agentId: string, runId: string, payload: SourceIdentityPayload): Promise<boolean>;
  onAssetBatch(agentId: string, runId: string, payload: AssetBatchPayload): Promise<boolean>;
  onPhase(agentId: string, runId: string, payload: PhasePayload): Promise<boolean>;
  onRunError(agentId: string, runId: string, payload: RunErrorPayload): Promise<boolean>;
  onRunComplete(agentId: string, runId: string, payload: RunCompletePayload): Promise<boolean>;
  onSessionReady(agentId: string): void;
  onSessionLost(agentId: string): Promise<void>;
  /** runId this agent was assigned but the hub already finalized — its
   *  frames are late (discard, warn), not protocol violations. */
  isDeadRun(agentId: string, runId: string): boolean;
}

interface InFlight {
  job: RemoteJobContext;
  state: "ASSIGNED" | "RUNNING";
  ackTimer?: ReturnType<typeof setTimeout>;
  cancelTimer?: ReturnType<typeof setTimeout>;
  cancelRequested: boolean;
  assignedAt: number;
  startedAt?: string;
  currentPhase: string | null;
  yieldedComponentIds: Set<string>;
  counters: {
    processed: number;
    created: number;
    updated: number;
    orphaned: number;
  };
}

// Hub-side outcome vocabulary — broader than the wire `run.complete`
// result (the agent's own JobResult): lost/unavailable/incompatible are
// finalizations the hub declares, not agent-reported results.
type JobOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "lost"
  | "unavailable"
  | "incompatible";

const DEFAULT_CAPACITY = 1;
// Remember recently-finalized runs so their late frames are discarded
// rather than treated as protocol violations (bounded — FIFO evict).
const DEAD_RUN_CAP = 512;

export class RemoteRunService implements RemoteRunHandler {
  private pendingByAgent = new Map<string, string[]>();
  private queuedJobs = new Map<string, RemoteJobContext>();
  private dispatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private inFlight = new Map<string, InFlight>();
  private deadRuns = new Map<string, string>();
  private dispatchTimeoutMs: number;
  private ackTimeoutMs: number;
  private store: RemoteRunStore;
  private log: { warn: (o: object, msg: string) => void; info: (o: object, msg: string) => void };

  constructor(
    private sessions: AgentSessionAdapter,
    opts?: {
      store?: RemoteRunStore;
      dispatchTimeoutMs?: number;
      ackTimeoutMs?: number;
      log?: { warn: (o: object, msg: string) => void; info: (o: object, msg: string) => void };
    },
  ) {
    this.store = opts?.store ?? createDbRemoteRunStore();
    this.dispatchTimeoutMs =
      opts?.dispatchTimeoutMs ??
      envInt("AGENT_DISPATCH_TIMEOUT_MS", AGENT_DISPATCH_TIMEOUT_MS);
    this.ackTimeoutMs =
      opts?.ackTimeoutMs ?? envInt("AGENT_JOB_ACK_TIMEOUT_MS", AGENT_JOB_ACK_TIMEOUT_MS);
    this.log = opts?.log ?? { warn: () => {}, info: () => {} };
  }

  // Called by import-run-service startRun when the config is agent-bound.
  // The run row is already PENDING with agentId stamped.
  async enqueue(runId: string): Promise<void> {
    const job = await this.store.loadJob(runId);
    if (!job) {
      this.log.warn({ runId }, "remote enqueue: run no longer loadable");
      return;
    }
    // A cancel that landed between row-commit and enqueue is honored —
    // the run must never dispatch (in-process parity).
    if (job.cancelRequestedAt) {
      await this.finalizeQueuedCancelled(job);
      return;
    }
    if (job.runStatus !== "PENDING") return; // finalized between commit and enqueue
    // Fail fast on a hard gate — no point parking the run in the queue
    // until the dispatch deadline (US6).
    const gate = this.jobGate(job);
    if (gate) {
      await this.failQueuedRun(job, gate);
      return;
    }
    this.queuedJobs.set(runId, job);
    const queue = this.pendingByAgent.get(job.agent.id) ?? [];
    queue.push(runId);
    this.pendingByAgent.set(job.agent.id, queue);
    this.armDispatchDeadline(job);
    await this.tryDispatch(job.agent.id);
  }

  isQueued(runId: string): boolean {
    return this.queuedJobs.has(runId);
  }

  // Drain an agent's FIFO while it has connectivity and capacity. Called on
  // enqueue, on session attach, and whenever a slot frees (job finalizes).
  async tryDispatch(agentId: string): Promise<void> {
    const queue = this.pendingByAgent.get(agentId);
    if (!queue || queue.length === 0) return;
    if (!this.sessions.isConnected(agentId)) return;

    while (queue.length > 0) {
      const head = queue[0]!;
      const job = await this.store.loadJob(head);
      // Re-validate at dispatch time — the run may have been cancelled,
      // failed, or the agent's policy drifted while the job waited.
      if (!job || job.runStatus !== "PENDING") {
        this.dequeue(agentId, head);
        continue;
      }
      if (job.cancelRequestedAt) {
        this.dequeue(agentId, head);
        await this.finalizeQueuedCancelled(job);
        continue;
      }
      const gate = this.jobGate(job);
      if (gate) {
        this.dequeue(agentId, head);
        await this.failQueuedRun(job, gate);
        continue;
      }
      if (this.inFlightCount(agentId) >= this.capacityFor(job)) return;
      if (!this.sessions.isConnected(agentId)) return;

      queue.shift();
      const payload: JobAssignPayload = {
        importerName: job.importerName,
        scope: job.scope,
      };
      if (job.secretRefMap) payload.secretRefMap = job.secretRefMap;
      const sent = this.sessions.sendToAgent(agentId, "job.assign", job.runId, payload);
      if (!sent) {
        // Session died between isConnected and send — requeue at the head
        // and wait for the next session-ready signal.
        queue.unshift(job.runId);
        return;
      }
      metrics.agentDispatchWaitSeconds.observe(
        { agent: job.agent.name },
        Math.max(
          0,
          (Date.now() - new Date(job.runCreatedAt).getTime()) / 1000,
        ),
      );

      this.clearDeadline(job.runId);
      this.queuedJobs.delete(job.runId);
      const entry: InFlight = {
        job,
        state: "ASSIGNED",
        cancelRequested: false,
        assignedAt: Date.now(),
        currentPhase: null,
        yieldedComponentIds: new Set(),
        counters: { processed: 0, created: 0, updated: 0, orphaned: 0 },
      };
      entry.ackTimer = setTimeout(() => void this.onAckTimeout(job.runId), this.ackTimeoutMs);
      entry.ackTimer.unref?.();
      this.inFlight.set(job.runId, entry);

      // Stamp which credentials fed this run (AGENT_MANAGED refs — the
      // same linkage in-process runs record for STORED credentials).
      if (job.credentialIds.length > 0) {
        await this.store.updateRun(job.runId, {
          credentialIds: toJsonb(job.credentialIds),
        });
        await this.store.touchCredentials(job.credentialIds);
      }
      this.log.info(
        { runId: job.runId, agent: job.agent.name, importer: job.importerName },
        "job assigned to agent",
      );
    }
    if (queue.length === 0) this.pendingByAgent.delete(agentId);
  }

  private capacityFor(job: RemoteJobContext): number {
    return job.agent.maxConcurrentJobs ?? DEFAULT_CAPACITY;
  }

  // Hard dispatch gates, evaluated identically at enqueue and again at
  // dispatch (the agent's policy/credential state can drift while queued).
  // Order matters: dead agent → policy → dead credential → missing keys.
  private jobGate(
    job: RemoteJobContext,
  ): { result: JobOutcome; errorType: string; message: string } | null {
    if (job.agent.revokedAt) {
      return {
        result: "unavailable",
        errorType: "AGENT_UNAVAILABLE",
        message: `Agent "${job.agent.name}" has been revoked`,
      };
    }
    const allowed = job.agent.allowedImporters;
    if (allowed.length > 0 && !allowed.includes(job.importerName)) {
      return {
        result: "incompatible",
        errorType: "AGENT_INCOMPATIBLE",
        message: `Agent "${job.agent.name}" policy does not allow importer "${job.importerName}"`,
      };
    }
    if (job.revokedCredentialLabel) {
      return {
        result: "failed",
        errorType: "CREDENTIAL_REVOKED",
        message: `Credential "${job.revokedCredentialLabel}" is revoked and cannot feed a remote run`,
      };
    }
    if (job.missingSecretKeys.length > 0) {
      return {
        result: "failed",
        errorType: "CREDENTIAL_MISSING_KEY",
        message: `Missing required secret(s) for importer "${job.importerName}": ${job.missingSecretKeys.join(", ")} — link an agent-managed credential covering them`,
      };
    }
    if (job.missingTarget) {
      return {
        result: "failed",
        errorType: "TARGET_RESOLUTION_FAILED",
        message: `Importer "${job.importerName}" requires a target reference in scope key "${job.targetRefKey}"`,
      };
    }
    return null;
  }

  private inFlightCount(agentId: string): number {
    let n = 0;
    for (const e of this.inFlight.values()) if (e.job.agent.id === agentId) n++;
    return n;
  }

  private armDispatchDeadline(job: RemoteJobContext): void {
    const timer = setTimeout(
      () => void this.onDispatchTimeout(job.runId),
      this.dispatchTimeoutMs,
    );
    timer.unref?.();
    this.dispatchTimers.set(job.runId, timer);
  }

  private clearDeadline(runId: string): void {
    const t = this.dispatchTimers.get(runId);
    if (t) clearTimeout(t);
    this.dispatchTimers.delete(runId);
  }

  private dequeue(agentId: string, runId: string): void {
    const q = this.pendingByAgent.get(agentId);
    if (q) {
      const i = q.indexOf(runId);
      if (i >= 0) q.splice(i, 1);
      if (q.length === 0) this.pendingByAgent.delete(agentId);
    }
    this.queuedJobs.delete(runId);
    this.clearDeadline(runId);
  }

  private async onDispatchTimeout(runId: string): Promise<void> {
    const job = this.queuedJobs.get(runId);
    if (!job) return;
    this.dequeue(job.agent.id, runId);
    await this.failQueuedRun(job, {
      result: "unavailable",
      errorType: "AGENT_UNAVAILABLE",
      message: `Agent "${job.agent.name}" did not become available for the job within ${this.dispatchTimeoutMs} ms`,
    });
  }

  private async onAckTimeout(runId: string): Promise<void> {
    const entry = this.inFlight.get(runId);
    if (!entry || entry.state !== "ASSIGNED") return;
    // The agent may be running a job it never acknowledged — tell it to
    // abort so the zombie doesn't keep streaming (its next frames land on
    // the dead-run registry and are ignored, not fatal).
    this.sendCancel(entry, "ack timeout");
    await this.finalize(entry, "unavailable", {
      status: "FAILED",
      completedAt: new Date().toISOString(),
      currentPhase: "Failed",
      errorType: "AGENT_UNAVAILABLE",
      errorMessage: `Agent "${entry.job.agent.name}" did not acknowledge the job within ${this.ackTimeoutMs} ms`,
    });
  }

  private async failQueuedRun(
    job: RemoteJobContext,
    gate: { result: JobOutcome; errorType: string; message: string },
  ): Promise<void> {
    try {
      await this.store.updateRun(job.runId, {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        currentPhase: "Failed",
        errorType: gate.errorType,
        errorMessage: gate.message,
      });
    } catch (err) {
      // A concurrent cancel/finalize already terminal-wrote the row.
      this.log.warn({ runId: job.runId, err }, "queued fail arrived after finalization");
      return;
    }
    metrics.agentJobsTotal.inc({ agent: job.agent.name, result: gate.result });
    metrics.importRunsTotal.inc({ importer: job.importerName, status: "FAILED" });
    this.log.warn({ runId: job.runId, agent: job.agent.name, errorType: gate.errorType }, "remote run failed before dispatch");
  }

  // --- RemoteRunHandler -------------------------------------------------

  async onJobAck(agentId: string, runId: string, payload: JobAckPayload): Promise<boolean> {
    const entry = this.inFlight.get(runId);
    // Foreign runId → the session layer decides (violation vs dead-run
    // discard). A duplicate ack on an owned, already-running job is
    // benign — handled, warned, no state change.
    if (!entry || entry.job.agent.id !== agentId) return false;
    if (entry.state !== "ASSIGNED") {
      this.log.warn({ runId, agentId, state: entry.state }, "ignoring duplicate job.ack");
      return true;
    }
    if (entry.ackTimer) clearTimeout(entry.ackTimer);
    entry.ackTimer = undefined;

    if (!payload.accepted) {
      // Cancel wins — a refusal landing after a cancel request finalizes
      // CANCELLED, same as the completed-after-cancel mapping.
      if (entry.cancelRequested) {
        await this.finalize(entry, "cancelled", {
          status: "CANCELLED",
          completedAt: new Date().toISOString(),
          currentPhase: "Cancelled",
        });
        return true;
      }
      const reason = payload.reason ?? "agent rejected the job";
      // NACK reason prefixes map to run errorTypes: secret-resolution
      // failures keep their name; a capacity refusal is transient
      // (AGENT_UNAVAILABLE), everything else is AGENT_INCOMPATIBLE.
      const secretFailure = reason.startsWith(AGENT_NACK_SECRET_RESOLUTION_PREFIX);
      const capacityRefusal = reason.startsWith(AGENT_NACK_UNAVAILABLE_PREFIX);
      const targetFailure = reason.startsWith(AGENT_NACK_TARGET_RESOLUTION_PREFIX);
      await this.finalize(
        entry,
        secretFailure || targetFailure ? "failed" : capacityRefusal ? "unavailable" : "incompatible",
        {
          status: "FAILED",
          completedAt: new Date().toISOString(),
          currentPhase: "Failed",
          errorType: secretFailure
            ? "SECRET_RESOLUTION_FAILED"
            : targetFailure
              ? "TARGET_RESOLUTION_FAILED"
              : capacityRefusal
                ? "AGENT_UNAVAILABLE"
                : "AGENT_INCOMPATIBLE",
          errorMessage: reason,
        },
      );
      return true;
    }

    // The run may have left PENDING between loadJob and this ack (a cancel
    // that raced dispatch) — a blind update would hit the terminal-state
    // immutability trigger. Conditional transition instead.
    const now = new Date().toISOString();
    const transitioned = await this.store.markRunRunning(runId);
    if (!transitioned) {
      this.inFlight.delete(runId);
      this.markDead(runId, agentId);
      this.sendCancel(entry, "run left PENDING before ack");
      this.log.warn({ runId, agentId }, "job.ack for a run no longer pending — cancelling agent job");
      return true;
    }
    entry.state = "RUNNING";
    entry.startedAt = now;
    // A cancel can finalize between markRunRunning and this write.
    if (this.inFlight.get(runId) !== entry) return true;
    try {
      await this.store.updateRun(runId, { currentPhase: "Remote execution" });
    } catch (err) {
      this.log.warn({ runId, err }, "phase write raced run finalization — discarded");
    }
    return true;
  }

  async onSourceIdentity(agentId: string, runId: string, payload: SourceIdentityPayload): Promise<boolean> {
    const entry = this.inFlight.get(runId);
    if (!entry || entry.job.agent.id !== agentId || entry.state !== "RUNNING") {
      return false;
    }
    // A source.identity frame on a non-adopting manifest must not flip the
    // run to source-scoped reconciliation (FR-013).
    if (!entry.job.reportsSourceIdentity) {
      this.log.warn({ runId }, "ignoring source.identity from a non-adopting importer");
      return true;
    }
    if (entry.job.sourceId) {
      this.log.warn({ runId }, "ignoring duplicate source.identity frame");
      return true;
    }
    try {
      entry.job.sourceId = await this.store.recordSourceIdentity(entry.job, payload);
    } catch (err) {
      // A registration failure swallowed into the frame-queue warn log
      // leaves the run to die later under a misleading CONTRACT_VIOLATION
      // — finalize with the real cause instead.
      await this.finalize(entry, "failed", {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        currentPhase: "Failed",
        errorType: (err as { code?: string }).code ?? "RUNTIME_ERROR",
        errorMessage:
          err instanceof Error ? err.message : "Source identity registration failed",
      });
      return true;
    }
    entry.job.sourceIdentity = canonicalizeSourceIdentity(payload.externalIdentity);
    return true;
  }

  async onAssetBatch(agentId: string, runId: string, payload: AssetBatchPayload): Promise<boolean> {
    const entry = this.inFlight.get(runId);
    if (!entry || entry.job.agent.id !== agentId || entry.state !== "RUNNING") {
      return false;
    }
    // An adopting importer must report source identity before its first
    // batch (ADR-056 A1/A2) — the agent enforces ordering, and the hub
    // fails closed if a non-compliant agent streams anyway.
    if (entry.job.reportsSourceIdentity && !entry.job.sourceId) {
      await this.finalize(entry, "failed", {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        currentPhase: "Failed",
        errorType: "CONTRACT_VIOLATION",
        errorMessage: "Importer streamed assets before reporting its source identity",
      });
      return true;
    }
    for (const raw of payload.assets) {
      // The run can finalize mid-batch (session lost / cancel) — stop
      // processing rather than writing assets to a terminal row.
      if (this.inFlight.get(runId) !== entry) return true;
      entry.counters.processed++;
      const validation = validateDiscoveredAssetDetailed(raw);
      if (!validation.valid) {
        const assetId =
          typeof (raw as { externalId?: unknown })?.externalId === "string"
            ? (raw as { externalId: string }).externalId
            : null;
        await this.store.insertRunError(
          runId,
          assetId,
          "VALIDATION_FAILED",
          validation.errors?.join("; ") ?? "Validation failed",
        );
        metrics.importRunErrorsTotal.inc({
          importer: entry.job.importerName,
          errorType: "VALIDATION_FAILED",
        });
        continue;
      }
      const asset = raw as DiscoveredAsset;
      const result = await this.store.processAsset(entry.job, asset);
      entry.yieldedComponentIds.add(result.componentId);
      entry.counters.created += result.created ? 1 : 0;
      entry.counters.updated += result.created ? 0 : 1;
      entry.counters.orphaned += result.instancesOrphaned;
      metrics.agentAssetsReceivedTotal.inc({
        agent: entry.job.agent.name,
        importer: entry.job.importerName,
      });
      metrics.importRunAssetsYieldedTotal.inc({ importer: entry.job.importerName });
    }
    // Final mid-batch check before the counter write (terminal rows are
    // immutable — ADR-100); an off-queue finalize can still race the
    // UPDATE itself, which the guard can't observe — tolerate it.
    if (this.inFlight.get(runId) !== entry) return true;
    try {
      await this.store.updateRun(runId, {
        assetsProcessed: entry.counters.processed,
        assetsCreated: entry.counters.created,
        assetsUpdated: entry.counters.updated,
        instancesOrphaned: entry.counters.orphaned,
      });
    } catch (err) {
      this.log.warn({ runId, err }, "counter write raced run finalization — discarded");
    }
    return true;
  }

  async onPhase(agentId: string, runId: string, payload: PhasePayload): Promise<boolean> {
    const entry = this.inFlight.get(runId);
    if (!entry || entry.job.agent.id !== agentId || entry.state !== "RUNNING") {
      return false;
    }
    entry.currentPhase = payload.name;
    try {
      await this.store.updateRun(runId, { currentPhase: payload.name });
    } catch (err) {
      this.log.warn({ runId, err }, "phase write raced run finalization — discarded");
    }
    return true;
  }

  async onRunError(agentId: string, runId: string, payload: RunErrorPayload): Promise<boolean> {
    const entry = this.inFlight.get(runId);
    if (!entry || entry.job.agent.id !== agentId || entry.state !== "RUNNING") {
      return false;
    }
    await this.store.insertRunError(
      runId,
      payload.assetExternalId ?? null,
      payload.errorType,
      payload.errorMessage,
    );
    metrics.importRunErrorsTotal.inc({
      importer: entry.job.importerName,
      errorType: payload.errorType,
    });
    return true;
  }

  async onRunComplete(agentId: string, runId: string, payload: RunCompletePayload): Promise<boolean> {
    const entry = this.inFlight.get(runId);
    if (!entry || entry.job.agent.id !== agentId || entry.state !== "RUNNING") {
      return false;
    }
    const now = new Date().toISOString();
    const base = {
      completedAt: now,
      assetsProcessed: entry.counters.processed,
      assetsCreated: entry.counters.created,
      assetsUpdated: entry.counters.updated,
      instancesOrphaned: entry.counters.orphaned,
    };
    if (payload.result === "COMPLETED" && !entry.cancelRequested) {
      // An adopting importer that completes without reporting identity
      // fails as a contract violation — it must not fall through to
      // legacy config-scoped reconciliation (FR-002).
      if (entry.job.reportsSourceIdentity && !entry.job.sourceId) {
        await this.finalize(entry, "failed", {
          ...base,
          status: "FAILED",
          currentPhase: "Failed",
          errorType: "CONTRACT_VIOLATION",
          errorMessage: "Importer completed without reporting its source identity",
        }, true);
        return true;
      }
      const componentsRetired = await this.store.reconcile(
        entry.job,
        entry.yieldedComponentIds,
      );
      // Reconcile yields — a cancel/session-loss may have finalized
      // meanwhile; writing now would hit the terminal-state trigger. A
      // cancel request landing during reconcile still wins below.
      if (this.inFlight.get(runId) !== entry) return true;
      if (!entry.cancelRequested) {
        await this.finalize(entry, "completed", {
        ...base,
        status: "COMPLETED",
        currentPhase: "Completed",
          componentsRetired,
        }, true);
        // Failure-isolated — a suggestion bug must never flip a completed run.
        try {
          await this.store.stageSuggestions([...entry.yieldedComponentIds], runId);
        } catch (err) {
          this.log.warn({ runId, err }, "edge suggestion pass failed after remote run");
        }
        return true;
      }
    }
    // A COMPLETED confirmation after a cancel request lands as CANCELLED —
    // same mapping the in-process worker applies to cancelRequestedAt.
    if (payload.result === "CANCELLED" || entry.cancelRequested) {
      await this.finalize(entry, "cancelled", {
        ...base,
        status: "CANCELLED",
        currentPhase: "Cancelled",
      }, true);
      return true;
    }
    await this.finalize(entry, "failed", {
      ...base,
      status: "FAILED",
      currentPhase: "Failed",
      errorType: payload.errorType ?? "RUNTIME_ERROR",
      errorMessage: payload.errorMessage ?? "Remote run failed",
    }, true);
    return true;
  }

  onSessionReady(agentId: string): void {
    void this.tryDispatch(agentId);
  }

  async onSessionLost(agentId: string): Promise<void> {
    const lost = [...this.inFlight.values()].filter((e) => e.job.agent.id === agentId);
    for (const entry of lost) {
      // Each finalize is isolated — a terminal-write race on one run must
      // not leave the agent's other in-flight runs RUNNING forever.
      try {
        await this.finalize(entry, "lost", {
          status: "FAILED",
          completedAt: new Date().toISOString(),
          currentPhase: "Failed",
          errorType: "AGENT_LOST",
          errorMessage: `Connection to agent "${entry.job.agent.name}" was lost`,
          assetsProcessed: entry.counters.processed,
          assetsCreated: entry.counters.created,
          assetsUpdated: entry.counters.updated,
          instancesOrphaned: entry.counters.orphaned,
        });
      } catch (err) {
        this.log.warn(
          { runId: entry.job.runId, agentId, err },
          "failed to finalize run on session loss",
        );
      }
    }
  }

  // --- Cancellation -----------------------------------------------------

  // Called by import-run-service cancelRun AFTER cancelRequestedAt is
  // stamped. Queued runs cancel instantly (never dispatched); in-flight
  // runs get the cancel frame — the agent's run.complete{CANCELLED} is
  // the confirmation.
  async cancelRemoteRun(runId: string): Promise<void> {
    const entry = this.inFlight.get(runId);
    if (entry) {
      entry.cancelRequested = true;
      this.sendCancel(entry, "cancel requested");
      // The confirmation is bounded — a live-but-stuck agent job cannot
      // hold the run RUNNING forever (SC-003/SC-007); disconnect resolves
      // it earlier via onSessionLost.
      if (!entry.cancelTimer) {
        entry.cancelTimer = setTimeout(
          () => void this.onCancelTimeout(runId),
          this.ackTimeoutMs,
        );
        entry.cancelTimer.unref?.();
      }
      return;
    }
    const job = this.queuedJobs.get(runId);
    if (!job) return;
    this.dequeue(job.agent.id, runId);
    await this.finalizeQueuedCancelled(job);
  }

  private async finalizeQueuedCancelled(job: RemoteJobContext): Promise<void> {
    try {
      await this.store.updateRun(job.runId, {
        status: "CANCELLED",
        completedAt: new Date().toISOString(),
        currentPhase: "Cancelled",
      });
    } catch (err) {
      // A concurrent finalize already terminal-wrote the row — the
      // immutability trigger throws; nothing left to do.
      this.log.warn({ runId: job.runId, err }, "queued cancel arrived after finalization");
      return;
    }
    metrics.agentJobsTotal.inc({ agent: job.agent.name, result: "cancelled" });
    metrics.importRunsTotal.inc({ importer: job.importerName, status: "CANCELLED" });
  }

  private sendCancel(entry: InFlight, why: string): void {
    const sent = this.sessions.sendToAgent(
      entry.job.agent.id,
      "cancel",
      entry.job.runId,
      { runId: entry.job.runId },
    );
    if (!sent) {
      this.log.warn(
        { runId: entry.job.runId, agentId: entry.job.agent.id, why },
        "could not send cancel frame — no live session",
      );
    }
  }

  private async onCancelTimeout(runId: string): Promise<void> {
    const entry = this.inFlight.get(runId);
    if (!entry) return;
    await this.finalize(entry, "lost", {
      status: "FAILED",
      completedAt: new Date().toISOString(),
      currentPhase: "Failed",
      errorType: "AGENT_LOST",
      errorMessage: `Agent "${entry.job.agent.name}" did not confirm cancellation within ${this.ackTimeoutMs} ms`,
      assetsProcessed: entry.counters.processed,
      assetsCreated: entry.counters.created,
      assetsUpdated: entry.counters.updated,
      instancesOrphaned: entry.counters.orphaned,
    });
  }

  // --- Read surfaces ----------------------------------------------------

  activeRunsForAgent(agentId: string): AgentActiveRun[] {
    const rows: AgentActiveRun[] = [];
    for (const e of this.inFlight.values()) {
      if (e.job.agent.id !== agentId) continue;
      rows.push({
        runId: e.job.runId,
        configId: e.job.configId,
        configLabel: e.job.configLabel,
        state: e.state,
        phase: e.currentPhase,
        startedAt: e.startedAt ?? null,
      });
    }
    return rows;
  }

  runningJobCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const e of this.inFlight.values()) {
      const id = e.job.agent.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  isDeadRun(agentId: string, runId: string): boolean {
    return this.deadRuns.get(runId) === agentId;
  }

  private markDead(runId: string, agentId: string): void {
    if (this.deadRuns.size >= DEAD_RUN_CAP) {
      const oldest = this.deadRuns.keys().next().value;
      if (oldest !== undefined) this.deadRuns.delete(oldest);
    }
    this.deadRuns.set(runId, agentId);
  }

  stop(): void {
    for (const t of this.dispatchTimers.values()) clearTimeout(t);
    for (const e of this.inFlight.values()) {
      if (e.ackTimer) clearTimeout(e.ackTimer);
      if (e.cancelTimer) clearTimeout(e.cancelTimer);
    }
    this.dispatchTimers.clear();
  }

  // --- Internals --------------------------------------------------------

  private async finalize(
    entry: InFlight,
    result: JobOutcome,
    patch: Record<string, unknown>,
    // spec 028: agent_remote_job_duration_seconds is scoped to runs the
    // agent confirmed via run.complete — not lost/unavailable finalizes.
    viaRunComplete = false,
  ): Promise<void> {
    if (entry.ackTimer) clearTimeout(entry.ackTimer);
    if (entry.cancelTimer) clearTimeout(entry.cancelTimer);
    this.inFlight.delete(entry.job.runId);
    // Late frames for a run we finalized are discarded, not violations.
    this.markDead(entry.job.runId, entry.job.agent.id);
    await this.store.updateRun(entry.job.runId, patch);
    metrics.agentJobsTotal.inc({ agent: entry.job.agent.name, result });
    const status =
      result === "completed"
        ? "COMPLETED"
        : result === "cancelled"
          ? "CANCELLED"
          : "FAILED";
    metrics.importRunsTotal.inc({ importer: entry.job.importerName, status });
    metrics.importRunDurationSeconds.observe(
      { importer: entry.job.importerName },
      (Date.now() - entry.assignedAt) / 1000,
    );
    if (viaRunComplete) {
      metrics.agentRemoteJobDurationSeconds.observe(
        { agent: entry.job.agent.name, importer: entry.job.importerName },
        (Date.now() - entry.assignedAt) / 1000,
      );
    }
    // A freed slot may unblock the agent's queue.
    await this.tryDispatch(entry.job.agent.id);
  }
}

// Default store: real DB-backed effects composing the shared run internals
// exported by import-run-service — remote runs get byte-identical upsert,
// reconciliation, and suggestion behavior (ADR-116 #5).
export function createDbRemoteRunStore(): RemoteRunStore {
  return {
    async loadJob(runId) {
      const run = await db
        .selectFrom("import_runs")
        .selectAll()
        .where("id", "=", runId)
        .executeTakeFirst();
      if (!run || !run.agentId) return null;

      const config = await db
        .selectFrom("importer_configs")
        .selectAll()
        .where("id", "=", run.configId)
        .executeTakeFirst();
      const agent = await db
        .selectFrom("import_agents")
        .selectAll()
        .where("id", "=", run.agentId)
        .executeTakeFirst();
      if (!config || !agent) {
        // The run's config (or agent) was deleted while it queued —
        // finalize it rather than leaving it PENDING forever (ADR-047 A1).
        if (run.status === "PENDING") {
          try {
            await updateRun(runId, {
              status: "FAILED",
              completedAt: new Date().toISOString(),
              currentPhase: "Failed",
              errorType: config ? "AGENT_UNAVAILABLE" : "CONFIG_DELETED",
              errorMessage: config
                ? "Assigned agent no longer exists"
                : "Importer config was deleted before dispatch",
            });
          } catch { /* raced finalization — terminal rows are immutable */ }
        }
        return null;
      }

      // Merge every linked AGENT_MANAGED credential's reference map. Key
      // collisions are impossible — the config write path rejects them.
      const junction = await db
        .selectFrom("importer_config_credentials")
        .select("credentialId")
        .where("configId", "=", config.id)
        .execute();
      const credentialIds = junction.map((r) => r.credentialId);
      let secretRefMap: SecretRefMap | null = null;
      let revokedCredentialLabel: string | null = null;
      if (credentialIds.length > 0) {
        const creds = await db
          .selectFrom("credentials")
          .select(["id", "label", "kind", "secretRefMap", "status"])
          .where("id", "in", credentialIds)
          .execute();
        const merged: SecretRefMap = {};
        for (const cred of creds) {
          // A credential revoked after binding must not feed the run —
          // in-process parity (resolveImportSecrets → CREDENTIAL_REVOKED).
          if (cred.status === "REVOKED") {
            revokedCredentialLabel ??= cred.label;
            continue;
          }
          if (cred.kind !== "AGENT_MANAGED" || !cred.secretRefMap) continue;
          for (const [key, ref] of Object.entries(cred.secretRefMap)) {
            if (typeof ref.env === "string") merged[key] = { env: ref.env };
            else if (typeof ref.file === "string") merged[key] = { file: ref.file };
          }
        }
        if (Object.keys(merged).length > 0) secretRefMap = merged;
      }

      // Same coverage check the in-process worker runs before executing —
      // a required key absent from the merged refs fails at dispatch, not
      // mid-run on the agent.
      const manifest = await getManifest(config.importerName);
      const missingSecretKeys = (manifest.secrets ?? [])
        .filter((d) => d.required && !(secretRefMap && d.key in secretRefMap))
        .map((d) => d.key);
      const targetRefKey = manifest.targetRefKey ?? null;
      const missingTarget =
        targetRefKey !== null &&
        (typeof config.scope[targetRefKey] !== "string" ||
          (config.scope[targetRefKey] as string).trim() === "");

      return {
        runId: run.id,
        runStatus: run.status,
        configId: config.id,
        configLabel: config.label,
        importerName: config.importerName,
        triggeredBy: run.triggeredBy,
        scope: config.scope,
        secretRefMap,
        credentialIds,
        revokedCredentialLabel,
        missingSecretKeys,
        targetRefKey,
        missingTarget,
        reportsSourceIdentity: manifest.reportsSourceIdentity === true,
        sourceId: run.sourceId ?? null,
        sourceIdentity: null,
        cancelRequestedAt: run.cancelRequestedAt,
        runCreatedAt: run.createdAt,
        agent: {
          id: agent.id,
          name: agent.name,
          revokedAt: agent.revokedAt,
          allowedImporters: agent.allowedImporters ?? [],
          maxConcurrentJobs: agent.maxConcurrentJobs,
        },
      };
    },
    async updateRun(runId, patch) {
      await updateRun(runId, patch);
    },
    async insertRunError(runId, assetExternalId, errorType, errorMessage) {
      await insertRunError(runId, assetExternalId, errorType, errorMessage);
    },
    async recordSourceIdentity(job, identity) {
      return recordRunSourceIdentity(
        job.importerName,
        identity,
        job.runId,
        job.configId,
        runActor(job.importerName),
      );
    },
    async processAsset(job, asset) {
      return traceDbQuery("processAsset", () =>
        db.transaction().execute(async (trx) =>
          processAsset(trx, job.runId, job.importerName, asset, job.triggeredBy, { sourceId: job.sourceId, sourceIdentity: job.sourceIdentity, configId: job.configId }),
        ),
      );
    },
    async reconcile(job, yieldedComponentIds) {
      const rec = await reconcileRetiredComponents(
        job.runId,
        job.importerName,
        job.configId,
        yieldedComponentIds,
        job.sourceId,
      );
      return rec.componentsRetired;
    },
    async stageSuggestions(componentIds, runId) {
      const report = await runSuggestionPass({ componentIds }, { runId });
      if (report) {
        appLogger.info({ runId, ...report }, "edge suggestions staged after remote run");
      }
    },
    async touchCredentials(credentialIds) {
      await db
        .updateTable("credentials")
        .set({ lastUsedAt: new Date().toISOString() })
        .where("id", "in", credentialIds)
        .execute();
    },
    async markRunRunning(runId) {
      const res = await db
        .updateTable("import_runs")
        .set({
          status: "RUNNING",
          startedAt: new Date().toISOString(),
        })
        .where("id", "=", runId)
        .where("status", "=", "PENDING")
        .executeTakeFirst();
      return res.numUpdatedRows > 0n;
    },
  };
}
