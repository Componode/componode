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
    name: string;
    slug: string;
    type?: string;
    lifecycle?: string;
    description?: string | null;
    lobOwnerId?: string | null;
    teamOwnerId?: string | null;
    tags?: string[];
    criticality?: string | null;
  },
) {
  const id = uuidv7();
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
      tags: over.tags ?? [],
      criticality: over.criticality ?? null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
    } as never)
    .execute();
  return id;
}

async function mkComponent(
  testDb: TestDb,
  over: { name: string; slug?: string; externalId?: string | null; lifecycle?: string },
) {
  const id = uuidv7();
  await testDb.db
    .insertInto("components")
    .values({
      id,
      name: over.name,
      slug: over.slug ?? over.name.toLowerCase().replace(/\s+/g, "-"),
      category: "DATABASE",
      provider: "AWS",
      resourceType: "rds",
      lifecycle: over.lifecycle ?? "ACTIVE",
      details: null,
      componentGroupId: null,
      externalId: over.externalId ?? null,
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

async function mkOrg(testDb: TestDb, table: "line_of_businesses" | "teams", name: string, slug: string) {
  const id = uuidv7();
  await testDb.db
    .insertInto(table)
    .values({ id, name, slug, description: null, createdAt: now(), updatedAt: now() } as never)
    .execute();
  return id;
}

async function mkEdge(testDb: TestDb, productId: string, componentId: string) {
  await testDb.db
    .insertInto("product_depends_on_component")
    .values({ productId, componentId, createdAt: now() } as never)
    .execute();
}

async function countTable(testDb: TestDb, table: string) {
  const r = await testDb.db
    .selectFrom(table as never)
    .select((eb) => eb.fn.countAll().as("n"))
    .executeTakeFirstOrThrow();
  return Number((r as { n: number }).n);
}

describe("catalog bootstrap API (ADR-114)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let adminId: string;
  let viewerSession: string | undefined;
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
    const admin = await testDb.db
      .selectFrom("persons")
      .select("id")
      .where("username", "=", ADMIN_USERNAME)
      .executeTakeFirstOrThrow();
    adminId = admin.id as string;

    const viewerId = await createPersonInDb(testDb.db, {
      username: "viewer1",
      role: "VIEWER",
    });
    viewerSession = (await createSessionInDb(testDb.db, viewerId)).token;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const postDoc = (
    body: string,
    opts: { session?: string; dryRun?: boolean; contentType?: string } = {},
  ) =>
    app.inject({
      method: "POST",
      url: `/api/v1/products/bootstrap${opts.dryRun ? "?dryRun=true" : ""}`,
      payload: body,
      headers: {
        ...csrfHeader,
        "content-type": opts.contentType ?? "application/yaml",
      },
      cookies: {
        [SESSION_COOKIE_NAME]: opts.session ?? adminSession,
        ...csrfCookie,
      },
    });

  const getProduct = (slug: string) =>
    testDb.db
      .selectFrom("digital_products")
      .selectAll()
      .where("slug", "=", slug)
      .executeTakeFirst();

  const edgeCount = (productId: string) =>
    testDb.db
      .selectFrom("product_depends_on_component")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("productId", "=", productId)
      .executeTakeFirstOrThrow()
      .then((r) => Number(r.n));

  it("applies a valid document — creates products with fields and wires resolved refs", async () => {
    const lobId = await mkOrg(testDb, "line_of_businesses", "Retail", "retail");
    const teamId = await mkOrg(testDb, "teams", "Shop Platform", "shop-platform");
    const compId = await mkComponent(testDb, { name: "Payments DB", slug: "payments-db" });

    const res = await postDoc(`version: 1
products:
  - name: Payments Shop
    type: CUSTOMER_FACING
    description: Storefront checkout product
    owner: { lob: retail, team: shop-platform }
    tags: [checkout]
    criticality: HIGH
    sunsetAt: "2027-06-01T00:00:00Z"
    dependsOn: [payments-db]
`);

    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report).toMatchObject({ created: 1, updated: 0, edgesAdded: 1 });
    expect(report.skipped).toEqual([]);

    const product = await getProduct("payments-shop");
    expect(product).toBeDefined();
    expect(product!.type).toBe("CUSTOMER_FACING");
    expect(product!.description).toBe("Storefront checkout product");
    expect(product!.lobOwnerId).toBe(lobId);
    expect(product!.teamOwnerId).toBe(teamId);
    expect(product!.tags).toEqual(["checkout"]);
    expect(product!.criticality).toBe("HIGH");
    expect(new Date(product!.sunsetAt as unknown as Date).toISOString()).toContain(
      "2027-06-01",
    );
    expect(product!.lifecycle).toBe("ACTIVE");
    expect(await edgeCount(product!.id)).toBe(1);
    void compId;
  });

  it("upserts by derived slug with merge semantics — omitted fields preserved, explicit null clears", async () => {
    const lobId = await mkOrg(testDb, "line_of_businesses", "Finance", "finance");
    const teamId = await mkOrg(testDb, "teams", "Billing", "billing");
    const existingId = await mkProduct(testDb, {
      name: "Billing Service",
      slug: "billing-service",
      type: "PLATFORM",
      description: "keep me",
      lobOwnerId: lobId,
      tags: ["old-tag"],
      criticality: "LOW",
    });

    const res = await postDoc(`version: 1
products:
  - name: Billing Service
    type: BUSINESS_CAPABILITY
    tags: [new-tag]
    owner: { team: billing }
`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 0, updated: 1 });

    const p = await getProduct("billing-service");
    expect(p!.id).toBe(existingId);
    expect(p!.description).toBe("keep me"); // omitted → preserved
    expect(p!.lobOwnerId).toBe(lobId); // owner.lob omitted → preserved
    expect(p!.teamOwnerId).toBe(teamId);
    expect(p!.tags).toEqual(["new-tag"]);
    expect(p!.criticality).toBe("LOW"); // omitted → preserved
    expect(p!.type).toBe("BUSINESS_CAPABILITY");

    // Explicit clears
    const res2 = await postDoc(`version: 1
products:
  - name: Billing Service
    type: BUSINESS_CAPABILITY
    description: null
    tags: []
    criticality: null
    owner: { lob: null }
`);
    expect(res2.statusCode).toBe(200);
    const p2 = await getProduct("billing-service");
    expect(p2!.description).toBeNull();
    expect(p2!.tags).toEqual([]);
    expect(p2!.criticality).toBeNull();
    expect(p2!.lobOwnerId).toBeNull();
    expect(p2!.teamOwnerId).toBe(teamId); // owner.team omitted → preserved
  });

  it("updates a RETIRED product's fields but never changes lifecycle", async () => {
    await mkProduct(testDb, {
      name: "Legacy App",
      slug: "legacy-app",
      lifecycle: "RETIRED",
      description: "old",
    });
    const res = await postDoc(`version: 1
products:
  - name: Legacy App
    type: PLATFORM
    description: still retired
`);
    expect(res.json().updated).toBe(1);
    const p = await getProduct("legacy-app");
    expect(p!.lifecycle).toBe("RETIRED");
    expect(p!.description).toBe("still retired");
    expect(p!.type).toBe("PLATFORM");
  });

  it("rejects malformed documents whole — per-item errors, zero writes", async () => {
    const before = await countTable(testDb, "digital_products");
    const beforeAudit = await countTable(testDb, "entity_changes");

    for (const body of [
      // bad enum on item 2
      `version: 1\nproducts:\n  - name: Good\n    type: PLATFORM\n  - name: Bad\n    type: NOPE\n`,
      // unknown field
      `version: 1\nproducts:\n  - name: Mystery\n    type: PLATFORM\n    bogus: 1\n`,
      // wrong version
      `version: 2\nproducts: []\n`,
      // unparseable
      `{{{`,
      // duplicate derived slugs
      `version: 1\nproducts:\n  - name: Shop App\n    type: PLATFORM\n  - name: shop-app\n    type: PLATFORM\n`,
    ]) {
      const res = await postDoc(body);
      expect(res.statusCode, body).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    }

    expect(await countTable(testDb, "digital_products")).toBe(before);
    expect(await countTable(testDb, "entity_changes")).toBe(beforeAudit);
  });

  it("reports unresolved and ambiguous refs in skipped — products still apply", async () => {
    const compId = await mkComponent(testDb, { name: "Cache", slug: "cache" });
    // Two components sharing one name → name ref is ambiguous.
    await mkComponent(testDb, { name: "Shared Name", slug: "shared-a" });
    await mkComponent(testDb, { name: "Shared Name", slug: "shared-b" });
    // Slug beats name: "cache" resolves to the slug owner even though it is
    // also a name match elsewhere is not set up — direct assertions below.
    const extId = await mkComponent(testDb, {
      name: "Ext Box",
      slug: "ext-box",
      externalId: "arn:aws:rds:db-1",
    });
    const retired = await mkComponent(testDb, {
      name: "Old DB",
      slug: "old-db",
      lifecycle: "RETIRED",
    });

    const res = await postDoc(`version: 1
products:
  - name: Ref Tester
    type: PLATFORM
    owner: { lob: no-such-lob, team: no-such-team }
    dependsOn: [cache, arn:aws:rds:db-1, Shared Name, no-such-ref, old-db]
`);
    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report.created).toBe(1);
    // cache (slug), arn (externalId), old-db (retired still resolves) = 3 edges
    expect(report.edgesAdded).toBe(3);
    const reasons = report.skipped.map((s: { reason: string }) => s.reason);
    expect(report.skipped.length).toBe(4); // 2 owners + ambiguous + not-found
    void reasons;

    const p = await getProduct("ref-tester");
    const edges = await testDb.db
      .selectFrom("product_depends_on_component")
      .select("componentId")
      .where("productId", "=", p!.id)
      .execute();
    const edgeIds = edges.map((e) => e.componentId);
    expect(edgeIds).toContain(compId);
    expect(edgeIds).toContain(extId);
    expect(edgeIds).toContain(retired); // existence-only resolution
    expect(p!.lobOwnerId).toBeNull();
    expect(p!.teamOwnerId).toBeNull();
  });

  it("resolves refs by slug before name before externalId", async () => {
    const slugWinner = await mkComponent(testDb, { name: "Other", slug: "contest" });
    const nameLoser = await mkComponent(testDb, { name: "contest", slug: "contest-name" });
    void nameLoser;
    const res = await postDoc(`version: 1
products:
  - name: Order Resolution
    type: PLATFORM
    dependsOn: [contest]
`);
    expect(res.json().edgesAdded).toBe(1);
    const p = await getProduct("order-resolution");
    const edges = await testDb.db
      .selectFrom("product_depends_on_component")
      .select("componentId")
      .where("productId", "=", p!.id)
      .execute();
    expect(edges[0]!.componentId).toBe(slugWinner);
  });

  it("dryRun returns the same report shape with zero writes", async () => {
    const before = await countTable(testDb, "digital_products");
    const beforeEdges = await countTable(testDb, "product_depends_on_component");
    const beforeAudit = await countTable(testDb, "entity_changes");
    const beforeEdgeAudit = await countTable(testDb, "edge_changes");

    const res = await postDoc(
      `version: 1
products:
  - name: Dry Run Product
    type: PLATFORM
    dependsOn: [cache, nothing-here]
`,
      { dryRun: true },
    );
    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report).toHaveProperty("created");
    expect(report).toHaveProperty("updated");
    expect(report).toHaveProperty("edgesAdded");
    expect(report).toHaveProperty("skipped");
    expect(report.created).toBe(1);
    expect(report.edgesAdded).toBe(1);
    expect(report.skipped.length).toBe(1);

    expect(await countTable(testDb, "digital_products")).toBe(before);
    expect(await countTable(testDb, "product_depends_on_component")).toBe(beforeEdges);
    expect(await countTable(testDb, "entity_changes")).toBe(beforeAudit);
    expect(await countTable(testDb, "edge_changes")).toBe(beforeEdgeAudit);
  });

  it("is idempotent — re-importing an identical file reports all zeros and writes no audit", async () => {
    const body = `version: 1
products:
  - name: Idempotent
    type: PLATFORM
    dependsOn: [cache]
`;
    const first = await postDoc(body);
    expect(first.json()).toMatchObject({ created: 1, edgesAdded: 1 });
    const auditBefore = await countTable(testDb, "entity_changes");
    const edgeAuditBefore = await countTable(testDb, "edge_changes");

    const second = await postDoc(body);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      created: 0,
      updated: 0,
      edgesAdded: 0,
    });
    expect(await countTable(testDb, "entity_changes")).toBe(auditBefore);
    expect(await countTable(testDb, "edge_changes")).toBe(edgeAuditBefore);
  });

  it("accepts the same document as application/json", async () => {
    const res = await postDoc(
      JSON.stringify({
        version: 1,
        products: [{ name: "JSON Product", type: "PLATFORM", dependsOn: ["cache"] }],
      }),
      { contentType: "application/json" },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 1, edgesAdded: 1 });
  });

  it("returns 413 PAYLOAD_TOO_LARGE for a body over the 1MB limit", async () => {
    const big = `version: 1\nproducts:\n  - name: ${"x".repeat(1_050_000)}\n    type: PLATFORM\n`;
    const res = await postDoc(big);
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("returns 400 VALIDATION_FAILED for an unparseable application/json body", async () => {
    const before = await countTable(testDb, "digital_products");
    const res = await postDoc("{ not valid json !!!", {
      contentType: "application/json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(await countTable(testDb, "digital_products")).toBe(before);
  });

  it("writes audit entries for every create/update and edge, attributed to the actor", async () => {
    await postDoc(`version: 1
products:
  - name: Audited Product
    type: PLATFORM
    dependsOn: [cache]
`);
    const p = await getProduct("audited-product");
    const entityRows = await testDb.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityType", "=", "digital_product")
      .where("entityId", "=", p!.id)
      .execute();
    expect(entityRows.length).toBe(1);
    expect(entityRows[0]!.action).toBe("created");
    expect(entityRows[0]!.createdBy).toBe(adminId);

    const edgeRows = await testDb.db
      .selectFrom("edge_changes")
      .selectAll()
      .where("edgeType", "=", "DEPENDS_ON_COMPONENT")
      .where("fromEntityId", "=", p!.id)
      .execute();
    expect(edgeRows.length).toBe(1);
    expect(edgeRows[0]!.action).toBe("added");
    expect(edgeRows[0]!.reason).toBe("catalog bootstrap import");
    expect(edgeRows[0]!.createdBy).toBe(adminId);
  });

  it("rejects VIEWER and unauthenticated requests", async () => {
    const viewer = await postDoc(`version: 1\nproducts: []\n`, { session: viewerSession });
    expect(viewer.statusCode).toBe(403);

    const unauth = await app.inject({
      method: "POST",
      url: "/api/v1/products/bootstrap",
      payload: `version: 1\nproducts: []\n`,
      headers: { ...csrfHeader, "content-type": "application/yaml" },
      cookies: { ...csrfCookie }, // CSRF satisfied; no session cookie
    });
    expect(unauth.statusCode).toBe(401);
  });

  it("returns a zero-count report for an empty products array", async () => {
    const res = await postDoc(`version: 1\nproducts: []\n`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ created: 0, updated: 0, edgesAdded: 0, skipped: [] });
  });

  it("type flips blocked by CONSUMES_FROM consumers land in skipped; other items still apply", async () => {
    const platformId = await mkProduct(testDb, {
      name: "Consumed Platform",
      slug: "consumed-platform",
      type: "PLATFORM",
    });
    const consumerId = await mkProduct(testDb, {
      name: "Consumer",
      slug: "consumer",
      type: "BUSINESS_CAPABILITY",
    });
    await testDb.db
      .insertInto("product_consumes_from")
      .values({ consumerId, platformId, createdAt: now() } as never)
      .execute();

    const res = await postDoc(`version: 1
products:
  - name: Consumed Platform
    type: BUSINESS_CAPABILITY
  - name: Still Works
    type: PLATFORM
`);
    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report.created).toBe(1); // Still Works
    expect(report.skipped.length).toBe(1);
    expect(report.skipped[0].item).toContain("Consumed Platform");

    const p = await getProduct("consumed-platform");
    expect(p!.type).toBe("PLATFORM"); // unchanged
    const consumers = await testDb.db
      .selectFrom("product_consumes_from")
      .selectAll()
      .where("platformId", "=", platformId)
      .execute();
    expect(consumers.length).toBe(1);
  });

  it("applies a ~200-product document within the SC-001 budget with batched ref resolution", async () => {
    for (let i = 0; i < 5; i++) {
      await mkComponent(testDb, { name: `Scale Comp ${i}`, slug: `scale-comp-${i}` });
    }
    await mkOrg(testDb, "line_of_businesses", "Scale LOB", "scale-lob");
    await mkOrg(testDb, "teams", "Scale Team", "scale-team");

    const products = Array.from({ length: 200 }, (_, i) => ({
      name: `Scale Product ${i}`,
      type: "CUSTOMER_FACING",
      owner: { lob: "scale-lob", team: "scale-team" },
      dependsOn: [`scale-comp-${i % 5}`],
    }));

    // Count real SQL statements at the pg driver level: ref resolution must
    // stay a fixed set of IN-list SELECTs, not one query per item/ref.
    const pg = await import("pg");
    const origQuery = pg.Client.prototype.query;
    const selectRe = /^\s*select\b/i;
    const lookupRe =
      /"?(components|line_of_businesses|teams|digital_products|product_depends_on_component)"?/i;
    const lookupSelects: string[] = [];
    (pg.Client.prototype as any).query = function (
      this: unknown,
      config: unknown,
      ...rest: unknown[]
    ) {
      const sql =
        typeof config === "string"
          ? config
          : (config as { text?: string })?.text;
      if (typeof sql === "string" && selectRe.test(sql) && lookupRe.test(sql)) {
        lookupSelects.push(sql);
      }
      return (origQuery as any).call(this, config, ...rest);
    };

    let res: any;
    const started = Date.now();
    try {
      res = await postDoc(JSON.stringify({ version: 1, products }), {
        contentType: "application/json",
      });
    } finally {
      pg.Client.prototype.query = origQuery;
    }
    const elapsed = Date.now() - started;

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      created: 200,
      updated: 0,
      edgesAdded: 200,
      skipped: [],
    });
    // SC-001: under one minute end-to-end (actual is a few seconds).
    expect(elapsed).toBeLessThan(60_000);
    // Batched resolution: lobs + teams + component stages + products + edges —
    // a fixed handful of IN queries, not ~200 per-item lookups.
    expect(lookupSelects.length).toBeGreaterThan(0);
    expect(lookupSelects.length).toBeLessThanOrEqual(12);
  }, 90_000);

  describe("create product from components (US2)", () => {
  const createProduct = (body: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/v1/products",
      payload: body,
      headers: { ...csrfHeader, "content-type": "application/json" },
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
    });

  it("creates a product wired to all componentIds atomically, with one edge audit row each", async () => {
    const c1 = await mkComponent(testDb, { name: "Fast DB" });
    const c2 = await mkComponent(testDb, { name: "Fast API" });
    const res = await createProduct({
      name: "Wired Product",
      type: "PLATFORM",
      componentIds: [c1, c2],
    });
    expect(res.statusCode).toBe(201);
    const { product } = res.json();
    const edges = await testDb.db
      .selectFrom("product_depends_on_component")
      .select("componentId")
      .where("productId", "=", product.id)
      .execute();
    expect(edges.map((e) => e.componentId).sort()).toEqual([c1, c2].sort());
    const audits = await testDb.db
      .selectFrom("edge_changes")
      .selectAll()
      .where("fromEntityId", "=", product.id)
      .where("edgeType", "=", "DEPENDS_ON_COMPONENT")
      .execute();
    expect(audits.length).toBe(2);
  });

  it("rejects unknown component ids with 404 + missingIds and writes nothing", async () => {
    const missing = uuidv7();
    const before = await countTable(testDb, "digital_products");
    const res = await createProduct({
      name: "No Write",
      type: "PLATFORM",
      componentIds: [missing],
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(res.json().details.missingIds).toContain(missing);
    expect(await countTable(testDb, "digital_products")).toBe(before);
    expect(await testDb.db
      .selectFrom("digital_products")
      .select("id")
      .where("slug", "=", "no-write")
      .executeTakeFirst()).toBeUndefined();
  });

  it("accepts a RETIRED component id (existence-only rule)", async () => {
    const retired = await mkComponent(testDb, {
      name: "Retired DB",
      lifecycle: "RETIRED",
    });
    const res = await createProduct({
      name: "Legacy Wiring",
      type: "PLATFORM",
      componentIds: [retired],
    });
    expect(res.statusCode).toBe(201);
    const edges = await testDb.db
      .selectFrom("product_depends_on_component")
      .selectAll()
      .where("productId", "=", res.json().product.id)
      .execute();
    expect(edges.length).toBe(1);
  });

  it("still enforces existing create rules — slug collision stays 409", async () => {
    await mkProduct(testDb, { name: "Taken", slug: "taken" });
    const c = await mkComponent(testDb, { name: "Any DB" });
    const res = await createProduct({
      name: "Taken",
      slug: "taken",
      type: "PLATFORM",
      componentIds: [c],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SLUG_TAKEN");
  });

  it("accepts a single-element componentIds array", async () => {
    const c = await mkComponent(testDb, { name: "Solo" });
    const res = await createProduct({
      name: "Solo Product",
      type: "PLATFORM",
      componentIds: [c],
    });
    expect(res.statusCode).toBe(201);
    expect(
      await countTable(testDb, "product_depends_on_component"),
    ).toBeGreaterThan(0);
  });

  it("rejects more than 100 component ids", async () => {
    const res = await createProduct({
      name: "Too Many",
      type: "PLATFORM",
      componentIds: Array.from({ length: 101 }, () => uuidv7()),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});
});
