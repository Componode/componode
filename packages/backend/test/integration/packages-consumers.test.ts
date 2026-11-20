import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import { normalizePurlIdentity } from "@componode/core";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import type { listPackageConsumers as listPackageConsumersT } from "../../src/services/packages-service.js";

// Spec 074 T015 — `listPackageConsumers` + GET /packages/consumers.
let listPackageConsumers: typeof listPackageConsumersT;
let app: any;
let viewerSession = "";

const now = () => new Date().toISOString();

async function seedComponent(
  db: TestDb["db"],
  opts: { name: string; slug: string; lifecycle?: string },
): Promise<string> {
  const id = uuidv7();
  await db
    .insertInto("components")
    .values({
      id, name: opts.name, slug: opts.slug, category: "REPOSITORY",
      provider: "GITHUB", resourceType: "github:repository",
      lifecycle: opts.lifecycle ?? "ACTIVE", teamOwnerId: null,
      externalId: opts.slug, details: null, sunsetAt: null, lastSeenAt: null,
      lastSeenInRunId: null, createdBy: null, updatedBy: null,
      createdAt: now(), updatedAt: now(),
    } as never)
    .execute();
  return id;
}

async function seedEntry(
  db: TestDb["db"],
  componentId: string,
  e: {
    purl: string; name?: string; version?: string | null; scope?: string;
    direct?: boolean; lastReportedAt?: string;
  },
): Promise<void> {
  await sql`
    INSERT INTO bom_entries
      (id, "componentId", purl, "purlIdentity", name, version, ecosystem,
       scope, "evidenceSource", licenses, direct, "lastReportedAt",
       "createdAt", "updatedAt")
    VALUES (${uuidv7()}, ${componentId}, ${e.purl},
            ${normalizePurlIdentity(e.purl) ?? e.purl},
            ${e.name ?? "pkg"}, ${e.version === undefined ? "1.0.0" : e.version},
            'npm', ${e.scope ?? "RUNTIME"}, 'REGISTRY_API', '[]'::jsonb,
            ${e.direct ?? true}, ${e.lastReportedAt ?? now()},
            ${now()}, ${now()})
  `.execute(db);
}

const base = { purl: "pkg:npm/lodash", page: 1, pageSize: 50, order: "asc" as const };

describe("packages consumers", () => {
  let testDb: TestDb;
  let compA = "";
  let compB = "";
  let compRetired = "";

  beforeAll(async () => {
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    ({ listPackageConsumers } = await import(
      "../../src/services/packages-service.js"
    ));
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    const { createPersonInDb, createSessionInDb } = await import(
      "../helpers/api.js"
    );
    const viewerId = await createPersonInDb(testDb.db as any, {
      username: "viewer", passwordHash: null, role: "VIEWER",
    });
    viewerSession = (await createSessionInDb(testDb.db as any, viewerId)).token;
    compA = await seedComponent(testDb.db, { name: "App A", slug: "app-a-c" });
    compB = await seedComponent(testDb.db, { name: "App B", slug: "app-b-c" });
    compRetired = await seedComponent(testDb.db, {
      name: "Old", slug: "old-c", lifecycle: "RETIRED",
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    await testDb.cleanup();
  });

  beforeEach(async () => {
    await testDb.db.deleteFrom("bom_entries").execute();
  });

  it("returns one row per (component, version, scope) with merged direct+lastReportedAt", async () => {
    const t1 = "2025-01-01T00:00:00.000Z";
    const t2 = "2025-02-01T00:00:00.000Z";
    // Same component+version+scope from two "instances" → one merged row,
    // direct=true wins, newest timestamp wins.
    await seedEntry(testDb.db, compA, { purl: "pkg:npm/lodash@4.17.21", version: "4.17.21", direct: true, lastReportedAt: t1 });
    await seedEntry(testDb.db, compA, { purl: "pkg:npm/lodash@4.17.21?arch=x64", version: "4.17.21", direct: false, lastReportedAt: t2 });
    await seedEntry(testDb.db, compA, { purl: "pkg:npm/lodash@4.17.21", version: "4.17.21", scope: "DEV", direct: false, lastReportedAt: t1 });
    await seedEntry(testDb.db, compB, { purl: "pkg:npm/lodash@4.17.20", version: "4.17.20", direct: false, lastReportedAt: t1 });
    await seedEntry(testDb.db, compRetired, { purl: "pkg:npm/lodash@9.9.9", version: "9.9.9", direct: true, lastReportedAt: t2 });

    const res = await listPackageConsumers({ ...base });
    expect(res.data.length).toBe(3);
    const merged = res.data.find((r) => r.component.slug === "app-a-c" && r.scope === "RUNTIME")!;
    expect(merged.direct).toBe(true);
    expect(merged.lastReportedAt).toBe(t2);
    expect(merged.version).toBe("4.17.21");
    expect(merged.component).toMatchObject({ id: compA, name: "App A", category: "REPOSITORY" });
    // Retired component excluded.
    expect(res.data.some((r) => r.component.id === compRetired)).toBe(false);
  });

  it("normalizes the purl parameter before matching", async () => {
    await seedEntry(testDb.db, compA, { purl: "pkg:npm/lodash@4.17.21" });
    const res = await listPackageConsumers({
      ...base,
      purl: "pkg:npm/Lodash@4.17.21?foo=bar#frag",
    });
    expect(res.data.length).toBe(1);
  });

  it("filters consumers by version", async () => {
    await seedEntry(testDb.db, compA, { purl: "pkg:npm/lodash@4.17.21", version: "4.17.21" });
    await seedEntry(testDb.db, compB, { purl: "pkg:npm/lodash@4.17.20", version: "4.17.20" });
    const res = await listPackageConsumers({ ...base, version: "4.17.20" });
    expect(res.data.length).toBe(1);
    expect(res.data[0]!.component.slug).toBe("app-b-c");
  });

  it("returns an empty page for an unknown purl", async () => {
    const res = await listPackageConsumers({ ...base, purl: "pkg:npm/ghost" });
    expect(res.data).toEqual([]);
    expect(res.pagination.total).toBe(0);
  });

  it("paginates consumers", async () => {
    for (let i = 0; i < 5; i++) {
      const cid = await seedComponent(testDb.db, { name: `C${i}`, slug: `cons-${i}-${uuidv7().slice(24)}` });
      await seedEntry(testDb.db, cid, { purl: "pkg:npm/lodash@4.17.21" });
    }
    const res = await listPackageConsumers({ ...base, pageSize: 3 });
    expect(res.data.length).toBe(3);
    expect(res.pagination.total).toBe(5);
    expect(res.pagination.hasNext).toBe(true);
  });

  it("route: 400 without purl, 200 empty for unknown purl, 401 unauthenticated", async () => {
    const { SESSION_COOKIE_NAME, csrfCookie, csrfHeader } = await import(
      "../helpers/api.js"
    );
    const get = (path: string, session?: string) =>
      app.inject({
        method: "GET",
        url: `/api/v1${path}`,
        cookies: session ? { [SESSION_COOKIE_NAME]: session, ...csrfCookie } : csrfCookie,
        headers: csrfHeader,
      });

    expect((await get("/packages/consumers", viewerSession)).statusCode).toBe(400);
    // `search` is a list-endpoint param — consumers omits it (converge T046).
    expect(
      (await get("/packages/consumers?purl=pkg:npm/x&search=y", viewerSession))
        .statusCode,
    ).toBe(400);
    const unknown = await get("/packages/consumers?purl=pkg:npm/ghost", viewerSession);
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json().data).toEqual([]);
    expect((await get("/packages/consumers?purl=pkg:npm/x")).statusCode).toBe(401);
  });
});
