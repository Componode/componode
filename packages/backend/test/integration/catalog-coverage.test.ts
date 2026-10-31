import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

/**
 * Spec 023 — catalog coverage & hygiene. One seeded catalog exercises the
 * whole feature surface: wired/unwired component classification, product
 * dependency surfaces (incl. recursive COMPOSES relief), completeness
 * facets, sunset-overdue attention, and consumed-by counts.
 *
 * Population expectations (clarification 2026-10-20): the coverage
 * population is the default-visible component set — ACTIVE and not
 * instances-all-GONE (zero-instance components count).
 */
describe("catalog coverage & hygiene (spec 023)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  const saved: Record<string, string | undefined> = {};

  const P = {} as Record<
    | "wired"
    | "group"
    | "emptyGroup"
    | "consumer"
    | "platform"
    | "grand"
    | "parent"
    | "child"
    | "parentDead"
    | "retiredChild"
    | "bare"
    | "retired",
    string
  >;
  const C = {} as Record<
    | "direct"
    | "groupMember"
    | "z"
    | "retiredClaimed"
    | "y"
    | "unwired"
    | "pending"
    | "retired"
    | "goneOnly",
    string
  >;

  async function mkProduct(
    slug: string,
    over: {
      type?: string;
      lifecycle?: string;
      owner?: string | null;
      description?: string | null;
      sunsetAt?: string | null;
    } = {},
  ) {
    const id = uuidv7();
    await testDb.db
      .insertInto("digital_products")
      .values({
        id,
        name: slug,
        slug,
        description: over.description === undefined ? "has a description" : over.description,
        type: over.type ?? "BUSINESS_CAPABILITY",
        lifecycle: over.lifecycle ?? "ACTIVE",
        lobOwnerId: over.owner === undefined ? null : over.owner,
        teamOwnerId: null,
        sunsetAt: over.sunsetAt ?? null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function mkComponent(
    slug: string,
    over: {
      lifecycle?: string;
      componentGroupId?: string | null;
      sunsetAt?: string | null;
    } = {},
  ) {
    const id = uuidv7();
    await testDb.db
      .insertInto("components")
      .values({
        id,
        name: slug,
        slug,
        category: "REPOSITORY",
        provider: "GITHUB",
        resourceType: "repo",
        lifecycle: over.lifecycle ?? "ACTIVE",
        componentGroupId: over.componentGroupId ?? null,
        sunsetAt: over.sunsetAt ?? null,
        details: null,
        externalId: null,
        lastSeenAt: null,
        lastSeenInRunId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function mkInstance(componentId: string, status: string) {
    await testDb.db
      .insertInto("component_instances")
      .values({
        id: uuidv7(),
        componentId,
        environment: "PRODUCTION",
        externalId: `ext-${uuidv7().slice(-6)}`,
        slug: `inst-${uuidv7().slice(-6)}`,
        url: null,
        region: null,
        status,
        version: "1.0.0",
        deployedAt: now(),
        rawConfig: null,
        lastSeenAt: now(),
        lastSeenInRunId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();
  }

  async function mkGroup(slug: string) {
    const id = uuidv7();
    await testDb.db
      .insertInto("component_groups")
      .values({
        id,
        name: slug,
        slug,
        description: null,
        lifecycle: "ACTIVE",
        teamOwnerId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function depOn(productId: string, componentId: string) {
    await testDb.db
      .insertInto("product_depends_on_component")
      .values({ productId, componentId })
      .execute();
  }

  beforeAll(async () => {
    for (const k of [
      "DATABASE_URL",
      "NODE_ENV",
      "BOOTSTRAP_ADMIN_USERNAME",
      "BOOTSTRAP_ADMIN_PASSWORD",
    ]) {
      saved[k] = process.env[k];
    }
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;

    const { bootstrapAdmin } = await import(
      "../../src/services/bootstrap-service.js"
    );
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD))!;

    // --- Seed ----------------------------------------------------------
    const lobId = uuidv7();
    await testDb.db
      .insertInto("line_of_businesses")
      .values({
        id: lobId,
        name: "Core LOB",
        slug: "core-lob",
        description: null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();

    const g1 = await mkGroup("group-one");
    const g2 = await mkGroup("group-two"); // stays empty

    // Components.
    C.direct = await mkComponent("comp-direct");
    C.groupMember = await mkComponent("comp-group-member", {
      componentGroupId: g1,
    });
    await mkInstance(C.groupMember, "RUNNING");
    C.z = await mkComponent("comp-z");
    C.retiredClaimed = await mkComponent("comp-retired-claimed");
    C.y = await mkComponent("comp-y");
    C.unwired = await mkComponent("comp-unwired", { sunsetAt: PAST });
    C.pending = await mkComponent("comp-pending");
    C.retired = await mkComponent("comp-retired", {
      lifecycle: "RETIRED",
      sunsetAt: PAST,
    });
    C.goneOnly = await mkComponent("comp-gone-only", { sunsetAt: PAST });
    await mkInstance(C.goneOnly, "GONE");

    // Products.
    P.wired = await mkProduct("p-wired", { owner: lobId, sunsetAt: PAST });
    P.group = await mkProduct("p-group", { owner: lobId });
    P.emptyGroup = await mkProduct("p-empty-group", { owner: lobId });
    P.consumer = await mkProduct("p-consumer", { owner: lobId });
    P.platform = await mkProduct("p-platform", {
      type: "PLATFORM",
      owner: lobId,
    });
    P.grand = await mkProduct("p-grand", { owner: lobId });
    P.parent = await mkProduct("p-parent", { owner: lobId });
    P.child = await mkProduct("p-child", { owner: lobId });
    P.parentDead = await mkProduct("p-parent-dead", { owner: lobId });
    P.retiredChild = await mkProduct("p-retired-child", {
      lifecycle: "RETIRED",
    });
    P.bare = await mkProduct("p-bare", {
      owner: null,
      description: null,
      sunsetAt: FUTURE,
    });
    P.retired = await mkProduct("p-retired", {
      lifecycle: "RETIRED",
      sunsetAt: PAST,
    });

    // Edges.
    await depOn(P.wired, C.direct);
    await depOn(P.wired, C.retired); // wired edge, but component is RETIRED
    await depOn(P.wired, C.goneOnly); // wired edge, but component is gone-only
    await testDb.db
      .insertInto("product_depends_on_component_group")
      .values({ productId: P.group, componentGroupId: g1 })
      .execute();
    await testDb.db
      .insertInto("product_depends_on_component_group")
      .values({ productId: P.emptyGroup, componentGroupId: g2 })
      .execute();
    await testDb.db
      .insertInto("product_consumes_from")
      .values({ consumerId: P.consumer, platformId: P.platform })
      .execute();
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId: P.grand, childId: P.parent })
      .execute();
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId: P.parent, childId: P.child })
      .execute();
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId: P.parentDead, childId: P.retiredChild })
      .execute();
    await depOn(P.child, C.z);
    await depOn(P.retiredChild, C.y);
    await depOn(P.retired, C.retiredClaimed);

    // Pending suggestion — never wires (ADR-113).
    await testDb.db
      .insertInto("edge_suggestions")
      .values({
        id: uuidv7(),
        productId: P.wired,
        componentId: C.pending,
        reason: "NAME_MATCH",
        score: 90,
        status: "PENDING",
        createdAt: now(),
        decidedAt: null,
        decidedBy: null,
      } as never)
      .execute();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const authed = () => ({ cookies: { [SESSION_COOKIE_NAME]: adminSession } });

  // Evaluated lazily — C.* is populated in beforeAll, not at describe time.
  const population = () => [
    C.direct,
    C.groupMember,
    C.z,
    C.retiredClaimed,
    C.y,
    C.unwired,
    C.pending,
  ];
  const wiredExpected = () => [C.direct, C.groupMember, C.z];
  const unwiredExpected = () => [C.retiredClaimed, C.y, C.unwired, C.pending];

  // --- T002: shared derivations ----------------------------------------

  describe("shared derivations", () => {
    it("wired set = population ∩ (direct edges ∪ group expansion from live products)", async () => {
      const { computeWiredComponentIds } = await import(
        "../../src/services/catalog-coverage-service.js"
      );
      const wired = await computeWiredComponentIds();
      expect([...wired].sort()).toEqual([...wiredExpected()].sort());
      // RETIRED + gone-only components never classify, even with edges.
      expect(wired.has(C.retired)).toBe(false);
      expect(wired.has(C.goneOnly)).toBe(false);
    });

    it("dependency surface: own edges, empty-group edges, consumes, recursive descendant relief", async () => {
      const { computeDependencySurfaces } = await import(
        "../../src/services/catalog-coverage-service.js"
      );
      const surface = await computeDependencySurfaces();
      // Own direct edge, group edge (incl. empty group), own CONSUMES_FROM.
      expect(surface.has(P.wired)).toBe(true);
      expect(surface.has(P.group)).toBe(true);
      expect(surface.has(P.emptyGroup)).toBe(true); // declared intent — empty group counts
      expect(surface.has(P.consumer)).toBe(true);
      // Recursive relief: parent (1 level) and grand (2 levels) via child's edge.
      expect(surface.has(P.parent)).toBe(true);
      expect(surface.has(P.grand)).toBe(true);
      expect(surface.has(P.child)).toBe(true);
      // No relief through a RETIRED descendant.
      expect(surface.has(P.parentDead)).toBe(false);
      // Bare product: no surface.
      expect(surface.has(P.bare)).toBe(false);
      expect(surface.has(P.platform)).toBe(false);
    });
  });

  // --- T004: dashboard coverage (US1) ------------------------------------

  describe("dashboard coverage", () => {
    it("reports coverage matching the seeded catalog", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/summary",
        ...authed(),
      });
      expect(res.statusCode).toBe(200);
      const { coverage } = res.json();
      expect(coverage.components.active).toBe(7);
      expect(coverage.components.wired).toBe(3);
      expect(coverage.components.wiredPct).toBeCloseTo(42.9, 1);
      expect(coverage.products.total).toBe(10); // RETIRED excluded
      expect(coverage.products.missingOwner).toBe(1); // p-bare
      expect(coverage.products.missingDescription).toBe(1); // p-bare
      expect(coverage.products.missingDependencies).toBe(3); // platform, parentDead, bare
    });

    it("wiredPct is null when the population is empty", async () => {
      // Retire every component → empty population → null denominator
      // (FR-003). C.retired is restored to RETIRED by the finally clause.
      await testDb.db
        .updateTable("components")
        .set({ lifecycle: "RETIRED" })
        .execute();
      try {
        const { getCatalogCoverage } = await import(
          "../../src/services/catalog-coverage-service.js"
        );
        const cov = await getCatalogCoverage();
        expect(cov.components.active).toBe(0);
        expect(cov.components.wired).toBe(0);
        expect(cov.components.wiredPct).toBeNull();
      } finally {
        await testDb.db
          .updateTable("components")
          .set({ lifecycle: "ACTIVE" })
          .where("id", "!=", C.retired)
          .execute();
      }
    });
  });

  // --- T008: coverage worklist filters (US2) ------------------------------

  describe("list filters", () => {
    async function componentIds(url: string) {
      const res = await app.inject({ method: "GET", url, ...authed() });
      expect(res.statusCode).toBe(200);
      return (res.json().data as Array<{ id: string }>).map((c) => c.id);
    }
    async function productSlugs(url: string) {
      const res = await app.inject({ method: "GET", url, ...authed() });
      expect(res.statusCode).toBe(200);
      return (res.json().products as Array<{ slug: string }>).map((p) => p.slug);
    }

    it("rejects unknown facet values with 400 VALIDATION_FAILED", async () => {
      for (const url of [
        "/api/v1/components?wired=bogus",
        "/api/v1/products?missing=bogus",
      ]) {
        const res = await app.inject({ method: "GET", url, ...authed() });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe("VALIDATION_FAILED");
      }
    });

    it("wired=unwired returns exactly the unwired default-visible set", async () => {
      const ids = await componentIds("/api/v1/components?wired=unwired");
      expect([...ids].sort()).toEqual([...unwiredExpected()].sort());
    });

    it("wired=wired returns the complement; both values = full population", async () => {
      const wiredIds = await componentIds("/api/v1/components?wired=wired");
      expect([...wiredIds].sort()).toEqual([...wiredExpected()].sort());
      const both = await componentIds("/api/v1/components?wired=wired,unwired");
      expect([...both].sort()).toEqual([...population()].sort());
    });

    it("wired filter never surfaces RETIRED or gone-only rows under toggles", async () => {
      for (const url of [
        "/api/v1/components?wired=wired&includeRetired=true",
        "/api/v1/components?wired=unwired&includeRetired=true",
        "/api/v1/components?wired=unwired&includeGone=true",
      ]) {
        const ids = await componentIds(url);
        expect(ids).not.toContain(C.retired);
        expect(ids).not.toContain(C.goneOnly);
      }
    });

    it("unwired filter count equals the dashboard unwired figure", async () => {
      const summary = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/summary",
        ...authed(),
      });
      const { coverage } = summary.json();
      const ids = await componentIds("/api/v1/components?wired=unwired");
      expect(ids.length).toBe(coverage.components.active - coverage.components.wired);
    });

    it("missing=owner|description|dependencies filter the product list", async () => {
      expect(await productSlugs("/api/v1/products?missing=owner")).toEqual(["p-bare"]);
      expect(await productSlugs("/api/v1/products?missing=description")).toEqual([
        "p-bare",
      ]);
      const dep = await productSlugs("/api/v1/products?missing=dependencies");
      expect([...dep].sort()).toEqual(
        ["p-platform", "p-parent-dead", "p-bare"].sort(),
      );
    });

    it("missing values combine with OR and compose with other filters", async () => {
      const or = await productSlugs(
        "/api/v1/products?missing=owner,description",
      );
      expect(or).toEqual(["p-bare"]);
      const withType = await productSlugs(
        "/api/v1/products?missing=dependencies&type=PLATFORM",
      );
      expect(withType).toEqual(["p-platform"]);
      const withQ = await productSlugs("/api/v1/products?missing=dependencies&q=p-par");
      expect(withQ).toEqual(["p-parent-dead"]);
    });
  });

  // --- T014: sunset-overdue attention (US3) -------------------------------

  describe("sunset attention", () => {
    it("overdue sunsets appear after all operational items with entity links", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard/summary",
        ...authed(),
      });
      const attention = res.json().attention as Array<{
        kind: string;
        href: string;
        at: string;
      }>;
      const sunsetKinds = attention.filter((a) => a.kind.startsWith("SUNSET"));
      expect(sunsetKinds.map((s) => s.kind)).toEqual(
        expect.arrayContaining([
          "SUNSET_OVERDUE_PRODUCT",
          "SUNSET_OVERDUE_COMPONENT",
        ]),
      );
      // Ranked below every operational kind.
      const lastOperational = attention.findLastIndex(
        (a) => !a.kind.startsWith("SUNSET"),
      );
      const firstSunset = attention.findIndex((a) => a.kind.startsWith("SUNSET"));
      expect(firstSunset).toBeGreaterThan(lastOperational);
      // Links and timestamps.
      const prod = attention.find((a) => a.kind === "SUNSET_OVERDUE_PRODUCT");
      expect(prod?.href).toBe("/products/p-wired");
      expect(prod?.at).toBeTruthy();
      const comp = attention.find((a) => a.kind === "SUNSET_OVERDUE_COMPONENT");
      // Attention hrefs are slug-keyed — the frontend route resolves slugs (spec 038).
      expect(comp?.href).toBe("/components/comp-unwired");
      // RETIRED entities and future sunsets produce no items.
      const hrefs = attention.map((a) => a.href);
      expect(hrefs).not.toContain("/products/p-retired");
      expect(hrefs).not.toContain("/products/p-bare");
      expect(hrefs).not.toContain(`/components/${C.retired}`);
      // Gone-only components are invisible to every coverage surface — a
      // past sunset on one produces no sunset item (its pre-existing
      // INSTANCE_GONE operational item is unrelated).
      const sunsetHrefs = sunsetKinds.map((s) => s.href);
      expect(sunsetHrefs).not.toContain(`/components/${C.goneOnly}`);
    });
  });

  // --- T017: completeness facets (US4) -------------------------------------

  describe("completeness", () => {
    it("product rows carry per-facet completeness", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/products?includeRetired=true",
        ...authed(),
      });
      const rows = res.json().products as Array<{
        slug: string;
        completeness: {
          owner: boolean;
          description: boolean;
          dependencies: boolean;
        };
      }>;
      const by = Object.fromEntries(rows.map((r) => [r.slug, r.completeness]));
      expect(by["p-wired"]).toEqual({ owner: true, description: true, dependencies: true });
      expect(by["p-empty-group"]).toEqual({ owner: true, description: true, dependencies: true });
      expect(by["p-platform"]).toEqual({ owner: true, description: true, dependencies: false });
      expect(by["p-grand"]).toEqual({ owner: true, description: true, dependencies: true });
      expect(by["p-parent-dead"]).toEqual({ owner: true, description: true, dependencies: false });
      expect(by["p-bare"]).toEqual({ owner: false, description: false, dependencies: false });
    });

    it("detail completeness matches the list row", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/products/p-parent-dead",
        ...authed(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().product.completeness).toEqual({
        owner: true,
        description: true,
        dependencies: false,
      });
    });
  });

  // --- T021: consumed-by counts (US5) ---------------------------------------

  describe("consumedByCount", () => {
    it("list rows carry CONSUMES_FROM in-degree", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/products",
        ...authed(),
      });
      const rows = res.json().products as Array<{
        slug: string;
        consumedByCount: number;
      }>;
      const by = Object.fromEntries(rows.map((r) => [r.slug, r.consumedByCount]));
      expect(by["p-platform"]).toBe(1);
      expect(by["p-wired"]).toBe(0);
      expect(by["p-consumer"]).toBe(0);
    });

    it("consumedByCount agrees with detail consumedBy.length", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/products/p-platform",
        ...authed(),
      });
      const detail = res.json();
      expect(detail.consumedBy).toHaveLength(1);
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/products",
        ...authed(),
      });
      const row = (list.json().products as Array<{ slug: string; consumedByCount: number }>).find(
        (p) => p.slug === "p-platform",
      );
      expect(row?.consumedByCount).toBe(detail.consumedBy.length);
    });
  });
});
