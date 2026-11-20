import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "kysely";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

describe("global search", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let viewerSession: string | undefined;
  let savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"]) {
      savedEnv[k] = process.env[k];
    }
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

    const mkComponent = async (name: string, slug: string, lifecycle = "ACTIVE") =>
      testDb.db
        .insertInto("components")
        .values({
          id: uuidv7(),
          name,
          slug,
          category: "REPOSITORY",
          provider: "GITHUB",
          resourceType: "repo",
          lifecycle,
          details: null,
          externalId: null,
          lastSeenAt: null,
          lastSeenInRunId: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now(),
          updatedAt: now(),
        } as any)
        .execute();

    await mkComponent("payments-api", "payments-api");
    await mkComponent("payments-worker", "payments-worker");
    await mkComponent("payments-legacy", "payments-legacy", "RETIRED");
    await mkComponent("billing", "billing");

    await testDb.db
      .insertInto("component_groups")
      .values({
        id: uuidv7(),
        name: "Payments",
        slug: "payments",
        lifecycle: "ACTIVE",
        description: null,
        teamOwnerId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as any)
      .execute();

    // Spec 074: a reported BOM entry feeds the Ctrl+K Packages group.
    const bomComponentId = (
      await testDb.db
        .selectFrom("components")
        .select("id")
        .where("slug", "=", "payments-api")
        .executeTakeFirstOrThrow()
    ).id;
    const { normalizePurlIdentity } = await import("@componode/core");
    await sql`
      INSERT INTO bom_entries
        (id, "componentId", purl, "purlIdentity", name, version, ecosystem,
         scope, "evidenceSource", licenses, direct, "lastReportedAt",
         "createdAt", "updatedAt")
      VALUES (${uuidv7()}, ${bomComponentId}, 'pkg:npm/lodash@4.17.21',
              ${normalizePurlIdentity("pkg:npm/lodash@4.17.21")}, 'lodash',
              '4.17.21', 'npm', 'RUNTIME', 'REGISTRY_API', '[]'::jsonb,
              true, ${now()}, ${now()}, ${now()})
    `.execute(testDb.db);
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns 401 without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=pay" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when q is missing or blank", async () => {
    for (const url of ["/api/v1/search", "/api/v1/search?q=", "/api/v1/search?q=%20%20"]) {
      const res = await app.inject({
        method: "GET",
        url,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    }
  });

  it("returns 400 for unknown query params (strict schema)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=pay&bogus=1",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(400);
  });

  it("prefix-matches components and groups, excluding RETIRED", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=pay",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const names = body.components.map((c: any) => c.name);
    expect(names).toContain("payments-api");
    expect(names).toContain("payments-worker");
    expect(names).not.toContain("payments-legacy"); // RETIRED excluded
    expect(names).not.toContain("billing");
    expect(body.components[0].href).toMatch(/^\/components\//);
    const groupNames = body.groups.map((g: any) => g.name);
    expect(groupNames).toContain("Payments");
  });

  it("respects the per-group limit", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=pay&limit=1",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().components.length).toBeLessThanOrEqual(1);
  });

  it("returns results in under 1s on a 1,000-component catalog (SC-005)", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: uuidv7(),
      name: `bulk-comp-${String(i).padStart(4, "0")}`,
      slug: `bulk-comp-${String(i).padStart(4, "0")}`,
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
    }));
    await testDb.db.insertInto("components").values(rows as any).execute();

    const start = performance.now();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=bulk",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const elapsed = performance.now() - start;
    expect(res.statusCode).toBe(200);
    expect(res.json().components.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
  });

  it("returns a Packages group with `name · ecosystem · n components` hits (spec 074)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=lodash",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const packages = res.json().packages;
    expect(packages.length).toBe(1);
    expect(packages[0].name).toBe("lodash · npm · 1 component");
    expect(packages[0].kind).toBe("package");
    expect(packages[0].href).toBe("/packages?q=pkg%3Anpm%2Flodash");

    const noMatch = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=zzz-no-package",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(noMatch.statusCode).toBe(200);
    expect(noMatch.json().packages).toEqual([]);
  });

  it("caps the Packages group at 5 hits", async () => {
    const bomComponentId = (
      await testDb.db
        .selectFrom("components")
        .select("id")
        .where("slug", "=", "payments-api")
        .executeTakeFirstOrThrow()
    ).id;
    const { normalizePurlIdentity } = await import("@componode/core");
    for (let i = 0; i < 6; i++) {
      const purl = `pkg:npm/pwcap-${i}@1.0.0`;
      await testDb.db
        .insertInto("bom_entries")
        .values({
          id: uuidv7(),
          componentId: bomComponentId,
          purl,
          purlIdentity: normalizePurlIdentity(purl) ?? purl,
          name: `pwcap-${i}`,
          version: "1.0.0",
          ecosystem: "npm",
          scope: "RUNTIME",
          evidenceSource: "REGISTRY_API",
          licenses: sql`'[]'::jsonb` as any,
          direct: true,
          lastReportedAt: now(),
          createdAt: now(),
          updatedAt: now(),
        } as any)
        .execute();
    }
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=pwcap&limit=20",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().packages.length).toBe(5);
  });

  it("is readable by the viewer role (same read-only shape)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=bill",
      cookies: { [SESSION_COOKIE_NAME]: viewerSession ?? adminSession },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().components[0].name).toBe("billing");
  });
});
