import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { DiscoveredAsset } from "@componode/core";
import { uuidv7 } from "uuidv7";

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
  // Hub-bound docker configs resolve scope.targetId against docker_targets.
  targetProfileSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
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
    await testDb!.db.insertInto("docker_targets").values({
      id: uuidv7(), targetId: `t-${randomSuffix()}`, label: "t",
      description: null, profile: { transport: "socket", path: "/var/run/docker.sock" },
      enabled: true, createdBy: null, updatedBy: null,
    }).onConflict((oc) => oc.column("targetId").doNothing()).execute().catch(() => {});
    const t = await testDb!.db.selectFrom("docker_targets").select("targetId").where("label", "=", "t").executeTakeFirstOrThrow();
    const res = await app.inject({ method: "POST", url: "/api/v1/importer-configs", ...authed({ importerName: "docker", label: "d", scope: { targetId: t.targetId } }) });
    return JSON.parse(res.payload).config;
  }
  let seq = 0;
  const randomSuffix = () => `${Date.now()}-${seq++}`;
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

  it("an unhealthy-instance ERROR status persists and degrades a wired product's health (spec 047, ADR-112)", async () => {
    const asset = workloadAsset("compose:p:web", "docker-engine:D", "cD");
    // What the docker importer now emits for a running + unhealthy container.
    asset.instances = [{
      externalId: "docker-engine:D::cD",
      environment: "PRODUCTION",
      status: "ERROR",
      rawConfig: { dockerObservation: { state: "running", health: { status: "unhealthy", failingStreak: 3 } } },
    }];
    (getImporter as any).mockResolvedValueOnce(dockerImporter([asset], "docker-engine:D"));
    const cfg = await createConfig();
    expect((await runOnce(cfg.id)).status).toBe("COMPLETED");

    const inst = await testDb!.db.selectFrom("component_instances").selectAll().where("externalId", "=", "docker-engine:D::cD").executeTakeFirstOrThrow();
    expect(inst.status).toBe("ERROR");
    expect((inst.rawConfig as any).dockerObservation.health.status).toBe("unhealthy");

    // Human-declared DEPENDS_ON edge → derived product health degrades.
    const productId = uuidv7();
    await testDb!.db.insertInto("digital_products").values({
      id: productId, name: "Storefront", slug: "storefront",
      description: null, type: "BUSINESS_CAPABILITY", lifecycle: "ACTIVE",
      lobOwnerId: null, teamOwnerId: null, sunsetAt: null,
      createdBy: null, updatedBy: null, createdAt: new Date(), updatedAt: new Date(),
    } as never).execute();
    await testDb!.db.insertInto("product_depends_on_component")
      .values({ productId, componentId: inst.componentId }).execute();

    const res = await app.inject({
      method: "GET", url: `/api/v1/products/storefront`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const detail = JSON.parse(res.payload);
    expect(detail.health?.status).toBe("ERROR");
  });

  it("swarm assets persist; partial-replica ERROR degrades a wired product; absent service goes GONE (spec 048)", async () => {
    const svc: DiscoveredAsset = {
      externalId: "docker-engine:E:swarm-service:shop_web", name: "shop_web",
      category: "CONTAINER_ORCHESTRATION", provider: "DOCKER", resourceType: "swarm-service",
      details: { mode: "replicated", stack: "shop" },
      instances: [{
        externalId: "docker-engine:E::swarm-service:svc1", environment: "OTHER", status: "ERROR",
        rawConfig: { swarmObservation: { mode: "replicated", desired: 3, running: 2, observedAt: "2026-11-01T00:00:00Z" } },
      }],
    };
    const node: DiscoveredAsset = {
      externalId: "docker-engine:E:swarm-node:worker-1", name: "worker-1",
      category: "COMPUTE", provider: "DOCKER", resourceType: "swarm-node",
      instances: [{ externalId: "docker-engine:E::swarm-node:n1", environment: "OTHER", status: "RUNNING",
        rawConfig: { swarmNodeObservation: { role: "worker", availability: "active", reachability: null, leader: false, state: "ready", addr: "10.0.0.2" } } }],
    };
    const secret: DiscoveredAsset = {
      externalId: "docker-engine:E:swarm-secret:api-key", name: "api-key",
      category: "SECRET", provider: "DOCKER", resourceType: "swarm-secret",
      details: { secretId: "sec1", revision: 7 }, instances: [],
    };
    (getImporter as any).mockResolvedValueOnce(dockerImporter([svc, node, secret], "docker-engine:E"));
    const cfg = await createConfig();
    expect((await runOnce(cfg.id)).status).toBe("COMPLETED");

    const comps = await testDb!.db.selectFrom("components").selectAll().execute();
    const byCat = Object.fromEntries(comps.map((c) => [c.category, c]));
    expect(byCat.CONTAINER_ORCHESTRATION?.resourceType).toBe("swarm-service");
    expect(byCat.COMPUTE?.resourceType).toBe("swarm-node");
    expect(byCat.SECRET?.resourceType).toBe("swarm-secret");
    const inst = await testDb!.db.selectFrom("component_instances").selectAll()
      .where("externalId", "=", "docker-engine:E::swarm-service:svc1").executeTakeFirstOrThrow();
    expect(inst.status).toBe("ERROR");
    expect((inst.rawConfig as any).swarmObservation).toMatchObject({ desired: 3, running: 2 });

    // Wired product rollup degrades on the service's ERROR (ADR-112).
    const productId = uuidv7();
    await testDb!.db.insertInto("digital_products").values({
      id: productId, name: "Shop", slug: "shop-product",
      description: null, type: "BUSINESS_CAPABILITY", lifecycle: "ACTIVE",
      lobOwnerId: null, teamOwnerId: null, sunsetAt: null,
      createdBy: null, updatedBy: null, createdAt: new Date(), updatedAt: new Date(),
    } as never).execute();
    await testDb!.db.insertInto("product_depends_on_component")
      .values({ productId, componentId: inst.componentId }).execute();
    const res = await app.inject({
      method: "GET", url: `/api/v1/products/shop-product`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(JSON.parse(res.payload).health?.status).toBe("ERROR");

    // Service absent on the next completed run → GONE (source-scoped).
    (getImporter as any).mockResolvedValueOnce(dockerImporter([node, secret], "docker-engine:E"));
    expect((await runOnce(cfg.id)).status).toBe("COMPLETED");
    const inst2 = await testDb!.db.selectFrom("component_instances").select("status")
      .where("externalId", "=", "docker-engine:E::swarm-service:svc1").executeTakeFirstOrThrow();
    expect(inst2.status).toBe("GONE");
  });
});
