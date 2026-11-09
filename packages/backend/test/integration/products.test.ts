import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
  createPersonInDb,
  createSessionInDb,
} from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

async function mkProduct(
  testDb: TestDb,
  over: {
    id?: string;
    name: string;
    slug: string;
    type?: string;
    lifecycle?: string;
    description?: string | null;
    criticality?: string | null;
    lobOwnerId?: string | null;
    teamOwnerId?: string | null;
    tags?: string[];
    updatedAt?: string;
  },
) {
  const id = over.id ?? uuidv7();
  await testDb.db
    .insertInto("digital_products")
    .values({
      id,
      name: over.name,
      slug: over.slug,
      description: over.description ?? null,
      type: over.type ?? "PLATFORM",
      lifecycle: over.lifecycle ?? "ACTIVE",
      lobOwnerId: over.lobOwnerId ?? null,
      teamOwnerId: over.teamOwnerId ?? null,
      links: [],
      tags: over.tags ?? [],
      criticality: over.criticality ?? null,
      sunsetAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: over.updatedAt ?? now(),
    } as never)
    .execute();
  return id;
}

async function mkComponent(testDb: TestDb, name: string) {
  const id = uuidv7();
  await testDb.db
    .insertInto("components")
    .values({
      id,
      name,
      slug: name,
      category: "REPOSITORY",
      provider: "GITHUB",
      resourceType: "repo",
      lifecycle: "ACTIVE",
      details: null,
      componentGroupId: null,
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

describe("product hierarchy API", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let viewerSession: string | undefined;
  let editorSession: string | undefined;
  const saved: Record<string, string | undefined> = {};

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

    const viewerId = await createPersonInDb(testDb.db, {
      username: "viewer1",
      role: "VIEWER",
    });
    viewerSession = (await createSessionInDb(testDb.db, viewerId)).token;
    const editorId = await createPersonInDb(testDb.db, {
      username: "editor1",
      role: "EDITOR",
    });
    editorSession = (await createSessionInDb(testDb.db, editorId)).token;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const authed = (session?: string) => ({
    cookies: {
      [SESSION_COOKIE_NAME]: session ?? adminSession,
      ...csrfCookie,
    },
    headers: csrfHeader,
  });

  it("GET /products requires auth and returns the spec-068 envelope", async () => {
    const unauth = await app.inject({ method: "GET", url: "/api/v1/products" });
    expect(unauth.statusCode).toBe(401);

    const p1 = await mkProduct(testDb, {
      name: "Payments",
      slug: "payments",
      type: "BUSINESS_CAPABILITY",
    });
    const p2 = await mkProduct(testDb, { name: "Core", slug: "core" });
    const retired = await mkProduct(testDb, {
      name: "Old",
      slug: "old",
      lifecycle: "RETIRED",
    });
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId: p1, childId: p2 })
      .execute();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products",
      ...authed(viewerSession),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const slugs = body.data.map((p: any) => p.slug);
    expect(slugs).toContain("payments");
    expect(slugs).toContain("core");
    expect(slugs).not.toContain("old"); // RETIRED excluded by default
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 25 });
    expect(body.edges).toEqual(
      expect.arrayContaining([{ parentId: p1, childId: p2 }]),
    );

    const withRetired = await app.inject({
      method: "GET",
      url: "/api/v1/products?includeRetired=true",
      ...authed(viewerSession),
    });
    expect(
      withRetired.json().data.map((p: any) => p.slug),
    ).toContain("old");

    const filtered = await app.inject({
      method: "GET",
      url: "/api/v1/products?search=pay",
      ...authed(viewerSession),
    });
    expect(filtered.json().data).toHaveLength(1);
  });

  it("GET /products returns declared+inherited componentCount per row", async () => {
    const parent = await mkProduct(testDb, { name: "Count Parent", slug: "count-parent" });
    const child = await mkProduct(testDb, { name: "Count Child", slug: "count-child" });
    const lonely = await mkProduct(testDb, { name: "Count Lonely", slug: "count-lonely" });
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId: parent, childId: child })
      .execute();
    const ownComp = await mkComponent(testDb, "count-own");
    const childComp = await mkComponent(testDb, "count-child");
    await testDb.db
      .insertInto("product_depends_on_component")
      .values([
        { productId: parent, componentId: ownComp },
        { productId: child, componentId: childComp },
      ])
      .execute();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products",
      ...authed(viewerSession),
    });
    expect(res.statusCode).toBe(200);
    const bySlug = new Map(
      res.json().data.map((p: { slug: string; componentCount?: number }) => [p.slug, p]),
    );
    // Same semantics as the detail's counts.components: own DEPENDS_ON
    // components plus every COMPOSES descendant's, deduplicated.
    expect(bySlug.get("count-parent")?.componentCount).toBe(2);
    expect(bySlug.get("count-child")?.componentCount).toBe(1);
    expect(bySlug.get("count-lonely")?.componentCount).toBe(0);
  });

  it("POST /products creates with derived slug; duplicate slug → 409", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "Billing Engine", type: "PLATFORM" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().product.slug).toBe("billing-engine");

    const dup = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "Other", slug: "billing-engine", type: "PLATFORM" },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("SLUG_TAKEN");
  });

  it("viewer is forbidden from product mutations", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(viewerSession),
      payload: { name: "Nope", type: "PLATFORM" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /products/:slug returns detail with declared/inherited split", async () => {
    const parent = await mkProduct(testDb, {
      name: "Storefront",
      slug: "storefront",
      type: "BUSINESS_CAPABILITY",
    });
    const child = await mkProduct(testDb, {
      name: "Checkout Svc",
      slug: "checkout-svc",
    });
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId: parent, childId: child })
      .execute();
    const comp = await mkComponent(testDb, "checkout-lib");
    await testDb.db
      .insertInto("product_depends_on_component")
      .values({ productId: child, componentId: comp })
      .execute();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products/storefront",
      ...authed(viewerSession),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.composes[0].slug).toBe("checkout-svc");
    expect(body.components.inherited).toHaveLength(1);
    expect(
      body.components.inherited[0].sources.some(
        (s: { kind: string; product?: { slug: string } }) =>
          s.kind === "INHERITED" && s.product?.slug === "checkout-svc",
      ),
    ).toBe(true);

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/products/nope",
      ...authed(viewerSession),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("COMPOSES cycle → 409 CYCLE_DETECTED; PLATFORM parent → 204; self-edge → 422 (ADR-109)", async () => {
    const a = await mkProduct(testDb, {
      name: "Cap A",
      slug: "cap-a",
      type: "BUSINESS_CAPABILITY",
    });
    const b = await mkProduct(testDb, {
      name: "Cap B",
      slug: "cap-b",
      type: "BUSINESS_CAPABILITY",
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/products/${a}/composes`,
      ...authed(editorSession),
      payload: { childId: b },
    });
    const cycle = await app.inject({
      method: "POST",
      url: `/api/v1/products/${b}/composes`,
      ...authed(editorSession),
      payload: { childId: a },
    });
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json().code).toBe("CYCLE_DETECTED");

    const platform = await mkProduct(testDb, {
      name: "Plat",
      slug: "plat",
      type: "PLATFORM",
    });
    const platformParent = await app.inject({
      method: "POST",
      url: `/api/v1/products/${platform}/composes`,
      ...authed(editorSession),
      payload: { childId: b },
    });
    expect(platformParent.statusCode).toBe(204);

    const selfEdge = await app.inject({
      method: "POST",
      url: `/api/v1/products/${platform}/composes`,
      ...authed(editorSession),
      payload: { childId: platform },
    });
    expect(selfEdge.statusCode).toBe(422);
    expect(selfEdge.json().code).toBe("INVALID_EDGE_TYPE");
  });

  it("CONSUMES_FROM requires PLATFORM target; DEPENDS_ON works", async () => {
    const consumer = await mkProduct(testDb, {
      name: "Consumer",
      slug: "consumer",
      type: "CUSTOMER_FACING",
    });
    const platform = await mkProduct(testDb, {
      name: "Plat2",
      slug: "plat2",
      type: "PLATFORM",
    });
    const nonPlat = await mkProduct(testDb, {
      name: "NotPlat",
      slug: "not-plat",
      type: "BUSINESS_CAPABILITY",
    });
    const bad = await app.inject({
      method: "POST",
      url: `/api/v1/products/${consumer}/consumes-from`,
      ...authed(editorSession),
      payload: { platformId: nonPlat },
    });
    expect(bad.statusCode).toBe(422);

    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/products/${consumer}/consumes-from`,
      ...authed(editorSession),
      payload: { platformId: platform },
    });
    expect(ok.statusCode).toBe(204);

    const comp = await mkComponent(testDb, "lib-x");
    const dep = await app.inject({
      method: "POST",
      url: `/api/v1/products/${consumer}/depends-on`,
      ...authed(editorSession),
      payload: { componentId: comp },
    });
    expect(dep.statusCode).toBe(204);
  });

  it("retype to PLATFORM keeps COMPOSES children (ADR-109); CONSUMES_FROM target retype still blocked; delete guarded", async () => {
    const parent = await mkProduct(testDb, {
      name: "P",
      slug: "p-cap",
      type: "BUSINESS_CAPABILITY",
    });
    const child = await mkProduct(testDb, {
      name: "C",
      slug: "c-plat",
      type: "PLATFORM",
    });
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId: parent, childId: child })
      .execute();

    // Retype to PLATFORM is allowed now — composes edges stay valid
    const typeChange = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${parent}`,
      ...authed(editorSession),
      payload: { type: "PLATFORM" },
    });
    expect(typeChange.statusCode).toBe(200);
    const stillComposes = await testDb.db
      .selectFrom("product_composes")
      .selectAll()
      .where("parentId", "=", parent)
      .where("childId", "=", child)
      .executeTakeFirst();
    expect(stillComposes).toBeTruthy();

    // CONSUMES_FROM target rule unchanged: retyping the target away → 409
    const consumer = await mkProduct(testDb, {
      name: "Cons",
      slug: "cons-x",
      type: "BUSINESS_CAPABILITY",
    });
    await testDb.db
      .insertInto("product_consumes_from")
      .values({ consumerId: consumer, platformId: child })
      .execute();
    const targetRetype = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${child}`,
      ...authed(editorSession),
      payload: { type: "BUSINESS_CAPABILITY" },
    });
    expect(targetRetype.statusCode).toBe(409);
    expect(targetRetype.json().code).toBe("TYPE_CHANGE_BLOCKED");
    expect(JSON.stringify(targetRetype.json().details)).toContain("CONSUMES_FROM");

    const delWired = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${parent}`,
      ...authed(editorSession),
    });
    expect(delWired.statusCode).toBe(409);
    expect(delWired.json().code).toBe("REFERENCED");

    // Retire → un-retire keeps edges
    const retire = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${parent}`,
      ...authed(editorSession),
      payload: { lifecycle: "RETIRED" },
    });
    expect(retire.statusCode).toBe(200);
    const unretire = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${parent}`,
      ...authed(editorSession),
      payload: { lifecycle: "ACTIVE" },
    });
    expect(unretire.statusCode).toBe(200);

    // Remove edge then delete succeeds
    await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${parent}/composes/${child}`,
      ...authed(editorSession),
    });
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${parent}`,
      ...authed(editorSession),
    });
    expect(del.statusCode).toBe(204);
  });

  it("writes entity_changes and edge_changes audit rows", async () => {
    const name = `audit-${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name, type: "PLATFORM" },
    });
    const id = res.json().product.id;
    const rows = await testDb.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityId", "=", id)
      .execute();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].action).toBe("created");

    const other = await mkProduct(testDb, {
      name: "AuditB",
      slug: `audit-b-${Date.now()}`,
      type: "BUSINESS_CAPABILITY",
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/products/${other}/composes`,
      ...authed(editorSession),
      payload: { childId: id },
    });
    const edgeRows = await testDb.db
      .selectFrom("edge_changes")
      .selectAll()
      .where("fromEntityId", "=", other)
      .execute();
    expect(edgeRows.some((r) => r.edgeType === "COMPOSES" && r.action === "added")).toBe(true);
  });

  // Spec 059 — Product Map topology read contract: every relation family of
  // the detail read is returned with correct direction, related ProductRefs
  // carry bounded health/criticality/componentCount enrichment, and a failed
  // relation family degrades into unavailableRelationGroups.
  describe("product detail topology read (spec 059)", () => {
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

    async function mkInstance(componentId: string, status: string) {
      await testDb.db
        .insertInto("component_instances")
        .values({
          id: uuidv7(),
          componentId,
          environment: "PRODUCTION",
          externalId: `ext-${componentId.slice(0, 8)}-${status}`,
          slug: `inst-${componentId.slice(0, 8)}-${status.toLowerCase()}`,
          url: null,
          region: null,
          status,
          version: null,
          deployedAt: null,
          rawConfig: null,
          lastSeenAt: null,
          lastSeenInRunId: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now(),
          updatedAt: now(),
        } as never)
        .execute();
    }

    let fx: {
      suffix: string;
      hub: string;
      parent: string;
      child: string;
      grandchild: string;
      platform: string;
      consumer: string;
      group: string;
      emptyGroup: string;
    } | null = null;

    async function topologyFixture() {
      if (fx) return fx;
      const suffix = Date.now().toString(36);
      const mk = (name: string, type = "PLATFORM") =>
        mkProduct(testDb, { name, slug: `${name}-${suffix}`, type });
      const hub = await mk("topo-hub");
      const parent = await mk("topo-parent", "BUSINESS_CAPABILITY");
      const child = await mk("topo-child", "BUSINESS_CAPABILITY");
      const grandchild = await mk("topo-grandchild");
      const platform = await mk("topo-platform");
      const consumer = await mk("topo-consumer", "CUSTOMER_FACING");
      const group = await mkGroup(`topo-group-${suffix}`);
      const emptyGroup = await mkGroup(`topo-empty-group-${suffix}`);

      await testDb.db
        .insertInto("product_composes")
        .values([
          { parentId: parent, childId: hub },
          { parentId: hub, childId: child },
          { parentId: child, childId: grandchild },
        ])
        .execute();
      await testDb.db
        .insertInto("product_consumes_from")
        .values([
          { consumerId: hub, platformId: platform },
          { consumerId: consumer, platformId: hub },
        ])
        .execute();
      await testDb.db
        .insertInto("product_depends_on_component_group")
        .values([
          { productId: hub, componentGroupId: group },
          { productId: hub, componentGroupId: emptyGroup },
        ])
        .execute();

      // Enrichment fixtures: child has 1 direct + 1 inherited (grandchild)
      // component; consumer has 1 direct component with an ERROR instance;
      // platform carries criticality only; parent has nothing.
      const compA = await mkComponent(testDb, `topo-comp-a-${suffix}`);
      const compB = await mkComponent(testDb, `topo-comp-b-${suffix}`);
      const compC = await mkComponent(testDb, `topo-comp-c-${suffix}`);
      const compM = await mkComponent(testDb, `topo-comp-m-${suffix}`);
      await testDb.db
        .insertInto("product_depends_on_component")
        .values([
          { productId: child, componentId: compA },
          { productId: grandchild, componentId: compB },
          { productId: consumer, componentId: compC },
        ])
        .execute();
      await testDb.db
        .updateTable("components")
        .set({ componentGroupId: group })
        .where("id", "=", compM)
        .execute();
      await mkInstance(compC, "ERROR");
      await testDb.db
        .updateTable("digital_products")
        .set({ criticality: "HIGH" })
        .where("id", "=", platform)
        .execute();

      fx = { suffix, hub, parent, child, grandchild, platform, consumer, group, emptyGroup };
      return fx;
    }

    const detail = (slug: string) =>
      app.inject({
        method: "GET",
        url: `/api/v1/products/${slug}`,
        ...authed(viewerSession),
      });

    it("returns all five relation families with correct source/target direction", async () => {
      const f = await topologyFixture();
      const res = await detail(`topo-hub-${f.suffix}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const slugs = (rows: Array<{ slug: string }>) => rows.map((r) => r.slug);
      expect(slugs(body.composedBy)).toEqual([`topo-parent-${f.suffix}`]);
      expect(slugs(body.composes)).toEqual([`topo-child-${f.suffix}`]);
      expect(slugs(body.consumesFrom)).toEqual([`topo-platform-${f.suffix}`]);
      expect(slugs(body.consumedBy)).toEqual([`topo-consumer-${f.suffix}`]);
      expect(
        body.dependsOnGroups.map((g: { slug: string }) => g.slug).sort(),
      ).toEqual([`topo-empty-group-${f.suffix}`, `topo-group-${f.suffix}`]);
      const empty = body.dependsOnGroups.find(
        (g: { slug: string }) => g.slug === `topo-empty-group-${f.suffix}`,
      );
      expect(empty.memberCount).toBe(0);
      expect(empty.lifecycle).toBe("ACTIVE");
      expect(body.unavailableRelationGroups).toEqual([]);
    });

    it("enriches related ProductRefs with criticality, derived health, and componentCount", async () => {
      const f = await topologyFixture();
      const res = await detail(`topo-hub-${f.suffix}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const by = Object.fromEntries(
        [
          ...body.composedBy,
          ...body.composes,
          ...body.consumesFrom,
          ...body.consumedBy,
        ].map((r: { slug: string }) => [r.slug, r]),
      );

      // Child: 1 direct + 1 inherited (via its COMPOSES child) component.
      const child = by[`topo-child-${f.suffix}`];
      expect(child.componentCount).toBe(2);
      expect(child.health).toBeNull(); // deps exist but no instances → no data

      // Consumer: 1 direct component whose instance reports ERROR.
      const consumer = by[`topo-consumer-${f.suffix}`];
      expect(consumer.componentCount).toBe(1);
      expect(consumer.health?.status).toBe("ERROR");
      expect(consumer.health?.sourceCount).toBe(1);

      // Platform: criticality passthrough, no deps → zero count, null health.
      const platform = by[`topo-platform-${f.suffix}`];
      expect(platform.criticality).toBe("HIGH");
      expect(platform.componentCount).toBe(0);
      expect(platform.health).toBeNull();

      // Parent inherits components from its whole COMPOSES subtree
      // (hub's group member + child + grandchild) — declared/inherited count.
      const parent = by[`topo-parent-${f.suffix}`];
      expect(parent.componentCount).toBe(3);
      expect(parent.health).toBeNull();
    });

    it("keeps a RETIRED related product visible with its lifecycle", async () => {
      const f = await topologyFixture();
      await testDb.db
        .updateTable("digital_products")
        .set({ lifecycle: "RETIRED" })
        .where("id", "=", f.consumer)
        .execute();
      try {
        const res = await detail(`topo-hub-${f.suffix}`);
        expect(res.statusCode).toBe(200);
        const consumer = res
          .json()
          .consumedBy.find((r: { slug: string }) => r.slug === `topo-consumer-${f.suffix}`);
        expect(consumer).toBeDefined();
        expect(consumer.lifecycle).toBe("RETIRED");
      } finally {
        await testDb.db
          .updateTable("digital_products")
          .set({ lifecycle: "ACTIVE" })
          .where("id", "=", f.consumer)
          .execute();
      }
    });

    // Isolated family failures can't be simulated at schema level — every
    // edge table is shared with the dependency-surface read (a missing table
    // correctly 500s the whole read). The degradation mechanism itself is
    // covered by the readRelationFamily unit test; the response contract
    // (unavailableRelationGroups) is asserted on the happy path above.
  });

  // Spec 068 / ADR-130: standardized list contract — {data, pagination}
  // envelope, page/pageSize/sort/order/search params, SQL `missing` facets,
  // page-scoped enrichments, and page-scoped `edges`. Fixtures use unique
  // `lst*` slug prefixes + `search=` scoping so the shared seeded catalog
  // never leaks into assertions.
  describe("spec 068 — standardized list contract", () => {
    const get = (qs = "") =>
      app.inject({
        method: "GET",
        url: `/api/v1/products${qs}`,
        ...authed(viewerSession),
      });
    const slugs = (body: any) => body.data.map((p: any) => p.slug);

    async function mkTeam(id: string, name: string) {
      await testDb.db
        .insertInto("teams")
        .values({
          id,
          name,
          slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          description: null,
          lobId: null,
          createdAt: now(),
          updatedAt: now(),
        } as never)
        .execute();
      return id;
    }

    async function mkLob(id: string, name: string) {
      await testDb.db
        .insertInto("line_of_businesses")
        .values({
          id,
          name,
          slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          description: null,
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
          externalId: `lst-${uuidv7().slice(-8)}`,
          slug: `lst-inst-${uuidv7().slice(-8)}`,
          url: null,
          region: null,
          status,
          version: null,
          deployedAt: null,
          rawConfig: null,
          lastSeenAt: null,
          lastSeenInRunId: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now(),
          updatedAt: now(),
        } as never)
        .execute();
    }

    const IDS = {
      p0: "018f0000-0000-7e10-e000-000000000011",
      p1: "018f0000-0000-7e10-e000-000000000012",
      p2: "018f0000-0000-7e10-e000-000000000013",
      p3: "018f0000-0000-7e10-e000-000000000014",
      p4: "018f0000-0000-7e10-e000-000000000015",
    } as const;

    beforeAll(async () => {
      // --- lstpg: pagination/envelope/enrichment/edges fixture -----------
      // NB: the team name must not contain any `lst*` search prefix — owner
      // names are searchable, so "Lstpg Team" would leak lstmiss-owned into
      // search=lstpg results.
      const pgTeam = await mkTeam(
        "018f0000-0000-7e10-e100-000000000001",
        "Catalog Team",
      );
      const pg = [
        await mkProduct(testDb, {
          id: IDS.p0, name: "Lstpg 0", slug: "lstpg-0", type: "CUSTOMER_FACING",
        }),
        await mkProduct(testDb, {
          id: IDS.p1, name: "Lstpg 1", slug: "lstpg-1",
        }),
        await mkProduct(testDb, {
          id: IDS.p2, name: "Lstpg 2", slug: "lstpg-2",
        }),
        await mkProduct(testDb, {
          id: IDS.p3,
          name: "Lstpg 3",
          slug: "lstpg-3",
          type: "PLATFORM",
          criticality: "HIGH",
          description: "lstpg enrichment target",
          teamOwnerId: pgTeam,
        }),
        await mkProduct(testDb, {
          id: IDS.p4, name: "Lstpg 4", slug: "lstpg-4",
        }),
      ];
      const [p0, , p2, p3, p4] = pg;

      // dep-child is NOT matched by search=lstpg (no "lstpg" in its fields)
      // but its DEPENDS_ON edge still feeds p3's inherited componentCount.
      const depChild = await mkProduct(testDb, {
        name: "dep-child-prod",
        slug: "dep-child-prod",
      });
      const compErr = await mkComponent(testDb, "lstpg-err-comp");
      const compOk = await mkComponent(testDb, "lstpg-ok-comp");
      await mkInstance(compErr, "ERROR");
      await testDb.db
        .insertInto("product_composes")
        .values([
          { parentId: p0, childId: pg[1] }, // same page (1)
          { parentId: p2, childId: p3 }, // same page (2)
          { parentId: p0, childId: p4 }, // cross-page — never returned
          { parentId: p3, childId: depChild }, // child not on any page
        ])
        .execute();
      await testDb.db
        .insertInto("product_consumes_from")
        .values({ consumerId: p0, platformId: p3 })
        .execute();
      await testDb.db
        .insertInto("product_depends_on_component")
        .values([
          { productId: p3, componentId: compErr },
          { productId: depChild, componentId: compOk },
        ])
        .execute();

      // --- lstsort: one product per sort dimension ------------------------
      const teamA = await mkTeam(
        "018f0000-0000-7e10-e100-000000000002",
        "Alpha Team",
      );
      const teamZ = await mkTeam(
        "018f0000-0000-7e10-e100-000000000003",
        "Zeta Team",
      );
      const lobA = await mkLob(
        "018f0000-0000-7e10-e200-000000000001",
        "Alpha Lob",
      );
      const lobZ = await mkLob(
        "018f0000-0000-7e10-e200-000000000002",
        "Zeta Lob",
      );
      const T = [
        "2026-01-01T00:00:00.000Z",
        "2026-02-01T00:00:00.000Z",
        "2026-03-01T00:00:00.000Z",
        "2026-04-01T00:00:00.000Z",
      ];
      const sortIds = [
        "018f0000-0000-7e10-e000-000000000021",
        "018f0000-0000-7e10-e000-000000000022",
        "018f0000-0000-7e10-e000-000000000023",
        "018f0000-0000-7e10-e000-000000000024",
        "018f0000-0000-7e10-e000-000000000025",
      ];
      await mkProduct(testDb, {
        id: sortIds[0], name: "lstsort-alpha", slug: "lstsort-alpha",
        type: "BUSINESS_CAPABILITY", criticality: "LOW",
        teamOwnerId: teamZ, updatedAt: T[0],
      });
      await mkProduct(testDb, {
        id: sortIds[1], name: "lstsort-bravo", slug: "lstsort-bravo",
        type: "CUSTOMER_FACING", criticality: "HIGH",
        lobOwnerId: lobA, updatedAt: T[2],
      });
      await mkProduct(testDb, {
        id: sortIds[2], name: "lstsort-charlie", slug: "lstsort-charlie",
        type: "PLATFORM", criticality: null,
        teamOwnerId: teamA, lobOwnerId: lobZ, updatedAt: T[1],
      });
      await mkProduct(testDb, {
        id: sortIds[3], name: "lstsort-delta", slug: "lstsort-delta",
        type: "BUSINESS_CAPABILITY", criticality: "CRITICAL",
        updatedAt: T[0],
      });
      await mkProduct(testDb, {
        id: sortIds[4], name: "lstsort-echo", slug: "lstsort-echo",
        type: "CUSTOMER_FACING", criticality: "MEDIUM",
        teamOwnerId: teamA, updatedAt: T[3],
      });

      // --- lstsearch: one product per searchable field --------------------
      const needleTeam = await mkTeam(
        "018f0000-0000-7e10-e100-000000000004",
        "Needleowner Team",
      );
      await mkProduct(testDb, {
        name: "lstsearch-namehit", slug: "lstsearch-namehit",
      });
      await mkProduct(testDb, {
        name: "lstsearch-beta-svc", slug: "lstsearch-slugonly-needle",
      });
      await mkProduct(testDb, {
        name: "lstsearch-gamma-svc", slug: "lstsearch-gamma-svc",
        description: "the needle-desc text",
      });
      await mkProduct(testDb, {
        name: "lstsearch-delta-svc", slug: "lstsearch-delta-svc",
        tags: ["lstsearch-needle-tag"],
      });
      await mkProduct(testDb, {
        name: "lstsearch-epsilon-svc", slug: "lstsearch-epsilon-svc",
        teamOwnerId: needleTeam,
      });

      // --- lstmiss: SQL missing facets ------------------------------------
      const missOwned = await mkProduct(testDb, {
        name: "lstmiss-owned", slug: "lstmiss-owned",
        description: "has description",
        teamOwnerId: pgTeam,
      });
      await mkProduct(testDb, {
        name: "lstmiss-bare", slug: "lstmiss-bare",
      });
      const missComp = await mkComponent(testDb, "lstmiss-comp");
      await testDb.db
        .insertInto("product_depends_on_component")
        .values({ productId: missOwned, componentId: missComp })
        .execute();

      // --- lstlife: explicit lifecycle overrides default exclusion --------
      await mkProduct(testDb, {
        name: "lstlife-new", slug: "lstlife-new",
      });
      await mkProduct(testDb, {
        name: "lstlife-old", slug: "lstlife-old", lifecycle: "RETIRED",
      });
    }, 60_000);

    it("computes the pagination envelope across pages", async () => {
      const p1 = await get("?search=lstpg&page=1&pageSize=2");
      expect(p1.statusCode).toBe(200);
      const b1 = p1.json();
      expect(b1.data).toHaveLength(2);
      expect(b1.pagination).toMatchObject({
        page: 1, pageSize: 2, total: 5, pageCount: 3, hasNext: true,
      });
      expect(slugs(b1)).toEqual(["lstpg-0", "lstpg-1"]);

      const p2 = await get("?search=lstpg&page=2&pageSize=2");
      const b2 = p2.json();
      expect(b2.data).toHaveLength(2);
      expect(b2.pagination).toMatchObject({
        page: 2, pageSize: 2, total: 5, pageCount: 3, hasNext: true,
      });
      expect(slugs(b2)).toEqual(["lstpg-2", "lstpg-3"]);
      // Pages must not overlap.
      expect(b2.data.map((p: any) => p.id)).not.toEqual(
        expect.arrayContaining(b1.data.map((p: any) => p.id)),
      );

      const p3 = await get("?search=lstpg&page=3&pageSize=2");
      const b3 = p3.json();
      expect(b3.data).toHaveLength(1);
      expect(b3.pagination.hasNext).toBe(false);
      expect(slugs(b3)).toEqual(["lstpg-4"]);

      // Contract default page size is 25.
      const def = (await get("?search=lstpg")).json();
      expect(def.pagination.pageSize).toBe(25);
      expect(def.data).toHaveLength(5);
    });

    it("rejects invalid pagination, sort, and unknown params with 400", async () => {
      for (const qs of [
        "?page=0",
        "?page=-1",
        "?page=abc",
        "?pageSize=0",
        "?pageSize=101",
        "?sort=bogus",
        "?sort=health", // app-computed — not whitelisted
        "?sort=components",
        "?sort=completeness",
        "?order=sideways",
        "?bogusParam=1",
        "?q=legacy-param", // renamed to `search` — strict schema rejects
      ]) {
        const res = await get(qs);
        expect(res.statusCode, qs).toBe(400);
        expect(res.json().code).toBe("VALIDATION_FAILED");
      }
    });

    it("sorts by every whitelisted key with a deterministic id tiebreak", async () => {
      const sort = async (qs: string) => slugs((await get(`?search=lstsort${qs}`)).json());

      expect(await sort("&sort=name&order=asc")).toEqual([
        "lstsort-alpha", "lstsort-bravo", "lstsort-charlie", "lstsort-delta", "lstsort-echo",
      ]);
      expect(await sort("&sort=name&order=desc")).toEqual([
        "lstsort-echo", "lstsort-delta", "lstsort-charlie", "lstsort-bravo", "lstsort-alpha",
      ]);
      // type: BUSINESS_CAPABILITY{alpha,delta} < CUSTOMER_FACING{bravo,echo} < PLATFORM{charlie}
      expect(await sort("&sort=type&order=asc")).toEqual([
        "lstsort-alpha", "lstsort-delta", "lstsort-bravo", "lstsort-echo", "lstsort-charlie",
      ]);
      // criticality alpha-sort: CRITICAL < HIGH < LOW < MEDIUM < NULL last
      expect(await sort("&sort=criticality&order=asc")).toEqual([
        "lstsort-delta", "lstsort-bravo", "lstsort-alpha", "lstsort-echo", "lstsort-charlie",
      ]);
      // updated: T1{alpha,delta id-tie} < T2{charlie} < T3{bravo} < T4{echo}
      expect(await sort("&sort=updated&order=asc")).toEqual([
        "lstsort-alpha", "lstsort-delta", "lstsort-charlie", "lstsort-bravo", "lstsort-echo",
      ]);
      // owner → teams.name (the Owner cell's primary value; LOB-only owners
      // sort as unowned/NULL): "Alpha Team"{charlie,echo} < "Zeta Team"{alpha}
      // < NULL{bravo — LOB-only, delta}.
      expect(await sort("&sort=owner&order=asc")).toEqual([
        "lstsort-charlie", "lstsort-echo", "lstsort-alpha", "lstsort-bravo", "lstsort-delta",
      ]);
      expect(await sort("&sort=owner&order=desc")).toEqual([
        "lstsort-delta", "lstsort-bravo", "lstsort-alpha", "lstsort-echo", "lstsort-charlie",
      ]);
    });

    it("searches name, slug, description, tags, and owner names", async () => {
      const find = async (qs: string) =>
        slugs((await get(`?${qs}`)).json());

      expect(await find("search=lstsearch-namehit")).toEqual(["lstsearch-namehit"]);
      // slug-only match: term appears in slug, not name.
      expect(await find("search=slugonly-needle")).toEqual(["lstsearch-slugonly-needle"]);
      // description match, case-insensitive.
      expect(await find("search=NEEDLE-DESC")).toEqual(["lstsearch-gamma-svc"]);
      // tags unnest match.
      expect(await find("search=lstsearch-needle-tag")).toEqual(["lstsearch-delta-svc"]);
      // joined owner (team) name match.
      expect(await find("search=needleowner")).toEqual(["lstsearch-epsilon-svc"]);
      expect(await find("search=qqq-zzz-absent")).toEqual([]);
    });

    it("applies missing facets as SQL predicates inside the page query", async () => {
      // lstmiss-owned has owner+description+dependencies; lstmiss-bare has none.
      expect(slugs((await get("?search=lstmiss&missing=owner")).json()))
        .toEqual(["lstmiss-bare"]);
      expect(slugs((await get("?search=lstmiss&missing=description")).json()))
        .toEqual(["lstmiss-bare"]);
      expect(slugs((await get("?search=lstmiss&missing=dependencies")).json()))
        .toEqual(["lstmiss-bare"]);
      // OR semantics + envelope total reflects the filtered set.
      const body = (await get("?search=lstmiss&missing=owner,dependencies&pageSize=1")).json();
      expect(body.pagination.total).toBe(1);
      expect(slugs(body)).toEqual(["lstmiss-bare"]);
      // Rows still carry per-facet completeness on the filtered page.
      expect(body.data[0].completeness).toEqual({
        owner: false, description: false, dependencies: false,
      });
    });

    it("enriches page-2 rows with health, counts, consumedBy, and completeness", async () => {
      const res = await get("?search=lstpg&page=2&pageSize=2");
      const body = res.json();
      const target = body.data.find((p: any) => p.slug === "lstpg-3");
      expect(target).toBeTruthy();
      // Own DEPENDS_ON edge → ERROR instance; inherited deps never feed health.
      expect(target.status).toBe("ERROR");
      // Declared+inherited: own compErr + dep-child's compOk.
      expect(target.componentCount).toBe(2);
      // CONSUMES_FROM in-degree from lstpg-0.
      expect(target.consumedByCount).toBe(1);
      expect(target.completeness).toEqual({
        owner: true, description: true, dependencies: true,
      });
      // A page-1 row without deps stays null/zero — enrichment is per-row.
      const p1 = (await get("?search=lstpg&page=1&pageSize=2")).json();
      const plain = p1.data.find((p: any) => p.slug === "lstpg-1");
      expect(plain.status).toBeNull();
      expect(plain.componentCount).toBe(0);
      expect(plain.consumedByCount).toBe(0);
    });

    it("scopes edges to product ids on the same page", async () => {
      const p1 = (await get("?search=lstpg&page=1&pageSize=2")).json();
      // p0→p1 both on page 1; p0→p4 crosses pages (never returned);
      // p3→dep-child's child isn't a listed row.
      expect(p1.edges).toEqual([{ parentId: IDS.p0, childId: IDS.p1 }]);

      const p2 = (await get("?search=lstpg&page=2&pageSize=2")).json();
      expect(p2.edges).toEqual([{ parentId: IDS.p2, childId: IDS.p3 }]);

      const p3 = (await get("?search=lstpg&page=3&pageSize=2")).json();
      expect(p3.edges).toEqual([]);
    });

    it("explicit lifecycle overrides the default RETIRED exclusion", async () => {
      expect(slugs((await get("?search=lstlife")).json()))
        .toEqual(["lstlife-new"]);
      expect(slugs((await get("?search=lstlife&lifecycle=RETIRED")).json()))
        .toEqual(["lstlife-old"]);
      expect(
        slugs((await get("?search=lstlife&includeRetired=true")).json()).sort(),
      ).toEqual(["lstlife-new", "lstlife-old"]);
    });
  });
});
