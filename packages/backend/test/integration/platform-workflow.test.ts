import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
} from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

/**
 * Spec 020 / ADR-017: Platform Product workflow — detection surfaces
 * components with direct DEPENDS_ON edges from ≥2 distinct non-RETIRED
 * products; promotion atomically creates a PLATFORM product, wires its
 * DEPENDS_ON edge, and rewrites selected consumer edges to CONSUMES_FROM.
 */
describe("platform product workflow", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
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
    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const authed = () => ({
    cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
    headers: csrfHeader,
  });

  async function mkProduct(slug: string, type = "BUSINESS_CAPABILITY") {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(),
      payload: { name: slug, slug, type },
    });
    expect(res.statusCode).toBe(201);
    return res.json().product.id as string;
  }

  async function mkComponent(
    slug: string,
    over: { lifecycle?: string; componentGroupId?: string | null } = {},
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
        details: null,
        componentGroupId: over.componentGroupId ?? null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function mkGroup(slug: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/component-groups",
      ...authed(),
      payload: { name: slug, slug },
    });
    expect(res.statusCode).toBe(201);
    return res.json().group.id as string;
  }

  async function addDep(productId: string, payload: unknown) {
    return app.inject({
      method: "POST",
      url: `/api/v1/products/${productId}/depends-on`,
      ...authed(),
      payload,
    });
  }

  async function candidates() {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components/platform-candidates",
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    return res.json().candidates as Array<{
      component: { id: string; name: string; slug: string };
      dependerCount: number;
      dependents: Array<{ id: string; name: string; slug: string; type: string }>;
    }>;
  }

  describe("GET /components/platform-candidates", () => {
    it("lists a component with direct edges from ≥2 active products, with dependents", async () => {
      const compId = await mkComponent("cand-shared");
      const p1 = await mkProduct("cand-p1");
      const p2 = await mkProduct("cand-p2");
      await addDep(p1, { componentId: compId });
      await addDep(p2, { componentId: compId });

      const list = await candidates();
      const entry = list.find((c) => c.component.id === compId);
      expect(entry).toBeDefined();
      expect(entry!.dependerCount).toBe(2);
      expect(entry!.dependents.map((d) => d.id).sort()).toEqual(
        [p1, p2].sort(),
      );
      expect(entry!.dependents[0]).toEqual(
        expect.objectContaining({ name: expect.any(String), slug: expect.any(String), type: expect.any(String) }),
      );
    });

    it("does not list components below the threshold", async () => {
      const compId = await mkComponent("cand-solo");
      const p1 = await mkProduct("cand-solo-p");
      await addDep(p1, { componentId: compId });

      const list = await candidates();
      expect(list.find((c) => c.component.id === compId)).toBeUndefined();
    });

    it("excludes RETIRED dependents and RETIRED components", async () => {
      const retiredComp = await mkComponent("cand-retired-comp", {
        lifecycle: "RETIRED",
      });
      const pa = await mkProduct("cand-ret-a");
      const pb = await mkProduct("cand-ret-b");
      await addDep(pa, { componentId: retiredComp });
      await addDep(pb, { componentId: retiredComp });

      // Active component whose second depender is RETIRED → count 1.
      const compId = await mkComponent("cand-retired-dep");
      const pc = await mkProduct("cand-ret-c");
      const pd = await mkProduct("cand-ret-d");
      await addDep(pc, { componentId: compId });
      await addDep(pd, { componentId: compId });
      await app.inject({
        method: "PATCH",
        url: `/api/v1/products/${pd}`,
        ...authed(),
        payload: { lifecycle: "RETIRED" },
      });

      const list = await candidates();
      expect(list.find((c) => c.component.id === retiredComp)).toBeUndefined();
      expect(list.find((c) => c.component.id === compId)).toBeUndefined();
    });

    it("does not count group-edge reach — only direct edges", async () => {
      const compId = await mkComponent("cand-group-only");
      const groupId = await mkGroup("cand-group");
      // Put the component in the group; the group's edge expands to it at read.
      const member = await mkComponent("cand-group-member", {
        componentGroupId: groupId,
      });
      void member;
      const p1 = await mkProduct("cand-grp-p1");
      const p2 = await mkProduct("cand-grp-p2");
      await addDep(p1, { componentGroupId: groupId });
      await addDep(p2, { componentGroupId: groupId });
      // The member is reached by 2 products via the group — must NOT qualify.
      const compInGroup = member;

      const list = await candidates();
      expect(list.find((c) => c.component.id === compInGroup)).toBeUndefined();
      expect(list.find((c) => c.component.id === compId)).toBeUndefined();
    });

    it("counts PLATFORM-type dependents like any product", async () => {
      const compId = await mkComponent("cand-plat-dep");
      const plat = await mkProduct("cand-plat", "PLATFORM");
      const biz = await mkProduct("cand-biz");
      await addDep(plat, { componentId: compId });
      await addDep(biz, { componentId: compId });

      const list = await candidates();
      const entry = list.find((c) => c.component.id === compId);
      expect(entry?.dependerCount).toBe(2);
    });

    it("orders by dependerCount desc, then component name", async () => {
      const many = await mkComponent("cand-ord-many");
      const few = await mkComponent("cand-ord-few");
      const [a, b, c] = [
        await mkProduct("ord-a"),
        await mkProduct("ord-b"),
        await mkProduct("ord-c"),
      ];
      await addDep(a, { componentId: many });
      await addDep(b, { componentId: many });
      await addDep(c, { componentId: many });
      await addDep(a, { componentId: few });
      await addDep(b, { componentId: few });

      const list = await candidates();
      const idxMany = list.findIndex((c) => c.component.id === many);
      const idxFew = list.findIndex((c) => c.component.id === few);
      expect(idxMany).toBeGreaterThanOrEqual(0);
      expect(idxFew).toBeGreaterThanOrEqual(0);
      expect(idxMany).toBeLessThan(idxFew);
    });

    it("returns an empty list when nothing qualifies", async () => {
      // Fresh DB state may have other fixtures — assert shape only.
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/components/platform-candidates",
        ...authed(),
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().candidates)).toBe(true);
      // The route is the static candidates route, not /components/:id —
      // a component-shaped response would have `component`, not `candidates`.
      expect(res.json().component).toBeUndefined();
    });

    it("requires authentication", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/components/platform-candidates",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  async function viewerSession() {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      ...authed(),
      payload: {
        username: `viewer-${crypto.randomUUID().slice(0, 8)}`,
        password: "ViewerPass123!",
        role: "VIEWER",
      },
    });
    expect(res.statusCode).toBe(201);
    return loginAs(app, res.json().user.username, "ViewerPass123!");
  }

  const authedAs = (session: string) => ({
    cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
    headers: csrfHeader,
  });

  async function directDeps(componentId: string) {
    return testDb.db
      .selectFrom("product_depends_on_component")
      .select(["productId"])
      .where("componentId", "=", componentId)
      .execute();
  }

  async function consumesEdges(platformId: string) {
    return testDb.db
      .selectFrom("product_consumes_from")
      .select(["consumerId"])
      .where("platformId", "=", platformId)
      .execute();
  }

  describe("GET /components/:id/dependents", () => {
    it("returns each active direct consumer, name-ordered", async () => {
      const compId = await mkComponent("dep-comp");
      const pb = await mkProduct("dep-b");
      const pa = await mkProduct("dep-a");
      await addDep(pb, { componentId: compId });
      await addDep(pa, { componentId: compId });

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/components/${compId}/dependents`,
        ...authed(),
      });
      expect(res.statusCode).toBe(200);
      const deps = res.json().dependents;
      expect(deps.map((d: { id: string }) => d.id)).toEqual([pa, pb]);
      expect(deps[0]).toEqual(
        expect.objectContaining({
          name: "dep-a",
          slug: "dep-a",
          type: "BUSINESS_CAPABILITY",
        }),
      );
    });

    it("excludes RETIRED products and group-only reach", async () => {
      const compId = await mkComponent("dep-retired");
      const groupId = await mkGroup("dep-grp");
      const member = await mkComponent("dep-grp-member", {
        componentGroupId: groupId,
      });
      const pRetired = await mkProduct("dep-ret-p");
      const pGroup = await mkProduct("dep-grp-p");
      await addDep(pRetired, { componentId: compId });
      await app.inject({
        method: "PATCH",
        url: `/api/v1/products/${pRetired}`,
        ...authed(),
        payload: { lifecycle: "RETIRED" },
      });
      await addDep(pGroup, { componentGroupId: groupId });

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/components/${compId}/dependents`,
        ...authed(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().dependents).toEqual([]);

      // Group-only reach on the member also yields [].
      const res2 = await app.inject({
        method: "GET",
        url: `/api/v1/components/${member}/dependents`,
        ...authed(),
      });
      expect(res2.json().dependents).toEqual([]);
    });

    it("returns 404 for an unknown component", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/components/${uuidv7()}/dependents`,
        ...authed(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
    });

    it("is readable by any authenticated role, including VIEWER", async () => {
      const compId = await mkComponent("dep-viewer");
      const session = await viewerSession();
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/components/${compId}/dependents`,
        ...authedAs(session!),
      });
      expect(res.statusCode).toBe(200);
    });

    it("requires authentication", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/components/${uuidv7()}/dependents`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /components/:id/promote-to-platform", () => {
    async function promote(componentId: string, payload: unknown = {}) {
      return app.inject({
        method: "POST",
        url: `/api/v1/components/${componentId}/promote-to-platform`,
        ...authed(),
        payload,
      });
    }

    it("happy path — PLATFORM product, edge wiring, rewrite, audit", async () => {
      const compId = await mkComponent("promo-happy");
      const c1 = await mkProduct("promo-c1");
      const c2 = await mkProduct("promo-c2");
      await addDep(c1, { componentId: compId });
      await addDep(c2, { componentId: compId });

      const res = await promote(compId, { name: "Payments Platform" });
      expect(res.statusCode).toBe(201);
      const { product, consumers } = res.json();
      expect(product.type).toBe("PLATFORM");
      expect(product.lifecycle).toBe("ACTIVE");
      expect(product.name).toBe("Payments Platform");
      expect(product.slug).toBe("payments-platform");
      expect(consumers.map((c: { id: string }) => c.id).sort()).toEqual(
        [c1, c2].sort(),
      );

      // Platform → component DEPENDS_ON edge exists.
      const deps = await directDeps(compId);
      expect(deps.map((d) => d.productId)).toEqual([product.id]);

      // Consumers now CONSUMES_FROM the platform.
      const consumes = await consumesEdges(product.id);
      expect(consumes.map((c) => c.consumerId).sort()).toEqual(
        [c1, c2].sort(),
      );

      // Audit: entity created + edge changes.
      const entityChanges = await testDb.db
        .selectFrom("entity_changes")
        .select(["action", "entityType", "entityId"])
        .where("entityId", "=", product.id)
        .execute();
      expect(entityChanges).toContainEqual({
        action: "created",
        entityType: "digital_product",
        entityId: product.id,
      });

      const edgeChanges = await testDb.db
        .selectFrom("edge_changes")
        .select(["edgeType", "fromEntityId", "toEntityId", "action"])
        .where("toEntityId", "in", [compId, product.id])
        .execute();
      // Platform's DEPENDS_ON_COMPONENT added.
      expect(edgeChanges).toContainEqual({
        edgeType: "DEPENDS_ON_COMPONENT",
        fromEntityId: product.id,
        toEntityId: compId,
        action: "added",
      });
      // Per-consumer removed DEPENDS_ON + added CONSUMES_FROM.
      for (const cid of [c1, c2]) {
        expect(edgeChanges).toContainEqual({
          edgeType: "DEPENDS_ON_COMPONENT",
          fromEntityId: cid,
          toEntityId: compId,
          action: "removed",
        });
        expect(edgeChanges).toContainEqual({
          edgeType: "CONSUMES_FROM",
          fromEntityId: cid,
          toEntityId: product.id,
          action: "added",
        });
      }
    });

    it("consumerIds subset — unchecked consumer keeps its direct edge", async () => {
      const compId = await mkComponent("promo-subset");
      const keep = await mkProduct("promo-keep");
      const move = await mkProduct("promo-move");
      await addDep(keep, { componentId: compId });
      await addDep(move, { componentId: compId });

      const res = await promote(compId, { consumerIds: [move] });
      expect(res.statusCode).toBe(201);
      const { product, consumers } = res.json();
      expect(consumers.map((c: { id: string }) => c.id)).toEqual([move]);

      const deps = await directDeps(compId);
      expect(deps.map((d) => d.productId).sort()).toEqual(
        [keep, product.id].sort(),
      );
      const consumes = await consumesEdges(product.id);
      expect(consumes.map((c) => c.consumerId)).toEqual([move]);
    });

    it("stale consumerIds fail before any writes", async () => {
      const compId = await mkComponent("promo-stale");
      const p = await mkProduct("promo-stale-p");
      await addDep(p, { componentId: compId });
      const bogus = uuidv7();
      const countProducts = async () =>
        Number(
          (
            await testDb.db
              .selectFrom("digital_products")
              .select((eb) => eb.fn.countAll().as("n"))
              .executeTakeFirstOrThrow()
          ).n,
        );
      const before = await countProducts();

      const res = await promote(compId, { consumerIds: [p, bogus] });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
      expect(res.json().details.offendingIds).toContain(bogus);

      // Zero writes: no product inserted, edges untouched.
      expect(await countProducts()).toBe(before);
      const deps = await directDeps(compId);
      expect(deps.map((d) => d.productId)).toEqual([p]);
      const consumes = await testDb.db
        .selectFrom("product_consumes_from")
        .select("consumerId")
        .where("consumerId", "=", p)
        .execute();
      expect(consumes).toEqual([]);
    });

    it("rejects a RETIRED component with 409 CONFLICT", async () => {
      const compId = await mkComponent("promo-retired", {
        lifecycle: "RETIRED",
      });
      const res = await promote(compId);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("CONFLICT");
    });

    it("explicit slug collision → 409 SLUG_TAKEN; derived collision → -2 suffix", async () => {
      await mkProduct("taken-slug");

      const comp1 = await mkComponent("promo-slug-explicit");
      const res1 = await promote(comp1, {
        name: "Explicit",
        slug: "taken-slug",
      });
      expect(res1.statusCode).toBe(409);
      expect(res1.json().code).toBe("SLUG_TAKEN");

      const comp2 = await mkComponent("promo-slug-derived");
      const res2 = await promote(comp2, { name: "Taken Slug" });
      expect(res2.statusCode).toBe(201);
      expect(res2.json().product.slug).toBe("taken-slug-2");
    });

    it("promotes a component with zero consumers", async () => {
      const compId = await mkComponent("promo-zero");
      const res = await promote(compId, { name: "Lonely Platform" });
      expect(res.statusCode).toBe(201);
      expect(res.json().consumers).toEqual([]);
      expect(res.json().product.type).toBe("PLATFORM");
    });

    it("returns 404 for an unknown component", async () => {
      const res = await promote(uuidv7());
      expect(res.statusCode).toBe(404);
    });

    it("rejects VIEWER with 403 AUTH_FORBIDDEN", async () => {
      const compId = await mkComponent("promo-viewer");
      const session = await viewerSession();
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/components/${compId}/promote-to-platform`,
        ...authedAs(session!),
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("AUTH_FORBIDDEN");
    });

    it("rejects unknown body fields (strict schema)", async () => {
      const compId = await mkComponent("promo-strict");
      const res = await promote(compId, { type: "PLATFORM", nope: true });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });

    it("a consumer reaching the component via a group edge keeps it after rewrite", async () => {
      const compId = await mkComponent("promo-grp-member");
      const groupId = await mkGroup("promo-grp");
      // Put the promoted component inside the group.
      await testDb.db
        .updateTable("components")
        .set({ componentGroupId: groupId })
        .where("id", "=", compId)
        .execute();
      const consumer = await mkProduct("promo-grp-consumer");
      await addDep(consumer, { componentId: compId });
      await addDep(consumer, { componentGroupId: groupId });

      const res = await promote(compId);
      expect(res.statusCode).toBe(201);

      // Direct edge rewritten, group edge untouched.
      const groupEdges = await testDb.db
        .selectFrom("product_depends_on_component_group")
        .select(["productId", "componentGroupId"])
        .where("productId", "=", consumer)
        .execute();
      expect(groupEdges).toEqual([
        { productId: consumer, componentGroupId: groupId },
      ]);
      const deps = await directDeps(compId);
      expect(deps.map((d) => d.productId)).toEqual([
        res.json().product.id,
      ]);

      // Consumer detail still resolves the component via the group edge.
      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/products/promo-grp-consumer`,
        ...authed(),
      });
      const declared = detail.json().components.declared as Array<{
        id: string;
        sources: Array<{ kind: string }>;
      }>;
      const reached = declared.find((d) => d.id === compId);
      expect(reached).toBeDefined();
      expect(reached!.sources.map((s) => s.kind)).toContain("GROUP");
    });

    it("fully rewritten component drops off the candidate list", async () => {
      const compId = await mkComponent("promo-dropoff");
      const c1 = await mkProduct("dropoff-c1");
      const c2 = await mkProduct("dropoff-c2");
      await addDep(c1, { componentId: compId });
      await addDep(c2, { componentId: compId });

      expect(
        (await candidates()).find((c) => c.component.id === compId),
      ).toBeDefined();

      const res = await promote(compId);
      expect(res.statusCode).toBe(201);

      expect(
        (await candidates()).find((c) => c.component.id === compId),
      ).toBeUndefined();
    });

    it("carries owner and metadata fields onto the new product", async () => {
      const lobRes = await app.inject({
        method: "POST",
        url: "/api/v1/lobs",
        ...authed(),
        payload: { name: "Promo LOB", slug: "promo-lob" },
      });
      expect(lobRes.statusCode).toBe(201);
      const teamRes = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        ...authed(),
        payload: { name: "Promo Team", slug: "promo-team" },
      });
      expect(teamRes.statusCode).toBe(201);

      const compId = await mkComponent("promo-owners");
      const res = await promote(compId, {
        name: "Owned Platform",
        description: "shared thing",
        lobOwnerId: lobRes.json().lob.id,
        teamOwnerId: teamRes.json().team.id,
        tags: ["platform"],
        criticality: "HIGH",
      });
      expect(res.statusCode).toBe(201);
      const product = res.json().product;
      expect(product.lobOwnerId).toBe(lobRes.json().lob.id);
      expect(product.teamOwnerId).toBe(teamRes.json().team.id);
      expect(product.description).toBe("shared thing");
      expect(product.tags).toEqual(["platform"]);
      expect(product.criticality).toBe("HIGH");
    });
  });
});
