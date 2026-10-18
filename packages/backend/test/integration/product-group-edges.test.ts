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
 * Spec 019 / ADR-110: product DEPENDS_ON may target a ComponentGroup — persisted
 * product→group edges, read-time expansion with source attribution and
 * dedup, kind-discriminated removal, component_group audit targets, and
 * delete guards in both directions.
 */
describe("product → component-group dependencies", () => {
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

  async function mkProduct(slug: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(),
      payload: { name: slug, slug, type: "BUSINESS_CAPABILITY" },
    });
    expect(res.statusCode).toBe(201);
    return res.json().product.id as string;
  }

  async function mkComponent(
    slug: string,
    over: { componentGroupId?: string | null } = {},
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
        lifecycle: "ACTIVE",
        details: null,
        componentGroupId: over.componentGroupId ?? null,
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

  async function getDetail(slug: string) {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/products/${slug}`,
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it("rejects zero-form and mixed-form bodies with 400 VALIDATION_FAILED", async () => {
    const productId = await mkProduct("union-check");
    const groupId = await mkGroup("union-group");
    const compId = await mkComponent("union-comp");

    for (const payload of [
      {},
      { componentId: compId, componentGroupId: groupId },
      { componentIds: [compId], componentGroupId: groupId },
    ]) {
      const res = await addDep(productId, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    }
  });

  it("accepts a group edge, expands members via the group, and audits toEntityType=component_group", async () => {
    const productId = await mkProduct("shop");
    const groupId = await mkGroup("datastores");
    const m1 = await mkComponent("pg-main", { componentGroupId: groupId });
    const m2 = await mkComponent("pg-replica", { componentGroupId: groupId });

    expect((await addDep(productId, { componentGroupId: groupId })).statusCode).toBe(204);

    // Audit: DEPENDS_ON_COMPONENT added → toEntityType component_group.
    const auditRows = await testDb.db
      .selectFrom("edge_changes")
      .selectAll()
      .where("fromEntityId", "=", productId)
      .execute();
    expect(
      auditRows.some(
        (r) =>
          r.edgeType === "DEPENDS_ON_COMPONENT" &&
          r.action === "added" &&
          r.toEntityType === "component_group" &&
          r.toEntityId === groupId,
      ),
    ).toBe(true);

    // Expansion: both members appear once, attributed "via group".
    const detail = await getDetail("shop");
    const declared = detail.components.declared as Array<{
      id: string;
      sources: Array<{ kind: string; group?: { id: string } }>;
    }>;
    expect(declared.map((c) => c.id).sort()).toEqual([m1, m2].sort());
    for (const c of declared) {
      expect(c.sources).toEqual([
        { kind: "GROUP", group: expect.objectContaining({ id: groupId }) },
      ]);
    }
    expect(detail.dependsOnGroups).toEqual([
      expect.objectContaining({ id: groupId, memberCount: 2 }),
    ]);

    // A member added later propagates without rewiring.
    const m3 = await mkComponent("pg-standby", { componentGroupId: groupId });
    const detail2 = await getDetail("shop");
    expect(detail2.components.declared.map((c: any) => c.id)).toContain(m3);
    expect(detail2.dependsOnGroups[0].memberCount).toBe(3);
  });

  it("an empty group edge is valid and surfaces in dependsOnGroups", async () => {
    const productId = await mkProduct("empty-dep");
    const groupId = await mkGroup("empty-group");

    expect((await addDep(productId, { componentGroupId: groupId })).statusCode).toBe(204);
    const detail = await getDetail("empty-dep");
    expect(detail.components.declared).toEqual([]);
    expect(detail.dependsOnGroups).toEqual([
      expect.objectContaining({ id: groupId, memberCount: 0 }),
    ]);
  });

  it("deduplicates: direct + via-group → one row, both sources", async () => {
    const productId = await mkProduct("dedup-product");
    const groupId = await mkGroup("dedup-group");
    const compId = await mkComponent("shared-comp", { componentGroupId: groupId });

    expect((await addDep(productId, { componentId: compId })).statusCode).toBe(204);
    expect((await addDep(productId, { componentGroupId: groupId })).statusCode).toBe(204);

    const detail = await getDetail("dedup-product");
    const declared = detail.components.declared;
    expect(declared).toHaveLength(1);
    const kinds = declared[0].sources.map((s: any) => s.kind).sort();
    expect(kinds).toEqual(["DIRECT", "GROUP"]);
    expect(declared[0].sources.find((s: any) => s.kind === "GROUP").group.id).toBe(groupId);
  });

  it("deduplicates: own group edge + inherited edge → one row, both sources", async () => {
    // Note: componentGroupId is 1:N, so "two groups containing the same
    // component" is unreachable — the multi-source equivalent is a component
    // declared via this product's group AND via a descendant's edge.
    const parentId = await mkProduct("group-parent");
    const childId = await mkProduct("group-child");
    const groupId = await mkGroup("pg-fleet");
    const compId = await mkComponent("fleet-member", { componentGroupId: groupId });

    expect((await addDep(parentId, { componentGroupId: groupId })).statusCode).toBe(204);
    expect((await addDep(childId, { componentId: compId })).statusCode).toBe(204);
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId, childId, createdAt: now() } as never)
      .execute();

    const detail = await getDetail("group-parent");
    const declared = detail.components.declared;
    expect(declared).toHaveLength(1);
    const kinds = declared[0].sources.map((s: any) => s.kind).sort();
    expect(kinds).toEqual(["GROUP", "INHERITED"]);
    expect(detail.components.inherited).toHaveLength(0);
  });

  it("deduplicates: declared direct AND COMPOSES-inherited → one row, all sources", async () => {
    const parentId = await mkProduct("parent-p");
    const childId = await mkProduct("child-p");
    const compId = await mkComponent("inherited-comp");

    // Child depends on comp; parent composes child AND directly depends on comp.
    expect((await addDep(childId, { componentId: compId })).statusCode).toBe(204);
    expect((await addDep(parentId, { componentId: compId })).statusCode).toBe(204);
    await testDb.db
      .insertInto("product_composes")
      .values({ parentId, childId, createdAt: now() } as never)
      .execute();

    const detail = await getDetail("parent-p");
    const declared = detail.components.declared;
    expect(declared).toHaveLength(1);
    const kinds = declared[0].sources.map((s: any) => s.kind).sort();
    expect(kinds).toEqual(["DIRECT", "INHERITED"]);
    expect(declared[0].sources.find((s: any) => s.kind === "INHERITED").product.id).toBe(childId);
    expect(detail.components.inherited).toHaveLength(0);
  });

  it("kind=group remove deletes only the group edge; direct member edges survive", async () => {
    const productId = await mkProduct("kind-remove");
    const groupId = await mkGroup("kind-group");
    const compId = await mkComponent("kind-comp", { componentGroupId: groupId });

    await addDep(productId, { componentId: compId });
    await addDep(productId, { componentGroupId: groupId });

    // Removing the GROUP edge leaves the direct edge (component still declared).
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${productId}/depends-on/${groupId}?kind=group`,
      ...authed(),
    });
    expect(del.statusCode).toBe(204);

    const detail = await getDetail("kind-remove");
    expect(detail.dependsOnGroups).toEqual([]);
    expect(detail.components.declared).toHaveLength(1);
    expect(detail.components.declared[0].sources).toEqual([{ kind: "DIRECT" }]);
  });

  it("DELETE without kind defaults to component and 404s on a group id", async () => {
    const productId = await mkProduct("kind-default");
    const groupId = await mkGroup("default-group");
    await addDep(productId, { componentGroupId: groupId });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${productId}/depends-on/${groupId}`,
      ...authed(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("product delete is blocked while group edges exist (409 REFERENCED)", async () => {
    const productId = await mkProduct("guarded-product");
    const groupId = await mkGroup("guarded-group");
    await addDep(productId, { componentGroupId: groupId });

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${productId}`,
      ...authed(),
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe("REFERENCED");
    expect(del.json().details.counts.dependsOnGroups).toBe(1);

    // Remove the edge → delete succeeds.
    await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${productId}/depends-on/${groupId}?kind=group`,
      ...authed(),
    });
    const del2 = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${productId}`,
      ...authed(),
    });
    expect(del2.statusCode).toBe(204);
  });

  it("component-group delete is blocked while depended on; retirement still allowed", async () => {
    const productId = await mkProduct("group-owner");
    const groupId = await mkGroup("depended-group");
    await addDep(productId, { componentGroupId: groupId });

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/component-groups/${groupId}`,
      ...authed(),
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe("REFERENCED");
    expect(del.json().details.products).toEqual([
      expect.objectContaining({ id: productId, slug: "group-owner" }),
    ]);

    // Retirement (not deletion) is still allowed.
    const retire = await app.inject({
      method: "PATCH",
      url: `/api/v1/component-groups/${groupId}`,
      ...authed(),
      payload: { lifecycle: "RETIRED" },
    });
    expect(retire.statusCode).toBe(200);
  });

  it("listComponentGroups rows carry memberCount", async () => {
    const groupId = await mkGroup("counted-group");
    await mkComponent("counted-a", { componentGroupId: groupId });
    await mkComponent("counted-b", { componentGroupId: groupId });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/component-groups",
      ...authed(),
    });
    const group = res.json().groups.find((g: any) => g.id === groupId);
    expect(group.memberCount).toBe(2);
  });
});
