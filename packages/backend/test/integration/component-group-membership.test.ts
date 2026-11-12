import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { DB } from "../../src/db/types.js";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
  truncateImportTables,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

async function mkComponent(
  db: TestDb["db"],
  slug: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const id = uuidv7();
  await db
    .insertInto("components")
    .values({
      id,
      name: slug,
      slug,
      category: "CONTAINER",
      provider: "DOCKER",
      resourceType: "container",
      lifecycle: "ACTIVE",
      externalId: null,
      details: null,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
      ...extra,
    } as any)
    .execute();
  return id;
}

async function mkGroup(
  app: any,
  session: string,
  name: string,
  slug: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/component-groups",
    cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
    headers: csrfHeader,
    payload: { name, slug },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.payload).group.id;
}

describe("component group membership (spec 070)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let originalDbUrl: string | undefined;
  let originalNodeEnv: string | undefined;
  let originalBootstrapUsername: string | undefined;
  let originalBootstrapPassword: string | undefined;

  beforeAll(async () => {
    originalDbUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    originalBootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
    originalBootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;

    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();

    const { loginAs } = await import("../helpers/api.js");
    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD))!;
  });

  beforeEach(async () => {
    await truncateImportTables(testDb.db);
  });

  afterAll(async () => {
    if (app) await app.close();
    await testDb.cleanup();
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    else delete process.env.DATABASE_URL;
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalBootstrapUsername !== undefined) process.env.BOOTSTRAP_ADMIN_USERNAME = originalBootstrapUsername;
    else delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    if (originalBootstrapPassword !== undefined) process.env.BOOTSTRAP_ADMIN_PASSWORD = originalBootstrapPassword;
    else delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
  });

  const patchComponent = (id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "PATCH",
      url: `/api/v1/components/${id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload,
    });

  const getComponent = (id: string) =>
    app.inject({
      method: "GET",
      url: `/api/v1/components/${id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });

  const listComponents = (qs = "") =>
    app.inject({
      method: "GET",
      url: `/api/v1/components${qs}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });

  async function memberGroupIds(componentId: string): Promise<string[]> {
    const rows = await testDb.db
      .selectFrom("component_group_members")
      .select("groupId")
      .where("componentId", "=", componentId)
      .execute();
    return rows.map((r) => r.groupId).sort();
  }

  it("assigns several human groups at once and replaces the human set on PATCH", async () => {
    const g1 = await mkGroup(app, adminSession, "Group One", "group-one");
    const g2 = await mkGroup(app, adminSession, "Group Two", "group-two");
    const compId = await mkComponent(testDb.db, "multi-member");

    // Create path accepts the plural field.
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/components",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        name: "created-multi",
        slug: "created-multi",
        category: "CONTAINER",
        provider: "DOCKER",
        resourceType: "container",
        componentGroupIds: [g1, g2],
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = JSON.parse(created.payload);
    const createdId = createdBody.component.id;
    expect(await memberGroupIds(createdId)).toEqual([g1, g2].sort());
    // FR-002: the create response exposes memberships like other payloads.
    expect(
      createdBody.component.componentGroups
        .map((g: { id: string }) => g.id)
        .sort(),
    ).toEqual([g1, g2].sort());

    // PATCH replaces the whole human set — additive across groups, not append.
    const patched = await patchComponent(compId, { componentGroupIds: [g1, g2] });
    expect(patched.statusCode).toBe(200);
    expect(await memberGroupIds(compId)).toEqual([g1, g2].sort());

    const replaced = await patchComponent(compId, { componentGroupIds: [g2] });
    expect(replaced.statusCode).toBe(200);
    expect(await memberGroupIds(compId)).toEqual([g2]);

    const cleared = await patchComponent(compId, { componentGroupIds: [] });
    expect(cleared.statusCode).toBe(200);
    expect(await memberGroupIds(compId)).toHaveLength(0);
  });

  it("component payloads expose componentGroups[] refs with provenance fields", async () => {
    const g1 = await mkGroup(app, adminSession, "Ref Group", "ref-group");
    const compId = await mkComponent(testDb.db, "ref-comp");
    await patchComponent(compId, { componentGroupIds: [g1] });

    const res = await getComponent(compId);
    expect(res.statusCode).toBe(200);
    const groups = JSON.parse(res.payload).component.componentGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: g1,
      name: "Ref Group",
      slug: "ref-group",
      autoSourceId: null,
      autoGroupKey: null,
    });
    // The legacy singular fields are gone.
    expect(JSON.parse(res.payload).component.componentGroupId).toBeUndefined();
    expect(JSON.parse(res.payload).component.componentGroupName).toBeUndefined();
  });

  it("group=<slug> filter matches ANY membership; group=none means zero memberships", async () => {
    const g1 = await mkGroup(app, adminSession, "Filter A", "filter-a");
    const g2 = await mkGroup(app, adminSession, "Filter B", "filter-b");
    const inA = await mkComponent(testDb.db, "in-a");
    const inB = await mkComponent(testDb.db, "in-b");
    const inBoth = await mkComponent(testDb.db, "in-both");
    await mkComponent(testDb.db, "ungrouped");

    await patchComponent(inA, { componentGroupIds: [g1] });
    await patchComponent(inB, { componentGroupIds: [g2] });
    await patchComponent(inBoth, { componentGroupIds: [g1, g2] });

    const slugsOf = async (payload: any) =>
      (payload.data ?? payload.items ?? []).map((c: any) => c.slug).sort();

    // Single slug — matches any membership, not all.
    const a = JSON.parse((await listComponents("?group=filter-a&pageSize=100")).payload);
    expect(await slugsOf(a)).toEqual(["in-a", "in-both"]);

    // Repeated params — union across the listed groups.
    const both = JSON.parse(
      (await listComponents("?group=filter-a&group=filter-b&pageSize=100")).payload,
    );
    expect(await slugsOf(both)).toEqual(["in-a", "in-b", "in-both"]);

    // none — only components with zero memberships of any kind.
    const none = JSON.parse((await listComponents("?group=none&pageSize=100")).payload);
    expect(await slugsOf(none)).toEqual(["ungrouped"]);

    // none + slug — union of ungrouped and slug members.
    const mixed = JSON.parse(
      (await listComponents("?group=none&group=filter-b&pageSize=100")).payload,
    );
    expect(await slugsOf(mixed)).toEqual(["in-b", "in-both", "ungrouped"]);
  });

  it("PATCH componentGroupIds replaces human memberships only — auto memberships untouched", async () => {
    // Seed an auto-managed app group + membership directly (the grouping
    // pass owns those rows; humans must not disturb them).
    const sourceId = uuidv7();
    await testDb.db
      .insertInto("importer_sources")
      .values({
        id: sourceId,
        importerName: "docker",
        externalIdentity: "tcp://engine:2376",
        label: "Engine",
        status: "ACTIVE",
        boundConfigId: null,
        firstSeenInRunId: null,
        lastSeenInRunId: null,
        createdAt: now(),
        updatedAt: now(),
      })
      .execute();
    const autoGroupId = uuidv7();
    await testDb.db
      .insertInto("component_groups")
      .values({
        id: autoGroupId,
        name: "shop",
        slug: `docker-app-shop-${sourceId.slice(0, 8)}`,
        description: "auto",
        lifecycle: "ACTIVE",
        teamOwnerId: null,
        autoSourceId: sourceId,
        autoGroupKey: "compose:shop",
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      })
      .execute();

    const humanGroupId = await mkGroup(app, adminSession, "Human", "human-grp");
    const compId = await mkComponent(testDb.db, "auto-plus-human");
    await testDb.db
      .insertInto("component_group_members")
      .values({ componentId: compId, groupId: autoGroupId })
      .execute();

    // Replace the human set — the auto membership must survive untouched.
    const res = await patchComponent(compId, { componentGroupIds: [humanGroupId] });
    expect(res.statusCode).toBe(200);
    expect(await memberGroupIds(compId)).toEqual([autoGroupId, humanGroupId].sort());

    // Clearing human groups leaves the auto membership in place.
    const cleared = await patchComponent(compId, { componentGroupIds: [] });
    expect(cleared.statusCode).toBe(200);
    expect(await memberGroupIds(compId)).toEqual([autoGroupId]);

    // The payload still reports the auto membership with provenance.
    const detail = JSON.parse((await getComponent(compId)).payload).component;
    const autoRef = detail.componentGroups.find((g: any) => g.id === autoGroupId);
    expect(autoRef).toMatchObject({
      name: "shop",
      autoSourceId: sourceId,
      autoGroupKey: "compose:shop",
    });
  });

  it("rejects auto-managed and unknown group ids on componentGroupIds", async () => {
    const sourceId = uuidv7();
    await testDb.db
      .insertInto("importer_sources")
      .values({
        id: sourceId,
        importerName: "docker",
        externalIdentity: "tcp://engine:2376",
        label: null,
        status: "ACTIVE",
        boundConfigId: null,
        firstSeenInRunId: null,
        lastSeenInRunId: null,
        createdAt: now(),
        updatedAt: now(),
      })
      .execute();
    const autoGroupId = uuidv7();
    await testDb.db
      .insertInto("component_groups")
      .values({
        id: autoGroupId,
        name: "auto",
        slug: `docker-cluster-${sourceId.slice(0, 12)}`,
        description: null,
        lifecycle: "ACTIVE",
        teamOwnerId: null,
        autoSourceId: sourceId,
        autoGroupKey: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      })
      .execute();
    const compId = await mkComponent(testDb.db, "guarded");

    const auto = await patchComponent(compId, { componentGroupIds: [autoGroupId] });
    expect(auto.statusCode).toBe(409);
    expect(JSON.parse(auto.payload).code).toBe("GROUP_AUTO_MANAGED");

    const unknown = await patchComponent(compId, {
      componentGroupIds: [uuidv7()],
    });
    expect(unknown.statusCode).toBe(404);
    expect(JSON.parse(unknown.payload).code).toBe("NOT_FOUND");

    // Mixed valid+auto still rejects wholesale — no partial write.
    const humanGroupId = await mkGroup(app, adminSession, "H", "h-grp");
    const mixed = await patchComponent(compId, {
      componentGroupIds: [humanGroupId, autoGroupId],
    });
    expect(mixed.statusCode).toBe(409);
    expect(await memberGroupIds(compId)).toHaveLength(0);
  });

  it("writes audit entity_changes for human membership edits", async () => {
    const g1 = await mkGroup(app, adminSession, "Audited A", "audited-a");
    const g2 = await mkGroup(app, adminSession, "Audited B", "audited-b");
    const compId = await mkComponent(testDb.db, "audited-comp");

    await patchComponent(compId, { componentGroupIds: [g1] });
    const second = await patchComponent(compId, { componentGroupIds: [g2] });
    expect(second.statusCode).toBe(200);

    const rows = await testDb.db
      .selectFrom("entity_changes")
      .select(["action", "changes"])
      .where("entityType", "=", "component")
      .where("entityId", "=", compId)
      .orderBy("createdAt", "asc")
      .execute();
    const updates = rows.filter((r) => r.action === "updated");
    expect(updates.length).toBeGreaterThanOrEqual(2);
    const last = updates[updates.length - 1]!.changes as any;
    expect(last.componentGroupIds).toEqual({ from: [g1], to: [g2] });
  });
});

// Migration 030 backfill: legacy single-valued columns promote into the
// join table + provenance columns before being dropped. Requires a
// container migrated only through 029 — startTestDb runs ALL migrations,
// so this drives the migration files directly.
describe("migration 030 backfill", () => {
  let container: Awaited<ReturnType<PostgreSqlContainer["start"]>> | null = null;
  let pool: Pool | null = null;
  let db: Kysely<DB> | null = null;

  afterAll(async () => {
    // Kysely.destroy() ends the dialect's pool — no separate pool.end().
    if (db) await db.destroy();
    if (container) await container.stop();
  });

  async function runMigrationsUpTo(prefix: string) {
    const migrationsPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "src",
      "db",
      "migrations",
    );
    const files = (await fs.readdir(migrationsPath))
      .filter((f) => f.endsWith(".ts") && f < prefix)
      .sort();
    for (const file of files) {
      const mod = await import(`file://${join(migrationsPath, file)}`);
      if (mod.up) await mod.up(db as unknown as Kysely<unknown>);
    }
  }

  it("promotes componentGroupId memberships and source group links", async () => {
    container = await new PostgreSqlContainer("postgres:16.11-alpine").start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    pool.on("error", () => {});
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

    // Migrate through 029 — the last schema with the legacy columns.
    await runMigrationsUpTo("030");

    const kdb = db as unknown as Kysely<any>;
    const t = now();
    const groupId = uuidv7();
    const humanGroupId = uuidv7();
    const sourceId = uuidv7();
    const compGrouped = uuidv7();
    const compUngrouped = uuidv7();

    await kdb
      .insertInto("component_groups")
      .values([
        {
          id: groupId, name: "Auto", slug: "auto-1", description: null,
          lifecycle: "ACTIVE", teamOwnerId: null,
          createdBy: null, updatedBy: null, createdAt: t, updatedAt: t,
        },
        {
          id: humanGroupId, name: "Human", slug: "human-1", description: null,
          lifecycle: "ACTIVE", teamOwnerId: null,
          createdBy: null, updatedBy: null, createdAt: t, updatedAt: t,
        },
      ])
      .execute();
    await kdb
      .insertInto("importer_sources")
      .values({
        id: sourceId, importerName: "docker", externalIdentity: "src-1",
        label: null, status: "ACTIVE", boundConfigId: null,
        componentGroupId: groupId,
        firstSeenInRunId: null, lastSeenInRunId: null,
        createdAt: t, updatedAt: t,
      })
      .execute();
    const mkComp = (id: string, slug: string, componentGroupId: string | null) => ({
      id, name: slug, slug, category: "CONTAINER", provider: "DOCKER",
      resourceType: "container", lifecycle: "ACTIVE",
      componentGroupId, externalId: null, details: null,
      lastSeenAt: null, lastSeenInRunId: null,
      createdBy: null, updatedBy: null, createdAt: t, updatedAt: t,
    });
    await kdb
      .insertInto("components")
      .values([
        mkComp(compGrouped, "was-grouped", groupId),
        mkComp(compUngrouped, "was-ungrouped", null),
      ])
      .execute();
    // A second component pointing at the human group proves backfill is
    // not limited to auto groups.
    const compHuman = uuidv7();
    await kdb
      .insertInto("components")
      .values(mkComp(compHuman, "was-human", humanGroupId))
      .execute();

    // Run migration 030.
    const mod = await import(
      `file://${join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "src",
        "db",
        "migrations",
        "030_component_group_membership.ts",
      )}`
    );
    await mod.up(db as unknown as Kysely<unknown>);

    // Join rows: every legacy pointer became a membership.
    const members = await kdb
      .selectFrom("component_group_members")
      .select(["componentId", "groupId"])
      .orderBy("componentId")
      .execute();
    expect(members).toHaveLength(2);
    expect(members).toContainEqual({ componentId: compGrouped, groupId });
    expect(members).toContainEqual({ componentId: compHuman, groupId: humanGroupId });

    // Provenance: the source's linked group is now its own auto group.
    const autoGroup = await kdb
      .selectFrom("component_groups")
      .select(["id", "autoSourceId", "autoGroupKey"])
      .where("id", "=", groupId)
      .executeTakeFirstOrThrow();
    expect(autoGroup.autoSourceId).toBe(sourceId);
    expect(autoGroup.autoGroupKey).toBeNull();
    const human = await kdb
      .selectFrom("component_groups")
      .select(["autoSourceId", "autoGroupKey"])
      .where("id", "=", humanGroupId)
      .executeTakeFirstOrThrow();
    expect(human.autoSourceId).toBeNull();
    expect(human.autoGroupKey).toBeNull();

    // Legacy columns are gone.
    const compCols = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'components' AND column_name = 'componentGroupId'
    `.execute(db);
    expect(compCols.rows).toHaveLength(0);
    const srcCols = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'importer_sources' AND column_name = 'componentGroupId'
    `.execute(db);
    expect(srcCols.rows).toHaveLength(0);

    // Uniqueness: a second source group for the same source is rejected.
    await expect(
      kdb
        .insertInto("component_groups")
        .values({
          id: uuidv7(), name: "dup", slug: "dup-1", description: null,
          lifecycle: "ACTIVE", teamOwnerId: null,
          autoSourceId: sourceId, autoGroupKey: null,
          createdBy: null, updatedBy: null, createdAt: t, updatedAt: t,
        })
        .execute(),
    ).rejects.toThrow();
    // …but an app group for the same source is allowed (different key space).
    await kdb
      .insertInto("component_groups")
      .values({
        id: uuidv7(), name: "app", slug: "app-1", description: null,
        lifecycle: "ACTIVE", teamOwnerId: null,
        autoSourceId: sourceId, autoGroupKey: "compose:shop",
        createdBy: null, updatedBy: null, createdAt: t, updatedAt: t,
      })
      .execute();
    // …and a second app group with the SAME key is rejected.
    await expect(
      kdb
        .insertInto("component_groups")
        .values({
          id: uuidv7(), name: "app2", slug: "app-2", description: null,
          lifecycle: "ACTIVE", teamOwnerId: null,
          autoSourceId: sourceId, autoGroupKey: "compose:shop",
          createdBy: null, updatedBy: null, createdAt: t, updatedAt: t,
        })
        .execute(),
    ).rejects.toThrow();
  });
});
