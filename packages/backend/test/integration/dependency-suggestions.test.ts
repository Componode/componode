import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  createPersonInDb,
  createSessionInDb,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
  truncateImportTables,
} from "../helpers/api.js";
import type * as MatchT from "../../src/services/bom-match-service.js";

// Spec 075 T025/T026/T033/T039 — match pass classification + live catalog
// fields, dependency queue endpoints, library legibility surfaces.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const now = () => new Date().toISOString();
let match: typeof MatchT;

async function seedComponent(
  db: TestDb["db"],
  overrides: Partial<{
    slug: string; name: string; category: string; provider: string;
    externalId: string | null; lifecycle: string;
  }> = {},
) {
  const id = uuidv7();
  await db.insertInto("components").values({
    id, name: overrides.name ?? `c-${id.slice(-12)}`,
    slug: overrides.slug ?? `c-${id.slice(-12)}`,
    category: overrides.category ?? "API",
    provider: overrides.provider ?? "AWS",
    resourceType: "aws:service",
    lifecycle: overrides.lifecycle ?? "ACTIVE",
    teamOwnerId: null, externalId: overrides.externalId ?? null,
    details: null, sunsetAt: null, lastSeenAt: null, lastSeenInRunId: null,
    createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
  } as never).execute();
  return id;
}

async function seedEntry(
  db: TestDb["db"],
  componentId: string,
  overrides: Partial<{
    purl: string; purlIdentity: string; name: string; version: string | null;
    ecosystem: string; resolvedComponentId: string | null;
  }> = {},
) {
  const id = uuidv7();
  await db.insertInto("bom_entries").values({
    id, componentId,
    purl: overrides.purl ?? "pkg:npm/lodash@4.17.21",
    purlIdentity: overrides.purlIdentity ?? "pkg:npm/lodash",
    name: overrides.name ?? "lodash",
    version: overrides.version === undefined ? "4.17.21" : overrides.version,
    ecosystem: overrides.ecosystem ?? "npm",
    resolvedComponentId: overrides.resolvedComponentId ?? null,
    scope: "RUNTIME", evidenceSource: "REGISTRY_API",
  } as never).execute();
  return id;
}

async function stage(db: TestDb["db"], input: {
  bomEntryId: string; parentId: string; childId: string;
  reason?: string | null; score?: number | null; status?: string;
}) {
  const id = uuidv7();
  await db.insertInto("bom_component_suggestions").values({
    id, bomEntryId: input.bomEntryId,
    parentComponentId: input.parentId, childComponentId: input.childId,
    reason: input.reason === undefined ? "PURL_EXACT" : input.reason,
    score: input.score === undefined ? 100 : input.score,
    status: input.status ?? "PENDING",
  } as never).execute();
  return id;
}

describe("Phase 2 backend surfaces", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let editorSession: string;
  let viewerSession: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"])
      saved[k] = process.env[k];
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
    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
    const editorId = await createPersonInDb(testDb.db as any, { username: "editor", passwordHash: null, role: "EDITOR" });
    editorSession = (await createSessionInDb(testDb.db as any, editorId)).token;
    const viewerId = await createPersonInDb(testDb.db as any, { username: "viewer", passwordHash: null, role: "VIEWER" });
    viewerSession = (await createSessionInDb(testDb.db as any, viewerId)).token;
    match = await import("../../src/services/bom-match-service.js");
  });

  afterAll(async () => {
    if (app) await app.close();
    await testDb.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v; else delete process.env[k];
    }
  });

  beforeEach(async () => {
    await truncateImportTables(testDb.db);
    await testDb.db.deleteFrom("bom_component_suggestions").execute();
    await testDb.db.deleteFrom("component_depends_on_component").execute();
    await testDb.db.deleteFrom("bom_entries").execute();
    await testDb.db.deleteFrom("components").execute();
  });

  const get = (url: string, session: string) =>
    app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE_NAME]: session } });
  const post = (url: string, body: unknown, session: string) =>
    app.inject({ method: "POST", url, payload: body, cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie }, headers: csrfHeader });

  it("match pass: exact resolves + stages; name/slug stage unresolved; edged supersede (T025)", async () => {
    const db = testDb.db;
    const consumer = await seedComponent(db);
    const library = await seedComponent(db, { externalId: "pkg:npm/lodash", category: "LIBRARY", provider: "NPM" });
    const named = await seedComponent(db, { name: "React", category: "COMPUTE" });
    const slugged = await seedComponent(db, { slug: "openssl", name: "OpenSSL Lib" });
    const e1 = await seedEntry(db, consumer);
    await seedEntry(db, consumer, {
      purl: "pkg:npm/react@18", purlIdentity: "pkg:npm/react",
      name: "React", version: "18.0.0",
    });
    await seedEntry(db, consumer, {
      purl: "pkg:deb/openssl@3", purlIdentity: "pkg:deb/openssl",
      name: "openssl", version: "3.0",
    });
    // Already-wired pair → tombstone.
    const wired = await seedComponent(db, { externalId: "pkg:npm/wired" });
    const e4 = await seedEntry(db, consumer, {
      purl: "pkg:npm/wired@1", purlIdentity: "pkg:npm/wired", name: "wired",
    });
    await db.insertInto("component_depends_on_component")
      .values({ parentId: consumer, childId: wired, createdAt: now() } as never)
      .execute();

    const report = await match.generateBomMatches({ componentIds: [consumer] });
    expect(report.staged).toBe(3); // exact + name + slug
    expect(report.superseded).toBe(1);
    expect(report.resolved).toBe(2); // lodash + wired both exact-resolve

    const entry = await db.selectFrom("bom_entries").selectAll()
      .where("id", "=", e1).executeTakeFirstOrThrow();
    expect(entry.resolvedComponentId).toBe(library);

    const rows = await db.selectFrom("bom_component_suggestions").selectAll().execute();
    const byReason = Object.fromEntries(rows.map((r) => [r.reason ?? "NULL", r]));
    expect(byReason.PURL_EXACT.childComponentId).toBe(library);
    expect(byReason.PURL_NAME_MATCH.childComponentId).toBe(named);
    expect(byReason.CATALOG_SLUG_MATCH.childComponentId).toBe(slugged);
    expect(byReason.PURL_EXACT.bomEntryId).toBe(e1);
    const tomb = rows.find((r) => r.childComponentId === wired);
    expect(tomb?.status).toBe("SUPERSEDED");
    expect(tomb?.bomEntryId).toBe(e4);
    // Name/slug matches never write resolvedComponentId.
    const reactEntry = await db.selectFrom("bom_entries").selectAll()
      .where("name", "=", "React").executeTakeFirstOrThrow();
    expect(reactEntry.resolvedComponentId).toBeNull();

    // Idempotent re-run: decided/edged pairs untouched, staged=0.
    const again = await match.generateBomMatches({ componentIds: [consumer] });
    expect(again.staged).toBe(0);
    expect(again.superseded).toBe(0);
  });

  it("GET /suggestions?kind=dependency lists pending; groups aggregate + bulkAcceptable (T033)", async () => {
    const db = testDb.db;
    const c1 = await seedComponent(db);
    const c2 = await seedComponent(db);
    const lib = await seedComponent(db, { externalId: "pkg:npm/lodash", category: "LIBRARY", provider: "NPM", name: "lodash" });
    const e1 = await seedEntry(db, c1);
    const e2 = await seedEntry(db, c2);
    await stage(db, { bomEntryId: e1, parentId: c1, childId: lib });
    await stage(db, { bomEntryId: e2, parentId: c2, childId: lib, reason: "PURL_NAME_MATCH", score: 50 });

    const list = await get("/api/v1/suggestions?kind=dependency&status=PENDING", viewerSession);
    expect(list.statusCode).toBe(200);
    const items = JSON.parse(list.payload).data;
    expect(items).toHaveLength(2);
    expect(items[0].parentComponent.id).toBeTruthy();
    expect(items[0].childComponent.name).toBe("lodash");

    const groups = await get("/api/v1/suggestions/dependencies/groups", viewerSession);
    const g = JSON.parse(groups.payload).data[0];
    expect(g.childComponent.id).toBe(lib);
    expect(g.pendingCount).toBe(2);
    expect(g.reasons.sort()).toEqual(["PURL_EXACT", "PURL_NAME_MATCH"]);
    expect(g.bulkAcceptable).toBe(false); // name-match present
  });

  it("dependency decide: accept wires edge, dismiss terminals, bulk guards non-exact (T033)", async () => {
    const db = testDb.db;
    const c1 = await seedComponent(db);
    const c2 = await seedComponent(db);
    const lib = await seedComponent(db, { externalId: "pkg:npm/lodash", category: "LIBRARY" });
    const e1 = await seedEntry(db, c1);
    const e2 = await seedEntry(db, c2);
    const s1 = await stage(db, { bomEntryId: e1, parentId: c1, childId: lib });
    await stage(db, { bomEntryId: e2, parentId: c2, childId: lib, reason: "PURL_NAME_MATCH", score: 50 });

    // Bulk accept 409s — non-exact pending in group.
    const bulkBad = await post("/api/v1/suggestions/dependencies/bulk",
      { childComponentId: lib, action: "accept" }, editorSession);
    expect(bulkBad.statusCode).toBe(409);

    // Single accept wires the edge.
    const acc = await post(`/api/v1/suggestions/dependencies/${s1}/accept`, {}, editorSession);
    expect(acc.statusCode).toBe(200);
    const edge = await db.selectFrom("component_depends_on_component").selectAll()
      .where("parentId", "=", c1).where("childId", "=", lib).execute();
    expect(edge).toHaveLength(1);
    const row = await db.selectFrom("bom_component_suggestions").selectAll()
      .where("id", "=", s1).executeTakeFirstOrThrow();
    expect(row.status).toBe("ACCEPTED");

    // Re-decide → 409.
    const again = await post(`/api/v1/suggestions/dependencies/${s1}/accept`, {}, editorSession);
    expect(again.statusCode).toBe(409);

    // Bulk dismiss takes any reason.
    const bulk = await post("/api/v1/suggestions/dependencies/bulk",
      { childComponentId: lib, action: "dismiss" }, editorSession);
    expect(bulk.statusCode).toBe(200);
    const res = JSON.parse(bulk.payload);
    expect(res.decided).toBe(1);

    // Viewer → 403 on decide routes (fresh pair — one row per pair ever).
    const c3 = await seedComponent(db);
    const e3 = await seedEntry(db, c3);
    const s3 = await stage(db, { bomEntryId: e3, parentId: c3, childId: lib });
    const forbidden = await post(`/api/v1/suggestions/dependencies/${s3}/dismiss`, {}, viewerSession);
    expect(forbidden.statusCode).toBe(403);
  });

  it("decide 409s on retired endpoints; bulk reports them failed (T053)", async () => {
    const db = testDb.db;
    const c1 = await seedComponent(db);
    const lib = await seedComponent(db, { category: "LIBRARY" });
    const e1 = await seedEntry(db, c1);
    const s1 = await stage(db, { bomEntryId: e1, parentId: c1, childId: lib });

    // Consumer retired after staging — the suggestion is undecidable.
    await db
      .updateTable("components")
      .set({ lifecycle: "RETIRED" })
      .where("id", "=", c1)
      .execute();

    const single = await post(
      `/api/v1/suggestions/dependencies/${s1}/accept`,
      {},
      editorSession,
    );
    expect(single.statusCode).toBe(409);
    const row = await db
      .selectFrom("bom_component_suggestions")
      .selectAll()
      .where("id", "=", s1)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("PENDING");

    // Bulk accept reports the unreachable row instead of silently deciding it.
    const bulk = await post(
      "/api/v1/suggestions/dependencies/bulk",
      { childComponentId: lib, action: "accept" },
      editorSession,
    );
    expect(bulk.statusCode).toBe(200);
    const res = JSON.parse(bulk.payload);
    expect(res.decided).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.failedIds).toEqual([s1]);

    // Dismiss stays decidable on a retired endpoint — clears the stale row.
    const dis = await post(
      `/api/v1/suggestions/dependencies/${s1}/dismiss`,
      {},
      editorSession,
    );
    expect(dis.statusCode).toBe(200);
    const decided = await db
      .selectFrom("bom_component_suggestions")
      .selectAll()
      .where("id", "=", s1)
      .executeTakeFirstOrThrow();
    expect(decided.status).toBe("DISMISSED");
  });

  it("accept on an already-wired pair lands SUPERSEDED (T033)", async () => {
    const db = testDb.db;
    const c = await seedComponent(db);
    const lib = await seedComponent(db, { category: "LIBRARY" });
    const e = await seedEntry(db, c);
    const s = await stage(db, { bomEntryId: e, parentId: c, childId: lib });
    await db.insertInto("component_depends_on_component")
      .values({ parentId: c, childId: lib, createdAt: now() } as never).execute();
    const res = await post(`/api/v1/suggestions/dependencies/${s}/accept`, {}, editorSession);
    expect(res.statusCode).toBe(200);
    const row = await db.selectFrom("bom_component_suggestions").selectAll()
      .where("id", "=", s).executeTakeFirstOrThrow();
    expect(row.status).toBe("SUPERSEDED");
    expect(row.reason).toBeNull();
  });

  it("kind=edge queue is unchanged — nav badge semantics preserved (T033)", async () => {
    const res = await get("/api/v1/suggestions", viewerSession);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).data).toEqual([]);
  });

  it("BOM list carries resolvedComponent + pendingSuggestionId; catalog filter (T026)", async () => {
    const db = testDb.db;
    const c = await seedComponent(db);
    const lib = await seedComponent(db, { category: "LIBRARY", name: "lodash lib", slug: "pkg-npm-lodash" });
    const resolved = await seedEntry(db, c, { resolvedComponentId: lib });
    const suggested = await seedEntry(db, c, { purl: "pkg:npm/r@1", purlIdentity: "pkg:npm/r", name: "r" });
    await seedEntry(db, c, { purl: "pkg:npm/n@1", purlIdentity: "pkg:npm/n", name: "n" });
    await stage(db, { bomEntryId: suggested, parentId: c, childId: lib });

    const list = await get(`/api/v1/components/${c}/bom`, viewerSession);
    const rows = JSON.parse(list.payload).data;
    const linked = rows.find((r: any) => r.id === resolved);
    expect(linked.resolvedComponent.slug).toBe("pkg-npm-lodash");
    const sug = rows.find((r: any) => r.id === suggested);
    expect(sug.pendingSuggestionId).toBeTruthy();

    // Resolved + pending row (T052): "Suggested" outranks "Linked".
    const lib2 = await seedComponent(db, { category: "LIBRARY", name: "r lib", slug: "pkg-npm-r" });
    const both = await seedEntry(db, c, {
      purl: "pkg:npm/r@2",
      purlIdentity: "pkg:npm/r",
      name: "r",
      resolvedComponentId: lib2,
    });
    await stage(db, { bomEntryId: both, parentId: c, childId: lib2 });

    const filtered = await get(`/api/v1/components/${c}/bom?catalog=suggested`, viewerSession);
    const ids = JSON.parse(filtered.payload).data.map((r: any) => r.id).sort();
    expect(ids).toEqual([both, suggested].sort());
    const linkedF = await get(`/api/v1/components/${c}/bom?catalog=linked`, viewerSession);
    const linkedIds = JSON.parse(linkedF.payload).data.map((r: any) => r.id);
    expect(linkedIds).toEqual([resolved]);
    const noneF = await get(`/api/v1/components/${c}/bom?catalog=none`, viewerSession);
    expect(JSON.parse(noneF.payload).data).toHaveLength(1);
  });

  it("components list hides LIBRARY by default + librariesHidden; libraries=1 reveals (T039)", async () => {
    const db = testDb.db;
    await seedComponent(db, { category: "API" });
    await seedComponent(db, { category: "LIBRARY", provider: "NPM" });
    await seedComponent(db, { category: "LIBRARY", provider: "PYPI" });

    const def = await get("/api/v1/components", viewerSession);
    const body = JSON.parse(def.payload);
    expect(body.data).toHaveLength(1);
    expect(body.librariesHidden).toBe(2);

    const all = await get("/api/v1/components?libraries=1", viewerSession);
    expect(JSON.parse(all.payload).data).toHaveLength(3);
  });

  it("relationships excludes LIBRARY lanes, reports libraryCounts (T039)", async () => {
    const db = testDb.db;
    const c = await seedComponent(db);
    const lib = await seedComponent(db, { category: "LIBRARY" });
    const api = await seedComponent(db, { category: "API" });
    await db.insertInto("component_depends_on_component").values([
      { parentId: c, childId: lib, createdAt: now() },
      { parentId: c, childId: api, createdAt: now() },
    ] as never).execute();
    const res = await get(`/api/v1/components/${c}/relationships`, viewerSession);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.relationships.dependsOn).toHaveLength(1);
    expect(body.relationships.dependsOn[0].id).toBe(api);
    expect(body.relationships.libraryCounts).toEqual({ dependsOn: 1, dependedOnBy: 0 });
  });
});
