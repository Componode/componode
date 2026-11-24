import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import { normalizePurlIdentity } from "@componode/core";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  createPersonInDb,
  createSessionInDb,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
} from "../helpers/api.js";

const now = () => new Date().toISOString();

// Spec 080 US2 — GET /products/:slug/packages/consumers: merged
// (component, version, scope) rows for one package, scoped to the
// product's reachable set and carrying DepSource attribution.
describe("product package consumers route", () => {
  let testDb: TestDb;
  let app: any;
  let viewerSession: string;
  const saved: Record<string, string | undefined> = {};

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV"]) saved[k] = process.env[k];
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    const viewerId = await createPersonInDb(testDb.db as any, {
      username: "viewer", passwordHash: null, role: "VIEWER",
    });
    viewerSession = (await createSessionInDb(testDb.db as any, viewerId)).token;
  });

  afterAll(async () => {
    if (app) await app.close();
    await testDb.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  async function mkProduct(slug: string, lifecycle = "ACTIVE") {
    const id = uuidv7();
    await testDb.db
      .insertInto("digital_products")
      .values({
        id, name: slug, slug, description: null, type: "BUSINESS_CAPABILITY",
        lifecycle, lobOwnerId: null, teamOwnerId: null, links: [], tags: [],
        criticality: null, sunsetAt: null, createdBy: null, updatedBy: null,
        createdAt: now(), updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function mkComponent(
    slug: string,
    over: { category?: string; lifecycle?: string } = {},
  ) {
    const id = uuidv7();
    await testDb.db
      .insertInto("components")
      .values({
        id, name: slug, slug, category: over.category ?? "REPOSITORY",
        provider: "GITHUB", resourceType: "repo",
        lifecycle: over.lifecycle ?? "ACTIVE", teamOwnerId: null,
        externalId: null, details: null, sunsetAt: null,
        lastSeenAt: null, lastSeenInRunId: null, createdBy: null,
        updatedBy: null, createdAt: now(), updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function addEntry(
    componentId: string,
    purl: string,
    version: string,
    over: { scope?: string; direct?: boolean; instanceId?: string } = {},
  ) {
    await sql`
      INSERT INTO bom_entries
        (id, "componentId", "componentInstanceId", purl, "purlIdentity", name,
         version, ecosystem, scope, "evidenceSource", licenses, direct,
         "lastReportedAt", "createdAt", "updatedAt")
      VALUES (${uuidv7()}, ${componentId}, ${over.instanceId ?? null},
              ${`${purl}@${version}`},
              ${normalizePurlIdentity(`${purl}@${version}`)}, ${"pkg"},
              ${version}, ${"npm"}, ${over.scope ?? "RUNTIME"}, 'REGISTRY_API',
              '[]'::jsonb, ${over.direct ?? true}, ${now()}, ${now()}, ${now()})
    `.execute(testDb.db);
  }

  beforeEach(async () => {
    await testDb.db.deleteFrom("bom_entries").execute();
    await testDb.db.deleteFrom("component_instances").execute();
    await testDb.db.deleteFrom("product_depends_on_component").execute();
    await testDb.db.deleteFrom("product_depends_on_component_group").execute();
    await testDb.db.deleteFrom("component_group_members").execute();
    await testDb.db.deleteFrom("product_composes").execute();
    await testDb.db.deleteFrom("component_groups").execute();
    await testDb.db.deleteFrom("components").execute();
    await testDb.db.deleteFrom("digital_products").execute();

    // Reachable set for "shop":
    //   comp1  — direct DEPENDS_ON
    //   comp2  — via group "runtime"
    //   comp3  — inherited via COMPOSES child "core"
    //   compm  — direct AND via group (multi-path → preferred attribution)
    //   comp5  — RETIRED direct dep (excluded)
    // Unreachable: comp4.
    const shop = await mkProduct("shop");
    const core = await mkProduct("core");
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId: shop, childId: core })
      .execute();

    ids.comp1 = await mkComponent("comp-1");
    ids.comp2 = await mkComponent("comp-2");
    ids.comp3 = await mkComponent("comp-3");
    ids.compm = await mkComponent("comp-multi");
    ids.comp4 = await mkComponent("comp-4-unreachable");
    ids.comp5 = await mkComponent("comp-5-retired", { lifecycle: "RETIRED" });

    const runtime = uuidv7();
    await testDb.db
      .insertInto("component_groups")
      .values({
        id: runtime, name: "runtime", slug: "runtime", description: null,
        lifecycle: "ACTIVE", teamOwnerId: null, autoSourceId: null,
        autoGroupKey: null, createdBy: null, updatedBy: null,
        createdAt: now(), updatedAt: now(),
      } as never)
      .execute();
    await testDb.db
      .insertInto("product_depends_on_component_group")
      .values({ productId: shop, componentGroupId: runtime })
      .execute();
    await testDb.db
      .insertInto("component_group_members")
      .values([
        { componentId: ids.comp2, groupId: runtime },
        { componentId: ids.compm, groupId: runtime },
      ])
      .execute();

    await testDb.db
      .insertInto("product_depends_on_component")
      .values([
        { productId: shop, componentId: ids.comp1 },
        { productId: shop, componentId: ids.compm },
        { productId: shop, componentId: ids.comp5 },
        { productId: core, componentId: ids.comp3 },
      ])
      .execute();

    // lodash across all reachability kinds; a second entry on comp1 scoped
    // to an instance exercises the (component, version, scope) merge.
    const inst = uuidv7();
    await testDb.db.insertInto("component_instances").values({
      id: inst, componentId: ids.comp1, environment: "PRODUCTION",
      externalId: "inst-1", slug: "inst-1", url: null, region: null,
      status: "RUNNING", version: null, deployedAt: null, rawConfig: null,
      lastSeenAt: null, lastSeenInRunId: null, createdBy: null,
      updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();
    await addEntry(ids.comp1, "pkg:npm/lodash", "4.17.21");
    await addEntry(ids.comp1, "pkg:npm/lodash", "4.17.21", {
      direct: false, instanceId: inst,
    });
    await addEntry(ids.comp2, "pkg:npm/lodash", "3.10.1");
    await addEntry(ids.comp3, "pkg:npm/lodash", "4.17.21", { scope: "DEV" });
    await addEntry(ids.compm, "pkg:npm/lodash", "4.17.21");
    await addEntry(ids.comp4, "pkg:npm/lodash", "9.9.9");
    await addEntry(ids.comp5, "pkg:npm/lodash", "8.8.8");
  });

  const get = (path: string, session?: string) =>
    app.inject({
      method: "GET",
      url: `/api/v1${path}`,
      cookies: session ? { [SESSION_COOKIE_NAME]: session, ...csrfCookie } : csrfCookie,
      headers: csrfHeader,
    });

  it("404s on an unknown slug", async () => {
    const res = await get(
      "/products/nope/packages/consumers?purl=pkg:npm/lodash",
      viewerSession,
    );
    expect(res.statusCode).toBe(404);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await get(
      "/products/shop/packages/consumers?purl=pkg:npm/lodash",
    );
    expect(res.statusCode).toBe(401);
  });

  it("requires purl (strict schema)", async () => {
    const res = await get("/products/shop/packages/consumers", viewerSession);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("rejects unknown query params", async () => {
    const res = await get(
      "/products/shop/packages/consumers?purl=pkg:npm/lodash&bogus=1",
      viewerSession,
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns an empty page for an unknown purl", async () => {
    const res = await get(
      "/products/shop/packages/consumers?purl=pkg:npm/nothere",
      viewerSession,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().pagination.total).toBe(0);
    expect(res.json().data).toEqual([]);
  });

  it("lists merged (component, version, scope) rows with attribution", async () => {
    const res = await get(
      "/products/shop/packages/consumers?purl=pkg:npm/lodash&sort=name&order=asc",
      viewerSession,
    );
    expect(res.statusCode).toBe(200);
    const rows = res.json().data;
    // comp1's duplicate entries merge into one row; comp4/comp5 excluded.
    expect(rows).toHaveLength(4);
    const by = Object.fromEntries(rows.map((r: any) => [r.component.slug, r]));
    expect(by["comp-1"].depSource).toEqual({ kind: "DIRECT" });
    expect(by["comp-1"].version).toBe("4.17.21");
    expect(by["comp-1"].direct).toBe(true); // bool_or over merged entries
    expect(by["comp-2"].depSource).toEqual({
      kind: "GROUP",
      group: expect.objectContaining({ slug: "runtime" }),
    });
    expect(by["comp-3"].depSource).toEqual({
      kind: "INHERITED",
      product: expect.objectContaining({ slug: "core" }),
    });
    expect(by["comp-3"].scope).toBe("DEV");
    // Multi-path (direct + group) prefers the declared source.
    expect(by["comp-multi"].depSource).toEqual({ kind: "DIRECT" });
    expect(typeof by["comp-1"].lastReportedAt).toBe("string");
  });

  it("filters by version", async () => {
    const res = await get(
      "/products/shop/packages/consumers?purl=pkg:npm/lodash&version=3.10.1",
      viewerSession,
    );
    const rows = res.json().data;
    expect(rows).toHaveLength(1);
    expect(rows[0].component.slug).toBe("comp-2");
    expect(rows[0].version).toBe("3.10.1");
  });

  it("paginates the merged rows", async () => {
    const res = await get(
      "/products/shop/packages/consumers?purl=pkg:npm/lodash&pageSize=2&page=2&sort=name&order=asc",
      viewerSession,
    );
    const body = res.json();
    expect(body.pagination.total).toBe(4);
    expect(body.pagination.pageCount).toBe(2);
    expect(body.data).toHaveLength(2);
  });
});
