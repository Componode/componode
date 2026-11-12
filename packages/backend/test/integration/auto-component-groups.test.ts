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
  // Spec 070: app-level grouping is manifest-declared; the docker strategy
  // supplies the compose-project/swarm-stack kinds. Assets without
  // boundary details still produce no app groups.
  autoAppGroups: true,
};

function asset(
  externalId: string,
  resourceType = "container",
  details: Record<string, unknown> | null = null,
): DiscoveredAsset {
  return {
    externalId,
    name: externalId,
    slug: externalId,
    category: "CONTAINER",
    provider: "DOCKER",
    resourceType,
    details,
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

  // Spec 070: membership lives in component_group_members — a component can
  // hold several groups; assertions check the SET, not a single column.
  async function groupIdsOf(componentId: string) {
    const rows = await (await db())
      .selectFrom("component_group_members")
      .select("groupId")
      .where("componentId", "=", componentId)
      .execute();
    return rows.map((r) => r.groupId);
  }

  async function autoGroups() {
    const rows = await (await db())
      .selectFrom("component_groups")
      .selectAll()
      .where("slug", "like", "docker-cluster-%")
      .execute();
    return rows;
  }

  // Spec 070: app groups carry a non-null autoGroupKey.
  async function appGroups() {
    const rows = await (await db())
      .selectFrom("component_groups")
      .selectAll()
      .where("autoGroupKey", "is not", null)
      .execute();
    return rows;
  }

  async function membersOfGroup(groupId: string) {
    const rows = await (await db())
      .selectFrom("component_group_members")
      .select("componentId")
      .where("groupId", "=", groupId)
      .execute();
    return rows.map((r) => r.componentId).sort();
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
    // Spec 070: the source→group link lives on component_groups provenance.
    const ownGroup = await (await db())
      .selectFrom("component_groups")
      .select("id")
      .where("autoSourceId", "=", source.id)
      .where("autoGroupKey", "is", null)
      .executeTakeFirstOrThrow();
    expect(ownGroup.id).toBe(group.id);

    for (const ext of ["eng-a", "c1", "c2"]) {
      const comp = await componentByExternalId(ext);
      expect(await groupIdsOf(comp.id)).toContain(group.id);
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
    expect(await groupIdsOf(shared.id)).toHaveLength(0);

    const onlyA = await componentByExternalId("only-a");
    const onlyB = await componentByExternalId("only-b");
    const idsA = await groupIdsOf(onlyA.id);
    const idsB = await groupIdsOf(onlyB.id);
    expect(idsA).not.toHaveLength(0);
    expect(idsB).not.toHaveLength(0);
    expect(idsA).not.toEqual(idsB);

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
    const groupA = (await groupIdsOf(comp.id))[0];
    expect(groupA).toBeDefined();

    // Source B starts reporting it too → two effective reporters → evicted.
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("moving")], "src-B"),
    );
    const configB = await createConfig();
    await runOnce(configB);

    comp = await componentByExternalId("moving");
    expect(await groupIdsOf(comp.id)).toHaveLength(0);

    // Source A stops reporting it → B is sole reporter → joins B's group.
    (getImporter as any).mockResolvedValueOnce(sourceImporter([], "src-A"));
    await runOnce(configA);

    comp = await componentByExternalId("moving");
    const idsAfter = await groupIdsOf(comp.id);
    expect(idsAfter).toHaveLength(1);
    expect(idsAfter[0]).not.toBe(groupA);
    const groupB = await groupById(idsAfter[0]!);
    expect(groupB.slug).toMatch(/^docker-cluster-/);
  });

  it("never touches manual components; human memberships coexist with auto ones", async () => {
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
    // auto-group; a human then ALSO places it in their own group.
    (getImporter as any).mockResolvedValue(
      sourceImporter([asset("foreign-ext"), asset("solo")], "src-A"),
    );
    const configA = await createConfig();
    await runOnce(configA);

    const foreignComp = await componentByExternalId("foreign-ext");
    const autoGroupId = (await groupIdsOf(foreignComp.id))[0];
    expect(autoGroupId).toBeDefined();

    const move = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${foreignComp.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: { componentGroupIds: [humanGroupId] },
    });
    expect(move.statusCode).toBe(200);

    // Spec 070: memberships are additive — the human assignment does NOT
    // evict the auto membership, and the next pass keeps both (the pass
    // owns only its own group's member set).
    await runOnce(configA);

    const manualComp = await (await db())
      .selectFrom("components")
      .selectAll()
      .where("id", "=", manualId)
      .executeTakeFirstOrThrow();
    expect(await groupIdsOf(manualComp.id)).toHaveLength(0);

    const foreignAfter = await componentByExternalId("foreign-ext");
    expect((await groupIdsOf(foreignAfter.id)).sort()).toEqual(
      [autoGroupId, humanGroupId].sort(),
    );

    // The auto-group holds both eligible components.
    const groups = await autoGroups();
    expect(groups).toHaveLength(1);
    const solo = await componentByExternalId("solo");
    expect(await groupIdsOf(solo.id)).toContain(groups[0].id);
    const members = await (await db())
      .selectFrom("component_group_members")
      .select("componentId")
      .where("groupId", "=", groups[0].id)
      .execute();
    expect(members.map((m) => m.componentId).sort()).toEqual(
      [foreignAfter.id, solo.id].sort(),
    );
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
      expect(await groupIdsOf(comp.id)).toHaveLength(0);
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
      expect(await groupIdsOf(comp.id)).toContain(group.id);
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
    expect(await groupIdsOf(comp.id)).toContain(group.id);
    expect((await groupById(group.id)).lifecycle).toBe("ACTIVE");

    // A fresh opted-out source never gains a group.
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("c9")], "src-B"),
    );
    const configB = await createConfig({ autoGroup: false });
    await runOnce(configB);
    expect(await autoGroups()).toHaveLength(1);
    const c9 = await componentByExternalId("c9");
    expect(await groupIdsOf(c9.id)).toHaveLength(0);
  });

  it("evicts an ineligible component parked inside the auto-group", async () => {
    (getImporter as any).mockResolvedValue(
      sourceImporter([asset("c1")], "src-A"),
    );
    const configA = await createConfig();
    await runOnce(configA);
    const group = (await autoGroups())[0];

    // A manual component has no source memberships — humans can no longer
    // assign auto groups via the API (GROUP_AUTO_MANAGED), so seed the
    // membership row directly to simulate a stale/foreign placement. The
    // next pass evicts it: membership in an owned group is fully derived.
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
    await (await db())
      .insertInto("component_group_members")
      .values({ componentId: parkedId, groupId: group.id })
      .execute();

    await runOnce(configA);
    expect(await groupIdsOf(parkedId)).toHaveLength(0);
    // The eligible member is untouched.
    const c1 = await componentByExternalId("c1");
    expect(await groupIdsOf(c1.id)).toContain(group.id);
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

    const c1Freeze = await componentByExternalId("c1");
    expect(await groupIdsOf(c1Freeze.id)).toContain(group.id);
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
    const c1Rebind = await componentByExternalId("c1");
    expect(await groupIdsOf(c1Rebind.id)).toContain(group.id);

    // Enabled config binds again → maintenance resumes on the SAME group.
    (getImporter as any).mockResolvedValueOnce(
      sourceImporter([asset("c1")], "src-A"), // c2 dropped → evicted
    );
    await runOnce(configA);
    expect((await autoGroups())[0].id).toBe(group.id);
    expect(await groupIdsOf(c1Rebind.id)).toContain(group.id);
    const c2 = await componentByExternalId("c2");
    expect(await groupIdsOf(c2.id)).toHaveLength(0);
  });

  // Spec 070 / ADR-129 amendment: app-level auto groups — one per
  // (source, compose project | swarm stack); membership = reported AND
  // label-carrying; additive alongside source + human groups.
  describe("app-level auto ComponentGroups (spec 070)", () => {
    it("compose project group holds exactly the label-carrying members, additively", async () => {
      (getImporter as any).mockResolvedValue(
        sourceImporter(
          [
            asset("eng", "docker-engine"),
            asset("web-1", "compose-service", { composeProject: "shop", composeService: "web" }),
            asset("web-2", "compose-service", { composeProject: "shop", composeService: "api" }),
            asset("net-shop", "network", {
              labels: { "com.docker.compose.project": "shop" },
            }),
            asset("vol-shop", "volume", {
              labels: { "com.docker.compose.project": "shop" },
            }),
            asset("net-bridge", "network", { labels: {} }),
            asset("img-1", "image", { imageRef: "nginx:1.25", ociLabels: {} }),
            asset("lone", "container"), // reported but unlabeled
          ],
          "src-A",
          "Engine A",
        ),
      );
      const configA = await createConfig();
      await runOnce(configA);

      const apps = await appGroups();
      expect(apps).toHaveLength(1);
      const appGroup = apps[0];
      expect(appGroup.autoGroupKey).toBe("compose:shop");
      expect(appGroup.name).toBe("shop");
      expect(appGroup.slug).toMatch(/^docker-app-shop-[0-9a-f]{12}$/);
      expect(appGroup.description).toContain("src-A");
      expect(appGroup.description).toContain("shop");
      expect(appGroup.teamOwnerId).toBeNull();
      expect(appGroup.autoSourceId).toBe((await sourceByIdentity("src-A")).id);
      expect(appGroup.lifecycle).toBe("ACTIVE");

      // Exact member set: workloads + labeled infra only.
      const expected = ["net-shop", "vol-shop", "web-1", "web-2"].map(
        async (ext) => (await componentByExternalId(ext)).id,
      );
      expect(await membersOfGroup(appGroup.id)).toEqual(
        (await Promise.all(expected)).sort(),
      );

      // Additive: labeled members ALSO sit in the source group; unlabeled
      // sole-reported members sit ONLY there.
      const sourceGroup = (await autoGroups())[0];
      const web1 = await componentByExternalId("web-1");
      const lone = await componentByExternalId("lone");
      const img = await componentByExternalId("img-1");
      const eng = await componentByExternalId("eng");
      expect((await groupIdsOf(web1.id)).sort()).toEqual(
        [sourceGroup.id, appGroup.id].sort(),
      );
      expect(await groupIdsOf(lone.id)).toEqual([sourceGroup.id]);
      expect(await groupIdsOf(img.id)).toEqual([sourceGroup.id]);
      expect(await groupIdsOf(eng.id)).toEqual([sourceGroup.id]);

      // The API surfaces both memberships on the component payload.
      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/components/${web1.id}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      const refs = JSON.parse(detail.payload).component.componentGroups;
      expect(refs.map((g: any) => g.id).sort()).toEqual(
        [sourceGroup.id, appGroup.id].sort(),
      );
      const appRef = refs.find((g: any) => g.id === appGroup.id);
      expect(appRef.autoGroupKey).toBe("compose:shop");
      expect(appRef.autoSourceId).toBe(appGroup.autoSourceId);
    });

    it("creates one app group per project and per swarm stack", async () => {
      (getImporter as any).mockResolvedValue(
        sourceImporter(
          [
            asset("a1", "compose-service", { composeProject: "alpha" }),
            asset("a2", "compose-service", { composeProject: "alpha" }),
            asset("b1", "compose-service", { composeProject: "beta" }),
            asset("s1", "swarm-service", { stack: "mystack" }),
            asset("s2", "swarm-service", { stack: "mystack" }),
            asset("s3", "swarm-service", {}), // stackless → no app group
          ],
          "src-A",
        ),
      );
      const configA = await createConfig();
      await runOnce(configA);

      const apps = await appGroups();
      expect(apps).toHaveLength(3);
      const byKey = new Map(apps.map((g) => [g.autoGroupKey, g]));
      expect([...byKey.keys()].sort()).toEqual([
        "compose:alpha",
        "compose:beta",
        "stack:mystack",
      ]);
      expect(byKey.get("compose:alpha")!.name).toBe("alpha");
      expect(byKey.get("stack:mystack")!.name).toBe("mystack");
      expect(byKey.get("stack:mystack")!.slug).toMatch(
        /^docker-app-mystack-[0-9a-f]{12}$/,
      );

      const alpha = byKey.get("compose:alpha")!;
      const beta = byKey.get("compose:beta")!;
      const stack = byKey.get("stack:mystack")!;
      const ids = async (...exts: string[]) =>
        (await Promise.all(exts.map(async (e) => (await componentByExternalId(e)).id))).sort();
      expect(await membersOfGroup(alpha.id)).toEqual(await ids("a1", "a2"));
      expect(await membersOfGroup(beta.id)).toEqual(await ids("b1"));
      expect(await membersOfGroup(stack.id)).toEqual(await ids("s1", "s2"));

      // s3 reported but keyless → source group only.
      const s3 = await componentByExternalId("s3");
      expect(await groupIdsOf(s3.id)).toEqual([(await autoGroups())[0].id]);
    });

    it("shared components join every reporter's app group; images never join", async () => {
      // src-A and src-B both report "shared" with the same project label —
      // two reporters → no source group for it, but BOTH app groups.
      (getImporter as any).mockResolvedValueOnce(
        sourceImporter(
          [
            asset("shared", "compose-service", { composeProject: "shop" }),
            asset("a-only", "compose-service", { composeProject: "shop" }),
            asset("a-img", "image", { imageRef: "app:1", ociLabels: {} }),
          ],
          "src-A",
        ),
      );
      const configA = await createConfig();
      await runOnce(configA);

      (getImporter as any).mockResolvedValueOnce(
        sourceImporter(
          [
            asset("shared", "compose-service", { composeProject: "shop" }),
            asset("b-only", "compose-service", { composeProject: "shop" }),
          ],
          "src-B",
        ),
      );
      const configB = await createConfig();
      await runOnce(configB);

      const apps = await appGroups();
      // One compose:shop group PER SOURCE (provenance is per-source).
      expect(apps).toHaveLength(2);
      const srcA = await sourceByIdentity("src-A");
      const srcB = await sourceByIdentity("src-B");
      const groupA = apps.find((g) => g.autoSourceId === srcA.id)!;
      const groupB = apps.find((g) => g.autoSourceId === srcB.id)!;
      expect(groupA.autoGroupKey).toBe("compose:shop");
      expect(groupB.autoGroupKey).toBe("compose:shop");
      expect(groupA.id).not.toBe(groupB.id);
      expect(groupA.slug).not.toBe(groupB.slug);

      const shared = await componentByExternalId("shared");
      // Two effective reporters → excluded from BOTH source groups, but
      // present in BOTH app groups (membership is per-source additive).
      expect(await groupIdsOf(shared.id)).toEqual([groupA.id, groupB.id].sort());
      const srcGroups = await autoGroups();
      expect(srcGroups).toHaveLength(2);
      for (const sg of srcGroups) {
        expect(await groupIdsOf(shared.id)).not.toContain(sg.id);
      }

      const aOnly = await componentByExternalId("a-only");
      const bOnly = await componentByExternalId("b-only");
      expect(await groupIdsOf(aOnly.id)).toContain(groupA.id);
      expect(await groupIdsOf(bOnly.id)).toContain(groupB.id);
      // a-only is sole-reported by A → also in A's source group.
      expect((await groupIdsOf(aOnly.id)).sort()).toEqual(
        [groupA.id, srcGroups.find((g) => g.autoSourceId === srcA.id)!.id].sort(),
      );

      // Image components never carry boundary keys → never app members.
      const aImg = await componentByExternalId("a-img");
      expect(await groupIdsOf(aImg.id)).not.toContain(groupA.id);
      expect(await groupIdsOf(aImg.id)).not.toContain(groupB.id);
    });

    it("app groups derive lifecycle and reject human lifecycle writes and deletes", async () => {
      (getImporter as any).mockResolvedValue(
        sourceImporter(
          [asset("w1", "compose-service", { composeProject: "shop" })],
          "src-A",
        ),
      );
      const configA = await createConfig();
      await runOnce(configA);

      const appGroup = (await appGroups())[0];
      expect(appGroup.lifecycle).toBe("ACTIVE");

      const lifecyclePatch = await app.inject({
        method: "PATCH",
        url: `/api/v1/component-groups/${appGroup.id}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
        headers: csrfHeader,
        payload: { lifecycle: "RETIRED" },
      });
      expect(lifecyclePatch.statusCode).toBe(409);
      expect(JSON.parse(lifecyclePatch.payload).code).toBe("GROUP_AUTO_MANAGED");

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/component-groups/${appGroup.id}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
        headers: csrfHeader,
      });
      expect(del.statusCode).toBe(409);
      expect(JSON.parse(del.payload).code).toBe("GROUP_AUTO_MANAGED");

      // Human field edits stay allowed.
      const rename = await app.inject({
        method: "PATCH",
        url: `/api/v1/component-groups/${appGroup.id}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
        headers: csrfHeader,
        payload: { name: "Shop (renamed)", description: "note" },
      });
      expect(rename.statusCode).toBe(200);
      expect((await groupById(appGroup.id)).name).toBe("Shop (renamed)");
    });

    it("retireSource evicts app members and derives RETIRED; reactivate resumes", async () => {
      (getImporter as any).mockResolvedValueOnce(
        sourceImporter(
          [asset("w1", "compose-service", { composeProject: "shop" })],
          "src-A",
        ),
      );
      const configA = await createConfig();
      await runOnce(configA);

      const appGroup = (await appGroups())[0];
      const source = await sourceByIdentity("src-A");

      const retire = await app.inject({
        method: "POST",
        url: `/api/v1/importer-sources/${source.id}/retire`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
        headers: csrfHeader,
      });
      expect(retire.statusCode).toBe(200);

      // Members evicted; group row + provenance survive; lifecycle RETIRED.
      expect(await membersOfGroup(appGroup.id)).toHaveLength(0);
      const after = await groupById(appGroup.id);
      expect(after.lifecycle).toBe("RETIRED");
      expect(after.autoSourceId).toBe(source.id);
      expect(after.autoGroupKey).toBe("compose:shop");

      const reactivate = await app.inject({
        method: "POST",
        url: `/api/v1/importer-sources/${source.id}/reactivate`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
        headers: csrfHeader,
      });
      expect(reactivate.statusCode).toBe(200);

      // Memberships resume on the SAME group (component still RETIRED →
      // group stays honestly RETIRED).
      const w1 = await componentByExternalId("w1");
      expect(await groupIdsOf(w1.id)).toContain(appGroup.id);
      expect((await groupById(appGroup.id)).lifecycle).toBe("RETIRED");
    });

    it("autoGroup:false and unbound sources freeze app groups too", async () => {
      // Phase 1 — opt-out freezes an existing app group.
      (getImporter as any).mockResolvedValueOnce(
        sourceImporter(
          [asset("w1", "compose-service", { composeProject: "shop" })],
          "src-A",
        ),
      );
      const configA = await createConfig();
      await runOnce(configA);
      const appGroup = (await appGroups())[0];
      expect(appGroup).toBeDefined();

      const { db: kdb } = await import("../../src/db/connection.js");
      await kdb
        .updateTable("importer_configs")
        .set({ scope: { targetId: "00000000-0000-7000-8000-000000000000", autoGroup: false } })
        .where("id", "=", configA)
        .execute();
      // Empty inventory would evict everything if the pass evaluated it.
      (getImporter as any).mockResolvedValueOnce(
        sourceImporter([], "src-A"),
      );
      await runOnce(configA);
      expect(await appGroups()).toHaveLength(1);
      const w1Frozen = await componentByExternalId("w1");
      expect(await groupIdsOf(w1Frozen.id)).toContain(appGroup.id);
      expect((await groupById(appGroup.id)).lifecycle).toBe("ACTIVE");

      // Phase 2 — a fresh opted-out source gains no app group.
      (getImporter as any).mockResolvedValueOnce(
        sourceImporter(
          [asset("w2", "compose-service", { composeProject: "shop" })],
          "src-B",
        ),
      );
      const configB = await createConfig({ autoGroup: false });
      await runOnce(configB);
      expect(await appGroups()).toHaveLength(1);
      const w2 = await componentByExternalId("w2");
      expect(await groupIdsOf(w2.id)).toHaveLength(0);

      // Phase 3 — unbind src-A (UNMONITORED): its app group freezes while
      // an unrelated enabled source's pass runs.
      const source = await sourceByIdentity("src-A");
      await kdb
        .updateTable("importer_sources")
        .set({ status: "UNMONITORED", boundConfigId: null })
        .where("id", "=", source.id)
        .execute();
      (getImporter as any).mockResolvedValueOnce(
        sourceImporter(
          [asset("w3", "compose-service", { composeProject: "other" })],
          "src-C",
        ),
      );
      const configC = await createConfig();
      await runOnce(configC);

      // src-A's group untouched; src-C got its own.
      expect(await groupIdsOf(w1Frozen.id)).toContain(appGroup.id);
      expect((await groupById(appGroup.id)).lifecycle).toBe("ACTIVE");
      const apps = await appGroups();
      expect(apps).toHaveLength(2);
      expect(apps.some((g) => g.autoGroupKey === "compose:other")).toBe(true);
    });

    it("cleans up a RETIRED source's groups even after it loses its config binding", async () => {
      (getImporter as any).mockResolvedValueOnce(
        sourceImporter(
          [asset("w1", "compose-service", { composeProject: "shop" })],
          "src-A",
        ),
      );
      const configA = await createConfig();
      await runOnce(configA);

      const appGroup = (await appGroups())[0];
      const ownGroup = (await autoGroups()).find(
        (g) => g.autoSourceId !== null && g.autoGroupKey === null,
      );
      if (!ownGroup) throw new Error("source group missing");
      const source = await sourceByIdentity("src-A");
      const w1 = await componentByExternalId("w1");
      expect(await groupIdsOf(w1.id)).toEqual(
        expect.arrayContaining([appGroup.id, ownGroup.id]),
      );

      // Config deletion while the source was still reportable: it goes
      // UNMONITORED + unbound (frozen). Retiring it afterwards leaves
      // RETIRED + unbound — cleanup is lifecycle teardown, not
      // maintenance, so it must still evaluate without a bound scope.
      const { db: kdb } = await import("../../src/db/connection.js");
      await kdb
        .updateTable("importer_sources")
        .set({ status: "UNMONITORED", boundConfigId: null })
        .where("id", "=", source.id)
        .execute();

      const retire = await app.inject({
        method: "POST",
        url: `/api/v1/importer-sources/${source.id}/retire`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
        headers: csrfHeader,
      });
      expect(retire.statusCode).toBe(200);

      // Both owned groups emptied and derived RETIRED; rows + provenance
      // persist for a later reactivation.
      for (const g of [appGroup, ownGroup]) {
        expect(await membersOfGroup(g.id)).toHaveLength(0);
        const after = await groupById(g.id);
        expect(after.lifecycle).toBe("RETIRED");
        expect(after.autoSourceId).toBe(source.id);
      }
      expect((await groupById(appGroup.id)).autoGroupKey).toBe("compose:shop");
    });

    it("evicts an ineligible component parked inside an app group", async () => {
      (getImporter as any).mockResolvedValue(
        sourceImporter(
          [asset("w1", "compose-service", { composeProject: "shop" })],
          "src-A",
        ),
      );
      const configA = await createConfig();
      await runOnce(configA);
      const appGroup = (await appGroups())[0];

      // Park an unlabeled manual component inside the automation-owned
      // group — the next pass evicts it (member set is fully derived).
      const parked = await app.inject({
        method: "POST",
        url: "/api/v1/components",
        cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
        headers: csrfHeader,
        payload: {
          name: "parked-app",
          slug: "parked-app",
          category: "CONTAINER",
          provider: "DOCKER",
          resourceType: "container",
        },
      });
      const parkedId = JSON.parse(parked.payload).component.id;
      await (await db())
        .insertInto("component_group_members")
        .values({ componentId: parkedId, groupId: appGroup.id })
        .execute();

      await runOnce(configA);
      expect(await groupIdsOf(parkedId)).toHaveLength(0);
      const w1 = await componentByExternalId("w1");
      expect(await groupIdsOf(w1.id)).toContain(appGroup.id);
    });

    it("emptied app group derives RETIRED but the row and provenance persist", async () => {
      // Project "shop" exists, then the workload is re-reported without
      // the boundary label (rename/re-create without compose labels) —
      // the member evicts, the group derives RETIRED, and the row stays
      // for provenance (spec edge case: scaled-to-zero/renamed project).
      (getImporter as any).mockResolvedValueOnce(
        sourceImporter(
          [asset("w1", "compose-service", { composeProject: "shop" })],
          "src-A",
        ),
      );
      const configA = await createConfig();
      await runOnce(configA);
      const appGroup = (await appGroups())[0];
      expect(appGroup.lifecycle).toBe("ACTIVE");

      (getImporter as any).mockResolvedValueOnce(
        sourceImporter([asset("w1", "container", {})], "src-A"),
      );
      await runOnce(configA);

      const w1 = await componentByExternalId("w1");
      expect(await membersOfGroup(appGroup.id)).toHaveLength(0);
      // Still sole-reported → stays in the source group only.
      const sourceGroup = (await autoGroups())[0];
      expect(await groupIdsOf(w1.id)).toEqual([sourceGroup.id]);

      const after = await groupById(appGroup.id);
      expect(after.lifecycle).toBe("RETIRED");
      expect(after.autoGroupKey).toBe("compose:shop");
      expect(after.autoSourceId).toBe(appGroup.autoSourceId);
      expect(after.slug).toBe(appGroup.slug);
    });
  });

  // Spec 071: a human environment override survives import reconciliation —
  // runs keep refreshing the reported `environment` column while the
  // override layer wins at serialization; clearing restores the latest
  // reported value.
  it("environment override survives runs; clear restores latest reported", async () => {
    const envAsset = (environment: string): DiscoveredAsset => {
      const a = asset("svc-a", "container", {});
      a.instances = [
        {
          externalId: "svc-a-inst",
          environment: environment as DiscoveredAsset["instances"][number]["environment"],
          status: "RUNNING",
        },
      ];
      return a;
    };
    const instanceOf = async () => {
      const comp = await componentByExternalId("svc-a");
      return (await db())
        .selectFrom("component_instances")
        .selectAll()
        .where("componentId", "=", comp.id)
        .executeTakeFirstOrThrow();
    };
    const patchEnv = (instanceId: string, environment: string | null) =>
      app.inject({
        method: "PATCH",
        url: `/api/v1/component-instances/${instanceId}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
        headers: csrfHeader,
        payload: { environment },
      });

    (getImporter as any).mockResolvedValue(sourceImporter([envAsset("PRODUCTION")], "src-A"));
    const configA = await createConfig();
    await runOnce(configA);
    const instance = await instanceOf();
    expect(instance.environment).toBe("PRODUCTION");

    // Human override to STAGING.
    const set = await patchEnv(instance.id, "STAGING");
    expect(set.statusCode).toBe(200);
    expect(JSON.parse(set.payload).instance.environment).toBe("STAGING");

    // Next run reports DEV — reported column refreshes, override holds.
    (getImporter as any).mockResolvedValue(sourceImporter([envAsset("DEV")], "src-A"));
    await runOnce(configA);
    const after = await instanceOf();
    expect(after.environment).toBe("DEV");
    expect(after.environmentOverride).toBe("STAGING");

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/components/${after.componentId}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const apiInstance = JSON.parse(detail.payload).component.instances.find(
      (i: { id: string }) => i.id === after.id,
    );
    expect(apiInstance.environment).toBe("STAGING");
    expect(apiInstance.reportedEnvironment).toBe("DEV");

    // Clear → effective falls back to the latest reported value.
    const clear = await patchEnv(after.id, null);
    expect(clear.statusCode).toBe(200);
    expect(JSON.parse(clear.payload).instance.environment).toBe("DEV");
    const cleared = await instanceOf();
    expect(cleared.environmentOverride).toBeNull();
  });
});
