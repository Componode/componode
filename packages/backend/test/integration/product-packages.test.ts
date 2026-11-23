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

// Spec 080 — GET /products/:slug/packages: bom_entries aggregated over the
// product's reachable set (direct / group / inherited), one row per
// version-free purl, with the declared-dependency signal, coverage, and
// stale threshold.
describe("product packages routes", () => {
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
    over: { category?: string; lifecycle?: string; externalId?: string | null } = {},
  ) {
    const id = uuidv7();
    await testDb.db
      .insertInto("components")
      .values({
        id, name: slug, slug, category: over.category ?? "REPOSITORY",
        provider: "GITHUB", resourceType: "repo",
        lifecycle: over.lifecycle ?? "ACTIVE", teamOwnerId: null,
        externalId: over.externalId ?? null, details: null, sunsetAt: null,
        lastSeenAt: null, lastSeenInRunId: null, createdBy: null,
        updatedBy: null, createdAt: now(), updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function mkGroup(slug: string) {
    const id = uuidv7();
    await testDb.db
      .insertInto("component_groups")
      .values({
        id, name: slug, slug, description: null, lifecycle: "ACTIVE",
        teamOwnerId: null, autoSourceId: null, autoGroupKey: null,
        createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function addEntry(componentId: string, purl: string, name: string, version: string, ecosystem = "npm") {
    await sql`
      INSERT INTO bom_entries
        (id, "componentId", purl, "purlIdentity", name, version, ecosystem,
         scope, "evidenceSource", licenses, direct, "lastReportedAt",
         "createdAt", "updatedAt")
      VALUES (${uuidv7()}, ${componentId}, ${`${purl}@${version}`},
              ${normalizePurlIdentity(`${purl}@${version}`)}, ${name},
              ${version}, ${ecosystem}, 'RUNTIME', 'REGISTRY_API', '[]'::jsonb,
              true, ${now()}, ${now()}, ${now()})
    `.execute(testDb.db);
  }

  beforeEach(async () => {
    await testDb.db.deleteFrom("bom_entries").execute();
    await testDb.db.deleteFrom("component_depends_on_component").execute();
    await testDb.db.deleteFrom("product_depends_on_component").execute();
    await testDb.db.deleteFrom("product_depends_on_component_group").execute();
    await testDb.db.deleteFrom("component_group_members").execute();
    await testDb.db.deleteFrom("product_composes").execute();
    await testDb.db.deleteFrom("component_groups").execute();
    await testDb.db.deleteFrom("components").execute();
    await testDb.db.deleteFrom("digital_products").execute();

    // Reachable set for product "shop":
    //   comp1 — direct DEPENDS_ON
    //   comp2 — via group "runtime" (also holds libExpress)
    //   comp3 — inherited via COMPOSES child "core"
    //   comp5 — RETIRED direct dep (excluded from contributing set)
    //   comp6 — direct dep, reports nothing (coverage denominator only)
    // Unreachable: comp4.
    const shop = await mkProduct("shop");
    const core = await mkProduct("core");
    ids.shop = shop;
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId: shop, childId: core })
      .execute();

    ids.comp1 = await mkComponent("comp-1");
    ids.comp2 = await mkComponent("comp-2");
    ids.comp3 = await mkComponent("comp-3");
    ids.comp4 = await mkComponent("comp-4-unreachable");
    ids.comp5 = await mkComponent("comp-5-retired", { lifecycle: "RETIRED" });
    ids.comp6 = await mkComponent("comp-6-silent");
    ids.libLodash = await mkComponent("lib-lodash", {
      category: "LIBRARY", externalId: "pkg:npm/lodash",
    });
    ids.libExpress = await mkComponent("lib-express", {
      category: "LIBRARY", externalId: "pkg:npm/express",
    });
    ids.libReact = await mkComponent("lib-react", {
      category: "LIBRARY", externalId: "pkg:npm/react",
    });

    const runtime = await mkGroup("runtime");
    await testDb.db
      .insertInto("product_depends_on_component_group")
      .values({ productId: shop, componentGroupId: runtime })
      .execute();
    await testDb.db
      .insertInto("component_group_members")
      .values([
        { componentId: ids.comp2, groupId: runtime },
        { componentId: ids.libExpress, groupId: runtime },
      ])
      .execute();

    await testDb.db
      .insertInto("product_depends_on_component")
      .values([
        { productId: shop, componentId: ids.comp1 },
        { productId: shop, componentId: ids.comp5 },
        { productId: shop, componentId: ids.comp6 },
        { productId: shop, componentId: ids.libLodash },
        { productId: core, componentId: ids.comp3 },
        { productId: core, componentId: ids.libReact },
      ])
      .execute();

    await addEntry(ids.comp1, "pkg:npm/lodash", "lodash", "4.17.21");
    await addEntry(ids.comp1, "pkg:npm/react", "react", "18.2.0");
    await addEntry(ids.comp2, "pkg:npm/lodash", "lodash", "3.10.1");
    await addEntry(ids.comp2, "pkg:npm/express", "express", "4.18.0");
    await addEntry(ids.comp2, "pkg:npm/leftpad", "leftpad", "1.0.0");
    await addEntry(ids.comp3, "pkg:npm/lodash", "lodash", "4.17.21");
    await addEntry(ids.comp4, "pkg:npm/secretpkg", "secretpkg", "9.9.9");
    await addEntry(ids.comp5, "pkg:npm/ghostpkg", "ghostpkg", "1.0.0");
  });

  const get = (path: string, session?: string) =>
    app.inject({
      method: "GET",
      url: `/api/v1${path}`,
      cookies: session ? { [SESSION_COOKIE_NAME]: session, ...csrfCookie } : csrfCookie,
      headers: csrfHeader,
    });

  it("404s on an unknown slug", async () => {
    const res = await get("/products/nope/packages", viewerSession);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await get("/products/shop/packages");
    expect(res.statusCode).toBe(401);
  });

  it("rejects unknown query params (strict schema)", async () => {
    const res = await get("/products/shop/packages?bogus=1", viewerSession);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("rolls up reachable components' BOMs, one row per version-free purl", async () => {
    const res = await get("/products/shop/packages", viewerSession);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // lodash (3 comps), then 1-comp rows sorted name asc: express, leftpad, react.
    expect(body.pagination.total).toBe(4);
    const [lodash, express, leftpad, react] = body.data;
    expect(lodash.purl).toBe("pkg:npm/lodash");
    expect(lodash.componentCount).toBe(3);
    expect(lodash.versionCount).toBe(2);
    expect(lodash.versions.map((v: any) => v.version).sort()).toEqual([
      "3.10.1", "4.17.21",
    ]);
    // Unreachable and RETIRED-reachable entries never surface.
    expect(body.data.map((r: any) => r.purl)).not.toContain("pkg:npm/secretpkg");
    expect(body.data.map((r: any) => r.purl)).not.toContain("pkg:npm/ghostpkg");
    expect(express.purl).toBe("pkg:npm/express");
    expect(leftpad.purl).toBe("pkg:npm/leftpad");
    expect(react.purl).toBe("pkg:npm/react");
  });

  it("marks declared packages with reachability attribution", async () => {
    const body = (await get("/products/shop/packages", viewerSession)).json();
    const by = Object.fromEntries(body.data.map((r: any) => [r.purl, r]));
    expect(by["pkg:npm/lodash"].declared).toEqual({ kind: "DIRECT" });
    expect(by["pkg:npm/express"].declared).toEqual({
      kind: "GROUP",
      group: expect.objectContaining({ slug: "runtime" }),
    });
    expect(by["pkg:npm/react"].declared).toEqual({
      kind: "INHERITED",
      product: expect.objectContaining({ slug: "core" }),
    });
    expect(by["pkg:npm/leftpad"].declared).toBeNull();
    expect(by["pkg:npm/lodash"].catalogComponent.slug).toBe("lib-lodash");
  });

  it("filters by declared state", async () => {
    const declared = (
      await get("/products/shop/packages?declared=declared", viewerSession)
    ).json();
    expect(declared.data.map((r: any) => r.purl).sort()).toEqual([
      "pkg:npm/express", "pkg:npm/lodash", "pkg:npm/react",
    ]);
    const undeclared = (
      await get("/products/shop/packages?declared=undeclared", viewerSession)
    ).json();
    expect(undeclared.data.map((r: any) => r.purl)).toEqual(["pkg:npm/leftpad"]);
  });

  it("filters to multi-version packages with skew=true", async () => {
    const body = (
      await get("/products/shop/packages?skew=true", viewerSession)
    ).json();
    expect(body.data.map((r: any) => r.purl)).toEqual(["pkg:npm/lodash"]);
  });

  it("filters by ecosystem and search", async () => {
    const eco = (
      await get("/products/shop/packages?ecosystem=deb", viewerSession)
    ).json();
    expect(eco.data).toEqual([]);
    const found = (
      await get("/products/shop/packages?search=lodash", viewerSession)
    ).json();
    expect(found.data.map((r: any) => r.purl)).toEqual(["pkg:npm/lodash"]);
    const byPurl = (
      await get("/products/shop/packages?search=pkg:npm/left", viewerSession)
    ).json();
    expect(byPurl.data.map((r: any) => r.purl)).toEqual(["pkg:npm/leftpad"]);
  });

  it("honours the sort whitelist and pagination", async () => {
    const byName = (
      await get("/products/shop/packages?sort=name&order=asc", viewerSession)
    ).json();
    expect(byName.data.map((r: any) => r.purl)).toEqual([
      "pkg:npm/express", "pkg:npm/leftpad", "pkg:npm/lodash", "pkg:npm/react",
    ]);
    const page = (
      await get("/products/shop/packages?pageSize=2&page=2", viewerSession)
    ).json();
    expect(page.data).toHaveLength(2);
    expect(page.pagination.total).toBe(4);
  });

  it("reports coverage, stale threshold and facets", async () => {
    const body = (await get("/products/shop/packages", viewerSession)).json();
    // comp1, comp2, comp3 report; comp6 is silent; comp5 (RETIRED) is out.
    expect(body.coverage).toEqual({ reporting: 3, total: 4, reachable: 7 });
    expect(body.staleThresholdDays).toBeGreaterThan(0);
    expect(body.facets.ecosystems).toEqual(["npm"]);
    expect(typeof body.data[0].lastReportedAt).toBe("string");
  });

  it("still serves the read for a RETIRED product", async () => {
    const old = await mkProduct("oldshop", "RETIRED");
    const c = await mkComponent("old-comp");
    await testDb.db
      .insertInto("product_depends_on_component")
      .values({ productId: old, componentId: c })
      .execute();
    await addEntry(c, "pkg:npm/legacy", "legacy", "1.0.0");
    const res = await get("/products/oldshop/packages", viewerSession);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((r: any) => r.purl)).toEqual(["pkg:npm/legacy"]);
  });
});
