import {
  AGENT_NACK_TARGET_RESOLUTION_PREFIX,
  AGENT_NACK_UNAVAILABLE_PREFIX,
  NOOP_TRACER,
  sourceIdentityPayloadSchema,
  type ImporterRegistry,
  type JobAssignPayload,
  type Logger,
} from "@componode/core";
import {
  maskSecretValues,
  SecretRefError,
  SecretResolutionError,
} from "@componode/core/secrets";
import { createAgentResolver, resolveRefMap, type AgentLog } from "./secrets.js";
import { loadTargetProfile } from "./target-registry.js";
import type { AgentOpsMetrics } from "./metrics.js";

// Remote job executor (spec 027, ADR-116): the agent-side half of remote
// import execution. On `job.assign` it validates capacity + compiled
// availability, resolves the reference map LOCALLY (values never leave the
// host), runs the importer's async generator, and streams bounded
// asset.batch / phase / run.* frames back over the session. The hub owns
// everything downstream — the agent never writes to a database.

// Wire bounds (ADR-116): a batch flushes at 100 assets or ~1 MB serialized,
// whichever comes first. An individual asset that alone exceeds the frame
// cap fails with ASSET_TOO_LARGE and the run continues.
const BATCH_MAX_ASSETS = 100;
const BATCH_MAX_BYTES = 1_000_000;

export interface JobExecutorDeps {
  secretsDir?: string;
  registry: ImporterRegistry;
  maxJobs: number;
  log: AgentLog;
  send: (type: string, payload: unknown, runId?: string) => void;
  /** Ops counters (spec 028) — optional so test harnesses stay lean. */
  ops?: AgentOpsMetrics;
}

interface ActiveJob {
  controller: AbortController;
  /** Manifest-declared scope key carrying the targetId (ADR-116 A6). */
  targetRefKey?: string | null;
  /** Preflight-resolved non-secret profile for `resolveTarget`. */
  resolvedTarget?: unknown;
  /** The scope-supplied targetId that resolved. */
  targetId?: string;
  /** Manifest `reportsSourceIdentity` — adopting importer contract. */
  reportsSourceIdentity?: boolean;
  /** Set once `source.identity` has been emitted for this job. */
  sourceIdentityReported?: boolean;
}

export class JobExecutor {
  private activeJobs = new Map<string, ActiveJob>();

  constructor(private deps: JobExecutorDeps) {}

  currentJobs(): number {
    return this.activeJobs.size;
  }

  activeRunIds(): string[] {
    return [...this.activeJobs.keys()];
  }

  // Session teardown: abort every local job. The hub independently fails
  // the runs AGENT_LOST — the aborts just stop local work promptly.
  abortAll(): void {
    for (const job of this.activeJobs.values()) job.controller.abort();
  }

  handleCancel(runId: string): void {
    this.activeJobs.get(runId)?.controller.abort();
  }

  private nack(runId: string, reason: string): void {
    this.deps.send("job.ack", { accepted: false, reason }, runId);
  }

  async handleJobAssign(runId: string, payload: JobAssignPayload): Promise<void> {
    const { maxJobs } = this.deps;
    if (this.activeJobs.has(runId)) {
      return; // duplicate assign — already running or acknowledged
    }
    this.deps.ops?.jobReceived();
    if (this.activeJobs.size >= maxJobs) {
      this.nack(runId, `${AGENT_NACK_UNAVAILABLE_PREFIX}: agent at capacity (${this.activeJobs.size}/${maxJobs} jobs)`);
      return;
    }
    // Register the job BEFORE importer lookup and secret resolution — a
    // `cancel` frame can arrive while either await is in flight, and must
    // find a controller to abort rather than being dropped.
    const job: ActiveJob = { controller: new AbortController() };
    this.activeJobs.set(runId, job);
    this.deps.ops?.jobAccepted();
    try {
      await this.resolveAndRun(runId, job, payload);
    } finally {
      this.activeJobs.delete(runId);
      this.deps.ops?.jobReleased();
    }
  }

  private async resolveAndRun(
    runId: string,
    job: ActiveJob,
    payload: JobAssignPayload,
  ): Promise<void> {
    const { registry, log } = this.deps;
    let importer;
    try {
      importer = await registry.getImporter(payload.importerName);
    } catch {
      if (job.controller.signal.aborted) {
        this.confirmCancelled(runId);
        return;
      }
      this.nack(
        runId,
        `AGENT_INCOMPATIBLE: importer "${payload.importerName}" is not compiled into this agent`,
      );
      return;
    }

    // Target preflight (ADR-116 A5/A6): a manifest declaring targetRefKey
    // gets its scope targetId resolved against the agent-local registry —
    // fail-before-network, before secret resolution and before job.ack.
    let manifest;
    try {
      manifest = await registry.getManifest(payload.importerName);
    } catch {
      manifest = null;
    }
    job.targetRefKey = manifest?.targetRefKey ?? null;
    job.reportsSourceIdentity = manifest?.reportsSourceIdentity === true;
    if (job.targetRefKey) {
      const targetId = payload.scope?.[job.targetRefKey];
      if (typeof targetId !== "string" || targetId.trim() === "") {
        this.nack(
          runId,
          `${AGENT_NACK_TARGET_RESOLUTION_PREFIX}: scope key "${job.targetRefKey}" must carry a targetId`,
        );
        return;
      }
      try {
        job.resolvedTarget = await loadTargetProfile(
          this.deps.secretsDir,
          payload.importerName,
          targetId,
        );
        job.targetId = targetId;
      } catch (err) {
        this.nack(
          runId,
          `${AGENT_NACK_TARGET_RESOLUTION_PREFIX}: ${err instanceof Error ? err.message : "target resolution failed"}`,
        );
        return;
      }
    }

    // Resolve the reference map BEFORE acknowledging — a missing env var or
    // unreadable file is a dispatch-level rejection, not a mid-run failure.
    // SecretResolutionError/SecretRefError messages are sanitized by
    // construction (key + source type, never values or absolute paths).
    let secrets: Record<string, string> = {};
    if (payload.secretRefMap) {
      try {
        secrets = await resolveRefMap(
          payload.secretRefMap,
          createAgentResolver(this.deps.secretsDir),
          log,
        );
      } catch (err) {
        if (job.controller.signal.aborted) {
          this.confirmCancelled(runId);
          return;
        }
        this.deps.ops?.secretResolutionFailed();
        if (err instanceof SecretResolutionError || err instanceof SecretRefError) {
          this.nack(runId, `SECRET_RESOLUTION_FAILED: ${err.message}`);
          return;
        }
        this.nack(
          runId,
          `SECRET_RESOLUTION_FAILED: secret resolution failed for importer "${payload.importerName}"`,
        );
        return;
      }
    }

    if (job.controller.signal.aborted) {
      // Cancel arrived during importer lookup or secret resolution —
      // acknowledge so the hub can transition the run, then confirm
      // CANCELLED without starting the importer.
      this.confirmCancelled(runId);
      log.info({ runId }, "job cancelled before start");
      return;
    }
    this.deps.send("job.ack", { accepted: true }, runId);
    log.info({ runId, importer: payload.importerName }, "job accepted");
    await this.runJob(runId, job, importer, payload, secrets);
  }

  // Cancel wins over any concurrent failure — acknowledge so the hub can
  // transition the run, then confirm CANCELLED.
  private confirmCancelled(runId: string): void {
    this.deps.send("job.ack", { accepted: true }, runId);
    this.deps.send("run.complete", { result: "CANCELLED" }, runId);
    this.deps.ops?.jobCompleted("CANCELLED");
  }

  private runLogger(runId: string): Logger {
    const outer = this.deps.log;
    const lg: Logger = {
      debug: (msg, data) => outer.debug({ runId, ...(data ?? {}) }, msg),
      info: (msg, data) => outer.info({ runId, ...(data ?? {}) }, msg),
      warn: (msg, data) => outer.warn({ runId, ...(data ?? {}) }, msg),
      error: (msg, data) => outer.error({ runId, ...(data ?? {}) }, msg),
      child: () => lg,
    };
    return lg;
  }

  private async runJob(
    runId: string,
    job: ActiveJob,
    importer: Awaited<ReturnType<ImporterRegistry["getImporter"]>>,
    payload: JobAssignPayload,
    secrets: Record<string, string>,
  ): Promise<void> {
    const { send, log } = this.deps;
    try {
      const context = {
        runId,
        logger: this.runLogger(runId),
        signal: job.controller.signal,
        reportPhase: async (name: string) => {
          if (!job.controller.signal.aborted) {
            send("phase", { name }, runId);
          }
        },
        tracer: NOOP_TRACER,
        reportSourceIdentity: (identity: { externalIdentity: string; label?: string }) => {
          if (job.sourceIdentityReported) {
            log.warn({ runId }, "duplicate source identity report ignored");
            return;
          }
          // Validate before send — an out-of-bounds frame would fail
          // hub-side parse and kill the whole session (BAD_FRAME/1008),
          // taking every in-flight job down with it. A contract violation
          // fails only this run, matching the in-process path.
          if (!sourceIdentityPayloadSchema.safeParse(identity).success) {
            throw Object.assign(
              new Error("Source identity exceeds protocol bounds (identity ≤512 chars, label ≤200)"),
              { code: "CONTRACT_VIOLATION" },
            );
          }
          job.sourceIdentityReported = true;
          send("source.identity", identity, runId);
        },
        resolveTarget: (targetId: string) => {
          if (!job.targetRefKey || !job.resolvedTarget || targetId !== job.targetId) {
            throw new Error(`resolveTarget: no resolved profile for target "${targetId}"`);
          }
          return job.resolvedTarget;
        },
      };

      let batch: unknown[] = [];
      let batchBytes = 0;
      const flush = () => {
        if (batch.length === 0) return;
        send("asset.batch", { assets: batch }, runId);
        this.deps.ops?.assetsSent(payload.importerName, batch.length);
        batch = [];
        batchBytes = 0;
      };

      for await (const asset of importer.run(
        (payload.scope ?? {}) as Record<string, unknown>,
        secrets,
        context,
      )) {
        if (job.reportsSourceIdentity && !job.sourceIdentityReported) {
          throw Object.assign(
            new Error("Importer yielded an asset before reporting its source identity"),
            { code: "CONTRACT_VIOLATION" },
          );
        }
        if (job.controller.signal.aborted) break;
        const serialized = JSON.stringify(asset);
        const size = Buffer.byteLength(serialized);
        if (size > BATCH_MAX_BYTES) {
          // One oversized asset must not kill the run — report it and
          // keep streaming (ADR-116 asset bound).
          send(
            "run.error",
            {
              assetExternalId: asset.externalId,
              errorType: "ASSET_TOO_LARGE",
              errorMessage: `asset exceeds the ${BATCH_MAX_BYTES}-byte frame limit`,
            },
            runId,
          );
          continue;
        }
        batch.push(asset);
        batchBytes += size;
        if (batch.length >= BATCH_MAX_ASSETS || batchBytes >= BATCH_MAX_BYTES) {
          flush();
        }
      }
      flush();

      if (job.controller.signal.aborted) {
        send("run.complete", { result: "CANCELLED" }, runId);
        this.deps.ops?.jobCompleted("CANCELLED");
        return;
      }
      if (job.reportsSourceIdentity && !job.sourceIdentityReported) {
        throw Object.assign(
          new Error("Importer completed without reporting its source identity"),
          { code: "CONTRACT_VIOLATION" },
        );
      }
      send("run.complete", { result: "COMPLETED" }, runId);
      this.deps.ops?.jobCompleted("COMPLETED");
    } catch (err) {
      if (job.controller.signal.aborted) {
        send("run.complete", { result: "CANCELLED" }, runId);
        this.deps.ops?.jobCompleted("CANCELLED");
        return;
      }
      // Importer errors can embed resolved values — scrub before anything
      // crosses the stream (same rule as the credential-test path).
      const message = maskSecretValues(
        err instanceof Error ? err.message : String(err),
        secrets,
      );
      const errorType =
        err instanceof Error && "code" in err && typeof (err as { code?: unknown }).code === "string"
          ? (err as { code: string }).code
          : "RUNTIME_ERROR";
      send("run.complete", { result: "FAILED", errorType, errorMessage: message }, runId);
      this.deps.ops?.jobCompleted("FAILED");
      log.warn({ runId }, "job failed");
    }
  }
}
