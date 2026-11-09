import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DiscoveredAsset } from "@componode/core";
import { uuidv7 } from "uuidv7";

vi.mock("../../src/services/importer-registry.js", async () => {
  return {
    getImporter: vi.fn(),
    getManifest: vi.fn(),
    getManifests: vi.fn(async () => []),
    getConfigSchema: vi.fn(),
  };
});

// Hub docker runs must resolve a managed target before dispatch (spec 063);
// these tests exercise grouping, not target resolution.
vi.mock("../../src/services/docker-target-service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/docker-target-service.js")>();
  return {
    ...actual,
    resolveHubTargetProfile: vi.fn(async () => ({ profile: {} })),
  };
});

import { getImporter, getManifest } from "../../src/services/importer-registry.js";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME, csrfCookie, csrfHeader } from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin-password-123";

// Spec 067: the mocked importer adopts source identity AND the auto-group
// capability — importerName "docker" selects the docker strategy. No
// configSchema (scope validation skipped) and no targetRefKey (no target
// resolution) so configs can be inserted directly.
const autoGroupManifest = {
  name: "docker",
  label: "Docker",
  description: "test",
  version: "1.0.0",
  implPath: "x",
  reportsSourceIdentity: true,
  autoGroups: "source" as const,
};

function asset(externalId: string, resourceType = "container"): DiscoveredAsset {
  return {
    externalId,
    name: externalId,
    slug: externalId,
    category: "CONTAINER",
    provider: "DOCKER",
    resourceType,
    instances: [
      { externalId: `${externalId}-inst`, environment: "PRODUCTION", status: "RUNNING" },
    ],
  };
}

function sourceImporter(
  yields: DiscoveredAsset[],
  identity: string,
  label?: string,
) {
  return {
    name: "docker",
    version: "1.0.0",
    async *run(
      _c: Record<string, unknown>,
      _s: Record<string, string>,
      context: import("@componode/core").ImporterContext,
    ) {
      await context.reportSourceIdentity({ externalIdentity: identity, label });
      for (const a of yields) yield a;
    },
  };
}

describe("source-scoped auto ComponentGroups (spec 067)", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let originalDbUrl: string | undefined;

  beforeEach(async () => {
    originalDbUrl = process.env.DATABASE_URL;
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.DEBUG_ERROR_DETAILS = "true";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    vi.resetModules();
    vi.clearAllMocks();
    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
    (getManifest as any).mockResolvedValue(autoGroupManifest);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    vi.resetModules();
  });

  // Direct insert — importerName "docker" would otherwise require a managed
  // target (assertHubDockerConfig) which this spec does not exercise.
  async function createConfig(scope: Record<string, unknown> = {}): Promise<string> {
    const { db } = await import("../../src/db/connection.js");
    const id = uuidv7();
    const now = new Date().toISOString();
    await db
      .insertInto("importer_configs")
      .values({
        id,
        importerName: "docker",
        label: `cfg-${id.slice(0, 8)}`,
        scope: { targetId: "00000000-0000-7000-8000-000000000000", ...scope },
        // jsonb column — the service stores stringified JSON (importer-
        // config-service.ts); a raw JS array binds as a pg array literal.
        secretRefs: JSON.stringify([]) as unknown as Array<{ key: string }>,
        agentId: null,
        schedule: null,
        enabled: true,
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    return id;
  }

  async function runOnce(configId: string) {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${configId}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    if (res.statusCode !== 202) {
      throw new Error(`trigger failed ${res.statusCode}: ${res.payload}`);
    }
    const { runId } = JSON.parse(res.payload);
    for (let i = 0; i < 100; i++) {
      const r = await app.inject({
        method: "GET",
        url: `/api/v1/importer-configs/${configId}/runs/${runId}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      const body = JSON.parse(r.payload);
      if (["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(body.run.status)) {
        if (body.run.status !== "COMPLETED") {
          throw new Error(
            `run ${runId} ended ${body.run.status}: ${body.run.errorMessage ?? ""}\n${body.run.errorStack ?? ""}`,
          );
        }
        return body.run;
      }
      await new Promise((r2) => setTimeout(r2, 100));
    }
    throw new Error("run did not terminate");
  }

  async function db() {
    return (await import("../../src/db/connection.js")).db;
  }

  async function sourceByIdentity(externalIdentity: string) {
    return (await db())
      .selectFrom("importer_sources")
      .selectAll()
      .where("externalIdentity", "=", externalIdentity)
      .executeTakeFirstOrThrow();
  }

  async function componentByExternalId(externalId: string) {
    return (await db())
      .selectFrom("components")
      .selectAll()
      .where("externalId", "=", externalId)
      .executeTakeFirstOrThrow();
  }

  async function groupById(id: string) {
    return (await db())
      .selectFrom("component_groups")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  }

  async function autoGroups() {
    const rows = await (await db())
      .selectFrom("component_groups")
      .selectAll()
      .where("slug", "like", "docker-cluster-%")
      .execute();
    return rows;
  }

  it("creates one auto-group per source with sole-reporter membership", async () => {
    (getImporter as any).mockResolvedValue(
      sourceImporter([asset("eng-a", "docker-engine"), asset("c1"), asset("c2")], "src-A", "Engine A"),
    );
    const configA = await createConfig();
    await runOnce(configA);

    const groups = await autoGroups();
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group.name).toBe("Engine A");
    expect(group.slug).toMatch(/^docker-cluster-[0-9a-f]{12}$/);
    expect(group.teamOwnerId).toBeNull();
    expect(group.description).toContain("src-A");

    const source = await sourceByIdentity("src-A");
    expect(source.componentGroupId).toBe(group.id);

    for (const ext of ["eng-a", "c1", "c2"]) {
      const comp = await componentByExternalId(ext);
      expect(comp.componentGroupId).toBe(group.id);
    }
    expect(group.lifecycle).toBe("ACTIVE");

    // Discoverable through the normal groups API.
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/component-groups",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const slugs = JSON.parse(list.payload).data.map((g: any) => g.slug);
    expect(slugs).toContain(group.slug);

    const members = await app.inject({
      method: "GET",
      url: `/api/v1/components?group=${group.slug}&pageSize=100`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const memberNames = JSON.parse(members.payload).data.map((c: any) => c.name);
    expect(memberNames.sort()).toEqual(["c1", "c2", "eng-a"]);
  });

  it("shared components join no auto-group; exclusive ones do", async () => {
    // Source A and B both report "shared"; each also reports an exclusive.
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("shared"), asset("only-a")], "src-A"),
    );
    const configA = await createConfig();
    await runOnce(configA);

    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("shared"), asset("only-b")], "src-B"),
    );
    const configB = await createConfig();
    await runOnce(configB);

    const shared = await componentByExternalId("shared");
    expect(shared.componentGroupId).toBeNull();

    const onlyA = await componentByExternalId("only-a");
    const onlyB = await componentByExternalId("only-b");
    expect(onlyA.componentGroupId).not.toBeNull();
    expect(onlyB.componentGroupId).not.toBeNull();
    expect(onlyA.componentGroupId).not.toBe(onlyB.componentGroupId);

    const groups = await autoGroups();
    expect(groups).toHaveLength(2);
  });

  it("evicts on exclusivity loss and reassigns when sole reporter returns", async () => {
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("moving")], "src-A"),
    );
    const configA = await createConfig();
    await runOnce(configA);

    let comp = await componentByExternalId("moving");
    const groupA = comp.componentGroupId;
    expect(groupA).not.toBeNull();

    // Source B starts reporting it too → two effective reporters → evicted.
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("moving")], "src-B"),
    );
    const configB = await createConfig();
    await runOnce(configB);

    comp = await componentByExternalId("moving");
    expect(comp.componentGroupId).toBeNull();

    // Source A stops reporting it → B is sole reporter → joins B's group.
    (getImporter as any).mockResolvedValueOnce(sourceImporter([], "src-A"));
    await runOnce(configA);

    comp = await componentByExternalId("moving");
    expect(comp.componentGroupId).not.toBeNull();
    expect(comp.componentGroupId).not.toBe(groupA);
    const groupB = await groupById(comp.componentGroupId!);
    expect(groupB.slug).toMatch(/^docker-cluster-/);
  });

  it("never touches manual components or components in human-managed groups", async () => {
    // Manual component — no source memberships at all.
    const manual = await app.inject({
      method: "POST",
      url: "/api/v1/components",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        name: "manual-comp",
        slug: "manual-comp",
        category: "CONTAINER",
        provider: "DOCKER",
        resourceType: "container",
      },
    });
    expect(manual.statusCode).toBe(201);
    const manualId = JSON.parse(manual.payload).component.id;

    // Human-managed group.
    const humanGroup = await app.inject({
      method: "POST",
      url: "/api/v1/component-groups",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name: "Human Group", slug: "human-group" },
    });
    expect(humanGroup.statusCode).toBe(201);
    const humanGroupId = JSON.parse(humanGroup.payload).group.id;

    // The importer reports "foreign-ext" — first pass assigns it to the
    // auto-group; a human then moves it into their own group.
    (getImporter as any).mockResolvedValue(
      sourceImporter([asset("foreign-ext"), asset("solo")], "src-A"),
    );
    const configA = await createConfig();
    await runOnce(configA);

    const foreignComp = await componentByExternalId("foreign-ext");
    const autoGroupId = foreignComp.componentGroupId;
    expect(autoGroupId).not.toBeNull();

    const move = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${foreignComp.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { componentGroupId: humanGroupId },
    });
    expect(move.statusCode).toBe(200);

    // Second run re-evaluates: sole-reported but parked in a foreign group —
    // null-or-ours means the pass must not reclaim it.
    await runOnce(configA);

    const manualComp = await (await db())
      .selectFrom("components")
      .selectAll()
      .where("id", "=", manualId)
      .executeTakeFirstOrThrow();
    expect(manualComp.componentGroupId).toBeNull();

    const foreignAfter = await componentByExternalId("foreign-ext");
    expect(foreignAfter.componentGroupId).toBe(humanGroupId);

    // The auto-group still exists and holds only the eligible component.
    const groups = await autoGroups();
    expect(groups).toHaveLength(1);
    const solo = await componentByExternalId("solo");
    expect(solo.componentGroupId).toBe(groups[0].id);
    const members = await (await db())
      .selectFrom("components")
      .select("id")
      .where("componentGroupId", "=", groups[0].id)
      .execute();
    expect(members.map((m) => m.id)).toEqual([solo.id]);
    expect(autoGroupId).toBe(groups[0].id);
  });

  it("derives lifecycle and rejects human lifecycle writes and deletes", async () => {
    (getImporter as any).mockResolvedValue(
      sourceImporter([asset("c1"), asset("c2")], "src-A", "Cluster A"),
    );
    const configA = await createConfig();
    await runOnce(configA);

    const groups = await autoGroups();
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group.lifecycle).toBe("ACTIVE");

    // Lifecycle PATCH → controlled conflict.
    const lifecyclePatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/component-groups/${group.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { lifecycle: "RETIRED" },
    });
    expect(lifecyclePatch.statusCode).toBe(409);
    expect(JSON.parse(lifecyclePatch.payload).code).toBe("GROUP_AUTO_MANAGED");

    // Name/description edits stay allowed.
    const rename = await app.inject({
      method: "PATCH",
      url: `/api/v1/component-groups/${group.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { name: "Renamed Cluster", description: "human note" },
    });
    expect(rename.statusCode).toBe(200);
    expect((await groupById(group.id)).name).toBe("Renamed Cluster");

    // DELETE → controlled conflict.
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/component-groups/${group.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(del.statusCode).toBe(409);
    expect(JSON.parse(del.payload).code).toBe("GROUP_AUTO_MANAGED");
    expect(await groupById(group.id)).toBeDefined();
  });

  it("retires members and flips lifecycle when the source retires; reactivation restores", async () => {
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("c1"), asset("c2")], "src-A"),
    );
    const configA = await createConfig();
    await runOnce(configA);

    const group = (await autoGroups())[0];
    expect(group.lifecycle).toBe("ACTIVE");
    const source = await sourceByIdentity("src-A");

    // Retire the source — components orphan-retire, members evict, group
    // lifecycle derives RETIRED without waiting for another import.
    const retire = await app.inject({
      method: "POST",
      url: `/api/v1/importer-sources/${source.id}/retire`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(retire.statusCode).toBe(200);

    const afterRetire = await groupById(group.id);
    expect(afterRetire.lifecycle).toBe("RETIRED");
    for (const ext of ["c1", "c2"]) {
      const comp = await componentByExternalId(ext);
      expect(comp.componentGroupId).toBeNull();
      expect(comp.lifecycle).toBe("RETIRED");
    }

    // Derived lifecycle flips are audited like human lifecycle writes:
    // first pass RETIRED→ACTIVE on provisioning, retire pass ACTIVE→RETIRED.
    const auditRows = await (await db())
      .selectFrom("entity_changes")
      .select(["action", "changes"])
      .where("entityType", "=", "component_group")
      .where("entityId", "=", group.id)
      .orderBy("createdAt", "asc")
      .execute();
    expect(auditRows[0]?.action).toBe("created");
    const flips = auditRows.filter((r) => r.action === "lifecycle");
    expect(
      flips.map((f) => (f.changes as { lifecycle?: string } | null)?.lifecycle),
    ).toEqual(["ACTIVE", "RETIRED"]);

    // Reactivate — memberships count again; components rejoin the group
    // (still RETIRED lifecycle, so the group stays honestly RETIRED).
    const reactivate = await app.inject({
      method: "POST",
      url: `/api/v1/importer-sources/${source.id}/reactivate`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(reactivate.statusCode).toBe(200);

    for (const ext of ["c1", "c2"]) {
      const comp = await componentByExternalId(ext);
      expect(comp.componentGroupId).toBe(group.id);
    }
    expect((await groupById(group.id)).lifecycle).toBe("RETIRED");
  });

  it("autoGroup:false freezes the source's group — no create, no teardown", async () => {
    // Enabled first: group + members exist.
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("c1")], "src-A"),
    );
    const configA = await createConfig();
    await runOnce(configA);
    const group = (await autoGroups())[0];
    expect(group).toBeDefined();

    // Opt the bound config out and run again — group and membership frozen.
    const { db } = await import("../../src/db/connection.js");
    await db
      .updateTable("importer_configs")
      .set({ scope: { targetId: "00000000-0000-7000-8000-000000000000", autoGroup: false } })
      .where("id", "=", configA)
      .execute();
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([], "src-A"), // empty inventory would evict if evaluated
    );
    await runOnce(configA);

    expect(await autoGroups()).toHaveLength(1);
    const comp = await componentByExternalId("c1");
    expect(comp.componentGroupId).toBe(group.id);
    expect((await groupById(group.id)).lifecycle).toBe("ACTIVE");

    // A fresh opted-out source never gains a group.
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("c9")], "src-B"),
    );
    const configB = await createConfig({ autoGroup: false });
    await runOnce(configB);
    expect(await autoGroups()).toHaveLength(1);
    const c9 = await componentByExternalId("c9");
    expect(c9.componentGroupId).toBeNull();
  });

  it("evicts a human-placed ineligible component parked inside the auto-group", async () => {
    (getImporter as any).mockResolvedValue(
      sourceImporter([asset("c1")], "src-A"),
    );
    const configA = await createConfig();
    await runOnce(configA);
    const group = (await autoGroups())[0];

    // A manual component has no source memberships — a human parks it inside
    // the auto-group; the next pass evicts it (membership is derived).
    const manual = await app.inject({
      method: "POST",
      url: "/api/v1/components",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        name: "parked",
        slug: "parked",
        category: "CONTAINER",
        provider: "DOCKER",
        resourceType: "container",
      },
    });
    const parkedId = JSON.parse(manual.payload).component.id;
    const park = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${parkedId}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { componentGroupId: group.id },
    });
    expect(park.statusCode).toBe(200);

    await runOnce(configA);
    const parked = await (await db())
      .selectFrom("components")
      .selectAll()
      .where("id", "=", parkedId)
      .executeTakeFirstOrThrow();
    expect(parked.componentGroupId).toBeNull();
    // The eligible member is untouched.
    expect((await componentByExternalId("c1")).componentGroupId).toBe(group.id);
  });

  it("names the group from the engine component when the source has no label", async () => {
    const engine = { ...asset("engine-x", "docker-engine"), name: "Engine X" };
    (getImporter as any).mockResolvedValue(
      sourceImporter([engine, asset("c1")], "src-A"), // no label arg
    );
    const configA = await createConfig();
    await runOnce(configA);

    const group = (await autoGroups())[0];
    expect(group.name).toBe("Engine X");
    expect(group.description).toContain("src-A");
    expect(group.teamOwnerId).toBeNull();
  });

  it("freezes an unbound (UNMONITORED) source's group until a config rebinds", async () => {
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("c1")], "src-A"),
    );
    const configA = await createConfig();
    await runOnce(configA);
    const group = (await autoGroups())[0];
    const source = await sourceByIdentity("src-A");
    expect(source.status).toBe("ACTIVE");

    // Simulate config deletion: source goes UNMONITORED + unbound.
    const { db } = await import("../../src/db/connection.js");
    await db
      .updateTable("importer_configs")
      .set({ enabled: false })
      .where("id", "=", configA)
      .execute();
    await db
      .updateTable("importer_sources")
      .set({ status: "UNMONITORED", boundConfigId: null })
      .where("id", "=", source.id)
      .execute();

    // A pass triggered by another source must leave the unbound group frozen.
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("other")], "src-B"),
    );
    const configB = await createConfig();
    await runOnce(configB);

    expect((await componentByExternalId("c1")).componentGroupId).toBe(group.id);
    expect((await groupById(group.id)).lifecycle).toBe("ACTIVE");
    // src-B got its own group — two auto-groups now exist.
    expect(await autoGroups()).toHaveLength(2);
  });

  it("hands the group between sequentially bound configs without teardown", async () => {
    // Two configs reporting the same source identity rebind the source on
    // every run — the bound config's autoGroup flag decides each time.
    (getImporter as any).mockResolvedValue(
      sourceImporter([asset("c1"), asset("c2")], "src-A"),
    );
    const configA = await createConfig();
    const configB = await createConfig({ autoGroup: false });

    await runOnce(configA);
    const group = (await autoGroups())[0];
    expect(group).toBeDefined();

    // Disabled config binds → its run freezes the group as-is.
    await runOnce(configB);
    expect((await autoGroups())[0].id).toBe(group.id);
    expect((await componentByExternalId("c1")).componentGroupId).toBe(group.id);

    // Enabled config binds again → maintenance resumes on the SAME group.
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("c1")], "src-A"), // c2 dropped → evicted
    );
    await runOnce(configA);
    expect((await autoGroups())[0].id).toBe(group.id);
    expect((await componentByExternalId("c1")).componentGroupId).toBe(group.id);
    expect((await componentByExternalId("c2")).componentGroupId).toBeNull();
  });
});
