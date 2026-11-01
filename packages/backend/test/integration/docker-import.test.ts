import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { DiscoveredAsset } from "@componode/core";

vi.mock("../../src/services/importer-registry.js", async () => {
  const actual = await vi.importActual<any>("../../src/services/importer-registry.js");
  return { ...actual, getImporter: vi.fn(), getManifest: vi.fn(async () => dockerManifest) };
});
import { getImporter } from "../../src/services/importer-registry.js";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME, csrfCookie, csrfHeader } from "../helpers/api.js";

const dockerManifest = {
  name: "docker", label: "Docker", description: "t", version: "1.0.0",
  implPath: "x", reportsSourceIdentity: true, targetRefKey: "targetId",
};

function workloadAsset(extId: string, srcId: string, containerId: string): DiscoveredAsset {
  return {
    externalId: extId, name: extId, category: "CONTAINER", provider: "DOCKER",
    resourceType: "compose-service",
    instances: [{ externalId: `${srcId}::${containerId}`, environment: "OTHER", status: "RUNNING" }],
  };
}

function dockerImporter(yields: DiscoveredAsset[], identity: string, failAfter = -1) {
  return {
    name: "docker", version: "1.0.0",
    async *run(_c: Record<string, unknown>, _s: Record<string, string>, context: any) {
      await context.reportSourceIdentity({ externalIdentity: identity });
      let i = 0;
      for (const a of yields) {
        if (i === failAfter) throw new Error("enumeration failed");
        yield a; i++;
      }
    },
  };
}

describe("docker source-scoped reconciliation (spec 046)", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let savedUrl: string | undefined;

  beforeEach(async () => {
    savedUrl = process.env.DATABASE_URL;
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = "admin";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "admin-password-123";
    vi.resetModules(); vi.clearAllMocks();
    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp(); await app.ready();
    adminSession = await loginAs(app, "admin", "admin-password-123");
  });
  afterEach(async () => {
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
    vi.resetModules();
  });

  const authed = (payload?: unknown) => ({
    cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie }, headers: csrfHeader, payload,
  });

  async function createConfig() {
    const res = await app.inject({ method: "POST", url: "/api/v1/importer-configs", ...authed({ importerName: "docker", label: "d", scope: { targetId: "t" } }) });
    return JSON.parse(res.payload).config;
  }
  async function runOnce(id: string) {
    const res = await app.inject({ method: "POST", url: `/api/v1/importer-configs/${id}/trigger`, ...authed() });
    const { runId } = JSON.parse(res.payload);
    for (let i = 0; i < 100; i++) {
      const r = await app.inject({ method: "GET", url: `/api/v1/importer-configs/${id}/runs/${runId}`, cookies: { [SESSION_COOKIE_NAME]: adminSession } });
      const run = JSON.parse(r.payload).run;
      if (["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(run.status)) return run;
      await new Promise((s) => setTimeout(s, 100));
    }
    throw new Error("run did not terminate");
  }

  it("two sources share one workload component; absent instances retire per-source only", async () => {
    // Source A reports containerA; Source B reports containerB of the same workload.
    (getImporter as any).mockResolvedValueOnce(dockerImporter([workloadAsset("compose:p:web", "docker-engine:A", "cA")], "docker-engine:A"));
    const cfgA = await createConfig();
    expect((await runOnce(cfgA.id)).status).toBe("COMPLETED");

    (getImporter as any).mockResolvedValueOnce(dockerImporter([workloadAsset("compose:p:web", "docker-engine:B", "cB")], "docker-engine:B"));
    const cfgB = await createConfig();
    expect((await runOnce(cfgB.id)).status).toBe("COMPLETED");

    const comps = await testDb!.db.selectFrom("components").selectAll().where("externalId", "=", "compose:p:web").execute();
    expect(comps).toHaveLength(1);
    const insts = await testDb!.db.selectFrom("component_instances").selectAll().where("componentId", "=", comps[0].id).execute();
    expect(insts).toHaveLength(2);

    // Source A's next run sees a rebuilt container — cA goes GONE, cB untouched.
    (getImporter as any).mockResolvedValueOnce(dockerImporter([workloadAsset("compose:p:web", "docker-engine:A", "cA2")], "docker-engine:A"));
    expect((await runOnce(cfgA.id)).status).toBe("COMPLETED");
    const insts2 = await testDb!.db.selectFrom("component_instances").selectAll().where("componentId", "=", comps[0].id).execute();
    const byExt = Object.fromEntries(insts2.map((i) => [i.externalId, i.status]));
    expect(byExt["docker-engine:A::cA"]).toBe("GONE");
    expect(byExt["docker-engine:B::cB"]).toBe("RUNNING");
    const comp = await testDb!.db.selectFrom("components").select("lifecycle").where("id", "=", comps[0].id).executeTakeFirstOrThrow();
    expect(comp.lifecycle).toBe("ACTIVE");
  });

  it("config delete leaves the Source UNMONITORED; a failed enumeration retires nothing", async () => {
    (getImporter as any).mockResolvedValueOnce(dockerImporter([workloadAsset("compose:p:api", "docker-engine:C", "cC")], "docker-engine:C"));
    const cfg = await createConfig();
    expect((await runOnce(cfg.id)).status).toBe("COMPLETED");

    // Failing enumeration mid-run → FAILED; instance stays RUNNING.
    (getImporter as any).mockResolvedValueOnce(dockerImporter([workloadAsset("compose:p:api", "docker-engine:C", "cC")], "docker-engine:C", 0));
    expect((await runOnce(cfg.id)).status).toBe("FAILED");
    const inst = await testDb!.db.selectFrom("component_instances").selectAll().where("externalId", "=", "docker-engine:C::cC").executeTakeFirstOrThrow();
    expect(inst.status).toBe("RUNNING");

    await app.inject({ method: "DELETE", url: `/api/v1/importer-configs/${cfg.id}`, ...authed() });
    const src = await testDb!.db.selectFrom("importer_sources").selectAll().where("externalIdentity", "=", "docker-engine:C").executeTakeFirstOrThrow();
    expect(src.status).toBe("UNMONITORED");
    expect(src.boundConfigId).toBeNull();
  });
});
