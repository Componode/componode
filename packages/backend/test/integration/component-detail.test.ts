import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME, truncateImportTables } from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

describe("component detail", () => {
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

    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
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

  it("returns component metadata and instances", async () => {
    const group = {
      id: "018f0000-0000-7e10-a000-000000000001",
      name: "Payments Group",
      slug: "payments-group",
      description: "Payment services",
      lifecycle: "ACTIVE",
      teamOwnerId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
    };
    await testDb.db.insertInto("component_groups").values(group as any).execute();

    const component = {
      id: "018f0000-0000-7e10-a000-000000000002",
      name: "Payment API",
      slug: "payment-api",
      category: "API",
      provider: "GITHUB",
      resourceType: "github:repository",
      lifecycle: "ACTIVE",
      externalId: "payment-api",
      details: { language: "typescript" },
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
    };
    await testDb.db.insertInto("components").values(component as any).execute();
    await testDb.db
      .insertInto("component_group_members")
      .values({ componentId: component.id, groupId: group.id })
      .execute();

    await testDb.db.insertInto("component_instances").values({
      id: "018f0000-0000-7e10-a000-000000000003",
      componentId: component.id,
      environment: "PRODUCTION",
      url: "https://api.example.com",
      region: "us-east-1",
      status: "RUNNING",
      version: "1.2.3",
      externalId: "prod",
      slug: "prod",
      deployedAt: now(),
      rawConfig: null,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
    } as any).execute();

    await testDb.db.insertInto("component_instances").values({
      id: "018f0000-0000-7e10-a000-000000000004",
      componentId: component.id,
      environment: "STAGING",
      url: null,
      region: null,
      status: "GONE",
      version: null,
      externalId: "staging",
      slug: "staging",
      deployedAt: null,
      rawConfig: null,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
    } as any).execute();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/components/${component.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.component.name).toBe("Payment API");
    // Spec 070: memberships are plural — componentGroups[] carries refs.
    expect(
      body.component.componentGroups.map((g: any) => g.name),
    ).toContain("Payments Group");
    expect(body.component.instances).toHaveLength(1);
    expect(body.component.instances[0].environment).toBe("PRODUCTION");
  });

  it("returns 404 for unknown component", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components/018f0000-0000-7e10-a000-000000000999",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(404);
  });

  describe("relationships read (spec 060)", () => {
    async function mkComponent(values: Record<string, unknown>) {
      const id = uuidv7();
      const { componentGroupId, ...rest } = values;
      await testDb.db
        .insertInto("components")
        .values({
          id,
          name: (values.slug as string) ?? id,
          slug: id,
          category: "REPOSITORY",
          provider: "GITHUB",
          resourceType: "repo",
          lifecycle: "ACTIVE",
          details: null,
          externalId: null,
          lastSeenAt: null,
          lastSeenInRunId: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now(),
          updatedAt: now(),
          ...rest,
        } as any)
        .execute();
      if (componentGroupId) {
        await testDb.db
          .insertInto("component_group_members")
          .values({ componentId: id, groupId: componentGroupId as string })
          .execute();
      }
      return id;
    }

    async function mkGroup(values: Record<string, unknown> = {}) {
      const id = uuidv7();
      await testDb.db
        .insertInto("component_groups")
        .values({
          id,
          name: (values.name as string) ?? `group-${id}`,
          slug: `group-${id}`,
          description: null,
          lifecycle: "ACTIVE",
          teamOwnerId: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now(),
          updatedAt: now(),
          ...values,
        } as any)
        .execute();
      return id;
    }

    async function mkProduct(slug: string, lifecycle = "ACTIVE") {
      const id = uuidv7();
      await testDb.db
        .insertInto("digital_products")
        .values({
          id,
          name: slug,
          slug: `${slug}-${id}`,
          description: null,
          type: "BUSINESS_CAPABILITY",
          lifecycle,
          lobOwnerId: null,
          teamOwnerId: null,
          sunsetAt: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now(),
          updatedAt: now(),
        } as any)
        .execute();
      return id;
    }

    async function mkInstance(componentId: string, status = "RUNNING") {
      const id = uuidv7();
      await testDb.db
        .insertInto("component_instances")
        .values({
          id,
          componentId,
          environment: "PRODUCTION",
          url: null,
          region: null,
          status,
          version: "1.0.0",
          deployedAt: now(),
          rawConfig: null,
          externalId: id,
          slug: id,
          lastSeenAt: null,
          lastSeenInRunId: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now(),
          updatedAt: now(),
        } as any)
        .execute();
      return id;
    }

    async function readRelationships(
      componentId: string,
      query = "",
      session: string | null = adminSession,
    ) {
      return app.inject({
        method: "GET",
        url: `/api/v1/components/${componentId}/relationships${query}`,
        ...(session ? { cookies: { [SESSION_COOKIE_NAME]: session } } : {}),
      });
    }

    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

    it("returns typed Component relations with explicit source/target direction", async () => {
      const focused = await mkComponent({ slug: "rel-focused", category: "WEB_ENDPOINT" });
      const depTarget = await mkComponent({ slug: "rel-dep-target" });
      const depSource = await mkComponent({ slug: "rel-dep-source" });
      const repo = await mkComponent({ slug: "rel-repo", category: "REPOSITORY" });
      const repoConsumer = await mkComponent({ slug: "rel-repo-consumer" });
      const api = await mkComponent({ slug: "rel-api", category: "API" });
      const apiConsumer = await mkComponent({ slug: "rel-api-consumer" });

      await testDb.db.insertInto("component_depends_on_component").values([
        { parentId: focused, childId: depTarget },
        { parentId: depSource, childId: focused },
      ]).execute();
      await testDb.db.insertInto("component_sources_from").values([
        { serviceId: focused, repositoryId: repo },
        { serviceId: repoConsumer, repositoryId: focused },
      ]).execute();
      await testDb.db.insertInto("component_exposes").values([
        { serviceId: focused, apiId: api },
        { serviceId: apiConsumer, apiId: focused },
      ]).execute();

      const res = await readRelationships(focused);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.component.id).toBe(focused);
      const rel = body.relationships;
      expect(ids(rel.dependsOn)).toEqual([depTarget]);
      expect(ids(rel.dependedOnBy)).toEqual([depSource]);
      expect(ids(rel.sourcesFrom)).toEqual([repo]);
      expect(ids(rel.sourcedBy)).toEqual([repoConsumer]);
      expect(ids(rel.exposes)).toEqual([api]);
      expect(ids(rel.exposedBy)).toEqual([apiConsumer]);
      expect(rel.dependsOn[0].lifecycle).toBe("ACTIVE");
      expect(body.unavailableKinds).toEqual([]);
    });

    it("returns honest empty relation groups when no edge rows exist", async () => {
      const focused = await mkComponent({ slug: "rel-empty" });
      const res = await readRelationships(focused);
      expect(res.statusCode).toBe(200);
      const rel = JSON.parse(res.payload).relationships;
      for (const key of [
        "dependsOn",
        "dependedOnBy",
        "sourcesFrom",
        "sourcedBy",
        "exposes",
        "exposedBy",
      ]) {
        expect(rel[key]).toEqual([]);
      }
      expect(rel.productDependents).toEqual({ direct: [], viaGroups: [] });
    });

    it("keeps a retired related endpoint visible with its lifecycle", async () => {
      const focused = await mkComponent({ slug: "rel-retired-focus" });
      const retired = await mkComponent({ slug: "rel-retired-target", lifecycle: "RETIRED" });
      await testDb.db
        .insertInto("component_depends_on_component")
        .values({ parentId: focused, childId: retired })
        .execute();

      const res = await readRelationships(focused);
      expect(res.statusCode).toBe(200);
      const rel = JSON.parse(res.payload).relationships;
      expect(ids(rel.dependsOn)).toEqual([retired]);
      expect(rel.dependsOn[0].lifecycle).toBe("RETIRED");
    });

    it("distinguishes direct Product dependents from ComponentGroup-mediated paths", async () => {
      const group = await mkGroup({ name: "Checkout services" });
      const focused = await mkComponent({ slug: "rel-grouped", componentGroupId: group });
      const direct = await mkProduct("rel-direct");
      const viaGroup = await mkProduct("rel-via-group");
      const unrelated = await mkProduct("rel-unrelated");
      const emptyGroup = await mkGroup({ name: "Empty group" });
      const emptyGroupProduct = await mkProduct("rel-empty-group");

      await testDb.db
        .insertInto("product_depends_on_component")
        .values([
          { productId: direct, componentId: focused },
          { productId: unrelated, componentId: await mkComponent({ slug: "rel-other" }) },
        ])
        .execute();
      await testDb.db
        .insertInto("product_depends_on_component_group")
        .values([
          { productId: viaGroup, componentGroupId: group },
          { productId: emptyGroupProduct, componentGroupId: emptyGroup },
        ])
        .execute();

      const res = await readRelationships(focused);
      expect(res.statusCode).toBe(200);
      const deps = JSON.parse(res.payload).relationships.productDependents;
      expect(ids(deps.direct)).toEqual([direct]);
      expect(ids(deps.viaGroups)).toEqual([viaGroup]);
      expect(deps.viaGroups[0].viaGroup.id).toBe(group);
      expect(deps.viaGroups[0].viaGroup.name).toBe("Checkout services");
      expect(ids(deps.direct)).not.toContain(viaGroup);
      expect(ids(deps.viaGroups)).not.toContain(emptyGroupProduct);
      expect(ids(deps.viaGroups)).not.toContain(unrelated);
    });

    it("keeps a Product reachable through both paths in both provenance groups", async () => {
      const group = await mkGroup();
      const focused = await mkComponent({ slug: "rel-dual", componentGroupId: group });
      const dual = await mkProduct("rel-dual-product");
      await testDb.db
        .insertInto("product_depends_on_component")
        .values({ productId: dual, componentId: focused })
        .execute();
      await testDb.db
        .insertInto("product_depends_on_component_group")
        .values({ productId: dual, componentGroupId: group })
        .execute();

      const res = await readRelationships(focused);
      expect(res.statusCode).toBe(200);
      const deps = JSON.parse(res.payload).relationships.productDependents;
      expect(ids(deps.direct)).toEqual([dual]);
      expect(ids(deps.viaGroups)).toEqual([dual]);
      expect(deps.viaGroups[0].viaGroup.id).toBe(group);
    });

    it("nests non-GONE instances by default and honors includeGone=true", async () => {
      const focused = await mkComponent({ slug: "rel-instances" });
      const running = await mkInstance(focused, "RUNNING");
      const gone = await mkInstance(focused, "GONE");

      const res = await readRelationships(focused);
      expect(res.statusCode).toBe(200);
      const rel = JSON.parse(res.payload).relationships;
      expect(ids(rel.instances)).toEqual([running]);
      expect(rel.instances[0].environment).toBe("PRODUCTION");
      expect(rel.instances[0].status).toBe("RUNNING");

      const withGone = await readRelationships(focused, "?includeGone=true");
      expect(withGone.statusCode).toBe(200);
      const all = ids(JSON.parse(withGone.payload).relationships.instances);
      expect(all).toContain(running);
      expect(all).toContain(gone);
    });

    it("reports a failed relation family in unavailableKinds instead of dropping it", async () => {
      const focused = await mkComponent({ slug: "rel-degraded" });
      // Force the `exposes` family read to fail; others must still respond.
      await testDb.db.schema
        .alterTable("component_exposes")
        .renameTo("component_exposes_bak")
        .execute();
      try {
        const res = await readRelationships(focused);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.payload);
        expect(body.unavailableKinds).toContain("exposes");
        expect(body.relationships.exposes).toEqual([]);
        expect(body.relationships.dependsOn).toEqual([]);
      } finally {
        await testDb.db.schema
          .alterTable("component_exposes_bak")
          .renameTo("component_exposes")
          .execute();
      }
    });

    it("returns 404 for a missing component and 401 without a session", async () => {
      const missing = await readRelationships(uuidv7());
      expect(missing.statusCode).toBe(404);
      expect(JSON.parse(missing.payload).code).toBe("NOT_FOUND");

      const focused = await mkComponent({ slug: "rel-auth" });
      const unauthenticated = await readRelationships(focused, "", null);
      expect(unauthenticated.statusCode).toBe(401);
    });
  });
});
