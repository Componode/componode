import { describe, it, expect, vi } from "vitest";
import type { DiscoveredAsset, Importer, ImporterRegistry } from "@componode/core";
import { JobExecutor } from "../src/executor.js";
import type { AgentLog } from "../src/secrets.js";

// Agent-side job execution (spec 027 US2/US3/US4): assign → ack → run the
// importer generator → bounded asset.batch frames → run.complete. The fake
// importer yields in-memory assets; the send spy captures wire frames.
describe("JobExecutor", () => {
  const runId = "018c5e60-0000-7000-8000-0000000000aa";

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

  function makeRegistry(importer?: Partial<Importer>): ImporterRegistry {
    return {
      getManifests: vi.fn(async () => []),
      getManifest: vi.fn(),
      getConfigSchema: vi.fn(),
      getImporter: vi.fn(async (name: string) => {
        if (!importer) throw new Error(`Importer ${name} not found`);
        return importer as Importer;
      }),
    } as unknown as ImporterRegistry;
  }

  function captureSend() {
    const frames: Array<{ type: string; payload: any; runId?: string }> = [];
    return {
      frames,
      send: (type: string, payload: unknown, runId?: string) =>
        frames.push({ type, payload, runId }),
      ofType: (t: string) => frames.filter((f) => f.type === t),
    };
  }

  function asset(i: number, size = 0): DiscoveredAsset {
    return {
      name: `asset-${i}`,
      category: "SOFTWARE",
      provider: "test",
      resourceType: "thing",
      externalId: `ext-${i}`,
      instances: [],
      ...(size > 0 ? { details: { blob: "x".repeat(size) } } : {}),
    } as DiscoveredAsset;
  }

  function* gen(assets: DiscoveredAsset[]) {
    for (const a of assets) yield a;
  }

  async function waitFor(
    pred: () => boolean,
    timeoutMs = 2000,
  ): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  function makeExecutor(
    importer: Partial<Importer> | undefined,
    maxJobs = 1,
    log?: AgentLog,
  ) {
    const tx = captureSend();
    const exec = new JobExecutor({
      registry: makeRegistry(importer),
      maxJobs,
      log: log ?? makeLog().log,
      send: tx.send,
    });
    return { exec, tx };
  }

  it("acks, streams batches at the 100-asset boundary, and completes", async () => {
    const assets = Array.from({ length: 250 }, (_, i) => asset(i));
    const { exec, tx } = makeExecutor({
      name: "web-url",
      run: () => gen(assets) as unknown as AsyncGenerator<DiscoveredAsset>,
    });

    await exec.handleJobAssign(runId, { importerName: "web-url", scope: {} });
    await waitFor(() => tx.ofType("run.complete").length === 1);

    const ack = tx.ofType("job.ack")[0];
    expect(ack.runId).toBe(runId);
    expect(ack.payload).toEqual({ accepted: true });

    const batches = tx.ofType("asset.batch");
    expect(batches.map((b) => b.payload.assets.length)).toEqual([100, 100, 50]);
    expect(batches[0].runId).toBe(runId);

    expect(tx.ofType("run.complete")[0].payload).toEqual({ result: "COMPLETED" });
    expect(exec.currentJobs()).toBe(0);
  });

  it("forwards reportPhase as phase frames", async () => {
    const { exec, tx } = makeExecutor({
      name: "web-url",
      run: async function* (_c, _s, ctx) {
        await ctx.reportPhase("Fetching");
        yield asset(1);
      } as unknown as Importer["run"],
    });
    await exec.handleJobAssign(runId, { importerName: "web-url" });
    await waitFor(() => tx.ofType("run.complete").length === 1);
    expect(tx.ofType("phase")).toHaveLength(1);
    expect(tx.ofType("phase")[0].payload).toEqual({ name: "Fetching" });
  });

  it("NACKs when at capacity", async () => {
    // A job that never finishes keeps the slot occupied.
    const blocker = new Promise<DiscoveredAsset>(() => {});
    const { exec, tx } = makeExecutor(
      {
        name: "web-url",
        run: async function* () {
          await blocker;
        } as unknown as Importer["run"],
      },
      1,
    );
    void exec.handleJobAssign(runId, { importerName: "web-url" });
    await waitFor(() => exec.currentJobs() === 1);
    await exec.handleJobAssign("run-2", { importerName: "web-url" });
    const nack = tx.ofType("job.ack").find((a) => a.runId === "run-2")!;
    expect(nack.payload.accepted).toBe(false);
    // Capacity is transient — the hub classifies it AGENT_UNAVAILABLE.
    expect(nack.payload.reason).toContain("AGENT_UNAVAILABLE");
    expect(nack.payload.reason).toContain("capacity");
  });

  it("NACKs AGENT_INCOMPATIBLE for an uncompiled importer", async () => {
    const { exec, tx } = makeExecutor(undefined);
    await exec.handleJobAssign(runId, { importerName: "missing" });
    const ack = tx.ofType("job.ack")[0];
    expect(ack.payload.accepted).toBe(false);
    expect(ack.payload.reason).toContain("AGENT_INCOMPATIBLE");
  });

  it("NACKs SECRET_RESOLUTION_FAILED naming key + source, never a value", async () => {
    const { exec, tx } = makeExecutor({ name: "web-url" });
    await exec.handleJobAssign(runId, {
      importerName: "web-url",
      secretRefMap: { token: { env: "DEFINITELY_MISSING_ENV_VAR_027" } },
    });
    const ack = tx.ofType("job.ack")[0];
    expect(ack.payload.accepted).toBe(false);
    expect(ack.payload.reason).toMatch(/^SECRET_RESOLUTION_FAILED:/);
    expect(ack.payload.reason).toContain("token");
    // The job never started.
    expect(exec.currentJobs()).toBe(0);
  });

  it("reports ASSET_TOO_LARGE for an oversized asset and continues", async () => {
    const big = asset(1, 1_100_000);
    const { exec, tx } = makeExecutor({
      name: "web-url",
      run: () => gen([big, asset(2)]) as unknown as AsyncGenerator<DiscoveredAsset>,
    });
    await exec.handleJobAssign(runId, { importerName: "web-url" });
    await waitFor(() => tx.ofType("run.complete").length === 1);

    const errs = tx.ofType("run.error");
    expect(errs).toHaveLength(1);
    expect(errs[0].payload.errorType).toBe("ASSET_TOO_LARGE");
    expect(errs[0].payload.assetExternalId).toBe("ext-1");
    // The second asset still streamed; the run completed.
    expect(tx.ofType("asset.batch")[0].payload.assets).toHaveLength(1);
    expect(tx.ofType("run.complete")[0].payload.result).toBe("COMPLETED");
  });

  it("sends run.complete FAILED with masked values on generator throw", async () => {
    process.env.AGENT027_SECRET = "supersecretvalue";
    try {
      const { exec, tx } = makeExecutor(
        {
          name: "web-url",
          run: async function* () {
            throw new Error("boom supersecretvalue boom");
          } as unknown as Importer["run"],
        },
      );
      await exec.handleJobAssign(runId, {
        importerName: "web-url",
        secretRefMap: { token: { env: "AGENT027_SECRET" } },
      });
      await waitFor(() => tx.ofType("run.complete").length === 1);
      const done = tx.ofType("run.complete")[0];
      expect(done.payload.result).toBe("FAILED");
      expect(done.payload.errorType).toBe("RUNTIME_ERROR");
      expect(done.payload.errorMessage).not.toContain("supersecretvalue");
    } finally {
      delete process.env.AGENT027_SECRET;
    }
  });

  it("aborts on cancel and reports CANCELLED", async () => {
    const { exec, tx } = makeExecutor({
      name: "web-url",
      run: async function* (_c, _s, ctx) {
        yield asset(1);
        // Spin until the hub's cancel arrives.
        while (!ctx.signal.aborted) {
          await new Promise((r) => setTimeout(r, 5));
        }
      } as unknown as Importer["run"],
    });
    void exec.handleJobAssign(runId, { importerName: "web-url" });
    // The single asset sits unflushed until the generator ends — wait for
    // the job to be live, then cancel.
    await waitFor(() => exec.currentJobs() === 1);
    exec.handleCancel(runId);
    await waitFor(() => tx.ofType("run.complete").length === 1);
    expect(tx.ofType("run.complete")[0].payload).toEqual({ result: "CANCELLED" });
    expect(exec.currentJobs()).toBe(0);
  });

  it("honors a cancel arriving during pre-ack importer resolution", async () => {
    // The job slot is registered before getImporter resolves, so a cancel
    // in that window aborts instead of being dropped.
    let resolveImporter!: (i: Importer) => void;
    const registry: ImporterRegistry = {
      getManifests: vi.fn(async () => []),
      getManifest: vi.fn(),
      getImporter: vi.fn(
        () => new Promise<Importer>((r) => (resolveImporter = r)),
      ),
    };
    const tx = captureSend();
    const exec = new JobExecutor({
      registry,
      maxJobs: 1,
      log: makeLog().log,
      send: tx.send,
    });

    void exec.handleJobAssign(runId, { importerName: "web-url" });
    await waitFor(() => exec.currentJobs() === 1);
    exec.handleCancel(runId);
    resolveImporter({
      name: "web-url",
      run: () => gen([asset(1)]) as unknown as AsyncGenerator<DiscoveredAsset>,
    } as Importer);

    await waitFor(() => tx.ofType("run.complete").length === 1);
    expect(tx.ofType("job.ack")[0].payload).toEqual({ accepted: true });
    expect(tx.ofType("run.complete")[0].payload).toEqual({ result: "CANCELLED" });
    expect(exec.currentJobs()).toBe(0);
  });
});

describe("JobExecutor — ImporterSource core (spec 044)", () => {
  const runId = "018c5e60-0000-7000-8000-0000000000bb";

  function makeLog() {
    return {
      debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    } as unknown as AgentLog;
  }

  function captureSend() {
    const frames: Array<{ type: string; payload: any; runId?: string }> = [];
    return {
      frames,
      send: (type: string, payload: unknown, runId?: string) =>
        frames.push({ type, payload, runId }),
      ofType: (t: string) => frames.filter((f) => f.type === t),
    };
  }

  function makeExec(
    importer: Partial<Importer>,
    manifest: Record<string, unknown> = {},
    secretsDir?: string,
  ) {
    const tx = captureSend();
    const registry = {
      getManifests: vi.fn(async () => []),
      getManifest: vi.fn(async () => manifest),
      getConfigSchema: vi.fn(),
      getImporter: vi.fn(async () => importer as Importer),
    } as unknown as ImporterRegistry;
    const exec = new JobExecutor({
      registry,
      maxJobs: 1,
      log: makeLog(),
      send: tx.send,
      secretsDir,
    });
    return { exec, tx };
  }

  async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  const baseAsset = {
    name: "a", category: "SOFTWARE", provider: "test",
    resourceType: "t", externalId: "e1", instances: [],
  } as DiscoveredAsset;

  it("emits source.identity before asset.batch when manifest opts in", async () => {
    const { exec, tx } = makeExec(
      {
        name: "web-url",
        run: async function* (_c, _s, ctx: any) {
          await ctx.reportSourceIdentity({ externalIdentity: "engine:1" });
          yield baseAsset;
        } as unknown as Importer["run"],
      },
      { reportsSourceIdentity: true },
    );
    await exec.handleJobAssign(runId, { importerName: "web-url", scope: {} });
    await waitFor(() => tx.ofType("run.complete").length === 1);
    const idx = tx.frames.findIndex((f) => f.type === "source.identity");
    const batch = tx.frames.findIndex((f) => f.type === "asset.batch");
    expect(idx).toBeGreaterThan(-1);
    expect(batch).toBeGreaterThan(idx);
    expect(tx.ofType("run.complete")[0].payload.result).toBe("COMPLETED");
  });

  it("fails CONTRACT_VIOLATION when an adopting importer yields first", async () => {
    const { exec, tx } = makeExec(
      {
        name: "web-url",
        run: async function* () {
          yield baseAsset;
        } as unknown as Importer["run"],
      },
      { reportsSourceIdentity: true },
    );
    await exec.handleJobAssign(runId, { importerName: "web-url", scope: {} });
    await waitFor(() => tx.ofType("run.complete").length === 1);
    expect(tx.ofType("asset.batch")).toHaveLength(0);
    expect(tx.ofType("run.complete")[0].payload).toMatchObject({
      result: "FAILED",
      errorType: "CONTRACT_VIOLATION",
    });
  });

  it("unflagged manifests emit no source.identity frame", async () => {
    const { exec, tx } = makeExec(
      {
        name: "web-url",
        run: async function* () {
          yield baseAsset;
        } as unknown as Importer["run"],
      },
      {},
    );
    await exec.handleJobAssign(runId, { importerName: "web-url", scope: {} });
    await waitFor(() => tx.ofType("run.complete").length === 1);
    expect(tx.ofType("source.identity")).toHaveLength(0);
    expect(tx.ofType("run.complete")[0].payload.result).toBe("COMPLETED");
  });

  it("NACKs TARGET_RESOLUTION_FAILED when scope lacks the declared key", async () => {
    const { exec, tx } = makeExec(
      { name: "docker", run: async function* () {} as never },
      { targetRefKey: "target" },
    );
    await exec.handleJobAssign(runId, { importerName: "docker", scope: {} });
    const nack = tx.ofType("job.ack")[0];
    expect(nack.payload.accepted).toBe(false);
    expect(nack.payload.reason).toMatch(/^TARGET_RESOLUTION_FAILED/);
  });

  it("NACKs TARGET_RESOLUTION_FAILED when registry file is missing", async () => {
    const { exec, tx } = makeExec(
      { name: "docker", run: async function* () {} as never },
      { targetRefKey: "target" },
      "/nonexistent-secrets-dir",
    );
    await exec.handleJobAssign(runId, {
      importerName: "docker",
      scope: { target: "t1" },
    });
    const nack = tx.ofType("job.ack")[0];
    expect(nack.payload.accepted).toBe(false);
    expect(nack.payload.reason).toMatch(/^TARGET_RESOLUTION_FAILED/);
  });

  it("resolves the profile and exposes it via resolveTarget", async () => {
    const fsp = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "target-reg-"));
    await fsp.writeFile(
        `${dir}/docker-targets.json`,
        JSON.stringify({
          version: 1,
          targets: { t1: { transport: "tcp", host: "h", port: 2376 } },
        }),
    );
    let resolved: unknown;
    const { exec, tx } = makeExec(
      {
        name: "docker",
        run: async function* (_c, _s, ctx: any) {
          resolved = ctx.resolveTarget("t1");
          yield baseAsset;
        } as unknown as Importer["run"],
      },
      { targetRefKey: "target" },
      dir,
    );
    await exec.handleJobAssign(runId, {
      importerName: "docker",
      scope: { target: "t1" },
    });
    await waitFor(() => tx.ofType("run.complete").length === 1);
    expect(tx.ofType("job.ack")[0].payload.accepted).toBe(true);
    expect(resolved).toMatchObject({ transport: "tcp", host: "h" });
  });
});
