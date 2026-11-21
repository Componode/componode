import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  createPersonInDb,
  createSessionInDb,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
  truncateImportTables,
} from "../helpers/api.js";

// Spec 075 T012/T013/T020 — curation endpoints: preview shape + 404/401,
// atomic add (link-all vs stage-suggestions, 409 dup, 403 non-EDITOR),
// link-to-existing with the same atomic outcomes.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const now = () => new Date().toISOString();

async function seedComponent(
  db: TestDb["db"],
  overrides: Partial<{
    slug: string;
    name: string;
    category: string;
    provider: string;
    externalId: string | null;
    lifecycle: string;
  }> = {},
) {
  const id = uuidv7();
  await db
    .insertInto("components")
    .values({
      id,
      name: overrides.name ?? `c-${id.slice(-12)}`,
      slug: overrides.slug ?? `c-${id.slice(-12)}`,
      category: overrides.category ?? "API",
      provider: overrides.provider ?? "AWS",
      resourceType: "aws:service",
      lifecycle: overrides.lifecycle ?? "ACTIVE",
      teamOwnerId: null,
      externalId: overrides.externalId ?? null,
      details: null,
      sunsetAt: null,
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

async function seedEntry(
  db: TestDb["db"],
  componentId: string,
  overrides: Partial<{
    purl: string;
    purlIdentity: string;
    name: string;
    version: string | null;
    ecosystem: string;
    cdxType: string | null;
    scope: string;
  }> = {},
) {
  const id = uuidv7();
  await db
    .insertInto("bom_entries")
    .values({
      id,
      componentId,
      purl: overrides.purl ?? "pkg:npm/lodash@4.17.21",
      purlIdentity: overrides.purlIdentity ?? "pkg:npm/lodash",
      name: overrides.name ?? "lodash",
      version: overrides.version === undefined ? "4.17.21" : overrides.version,
      ecosystem: overrides.ecosystem ?? "npm",
      cdxType: overrides.cdxType ?? "library",
      scope: overrides.scope ?? "RUNTIME",
      evidenceSource: "REGISTRY_API",
    } as never)
    .execute();
  return id;
}

describe("bom curation endpoints", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let editorSession: string;
  let viewerSession: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of [
      "DATABASE_URL",
      "NODE_ENV",
      "BOOTSTRAP_ADMIN_USERNAME",
      "BOOTSTRAP_ADMIN_PASSWORD",
    ])
      saved[k] = process.env[k];
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
    const editorId = await createPersonInDb(testDb.db as any, {
      username: "editor",
      passwordHash: null,
      role: "EDITOR",
    });
    editorSession = (await createSessionInDb(testDb.db as any, editorId)).token;
    const viewerId = await createPersonInDb(testDb.db as any, {
      username: "viewer",
      passwordHash: null,
      role: "VIEWER",
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

  beforeEach(async () => {
    await truncateImportTables(testDb.db);
    await testDb.db.deleteFrom("bom_component_suggestions").execute();
    await testDb.db.deleteFrom("component_depends_on_component").execute();
    await testDb.db.deleteFrom("bom_entries").execute();
    await testDb.db.deleteFrom("components").execute();
  });

  const get = (url: string, session: string) =>
    app.inject({
      method: "GET",
      url,
      cookies: { [SESSION_COOKIE_NAME]: session },
    });
  const post = (url: string, body: unknown, session: string) =>
    app.inject({
      method: "POST",
      url,
      payload: body,
      cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
      headers: csrfHeader,
    });

  it("preview returns derived mapping + consumers + existing match (T012)", async () => {
    const db = testDb.db;
    const a = await seedComponent(db);
    const b = await seedComponent(db);
    const retired = await seedComponent(db, { lifecycle: "RETIRED" });
    await seedEntry(db, a);
    await seedEntry(db, b, { version: "4.17.20", purl: "pkg:npm/lodash@4.17.20" });
    await seedEntry(db, retired);

    const res = await get(
      "/api/v1/packages/add-to-catalog/preview?purl=" +
        encodeURIComponent("pkg:npm/lodash@9.9.9"),
      editorSession,
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.identity).toBe("pkg:npm/lodash");
    expect(body.name).toBe("lodash");
    expect(body.category).toBe("LIBRARY");
    expect(body.provider).toBe("NPM");
    expect(body.providerGroup).toBe("package-registries");
    expect(body.resourceType).toBe("npm:package");
    expect(body.consumerCount).toBe(2); // retired excluded
    expect(body.versions).toEqual([
      { version: "4.17.20", componentCount: 1 },
      { version: "4.17.21", componentCount: 1 },
    ]);
    expect(body.mappedFrom).toBeNull();
    expect(body.existingComponent).toBeNull();
  });

  it("preview surfaces mappedFrom on lossy mappings + existing component (T012)", async () => {
    const db = testDb.db;
    const a = await seedComponent(db);
    await seedEntry(db, a, {
      purl: "pkg:rpm/openssl@3.0",
      purlIdentity: "pkg:rpm/openssl",
      name: "openssl",
      ecosystem: "rpm",
      cdxType: "firmware",
    });
    const existing = await seedComponent(db, {
      externalId: "pkg:rpm/openssl@3.0", // versioned externalId still matches
      category: "COMPUTE",
      provider: "OTHER",
    });

    const res = await get(
      "/api/v1/packages/add-to-catalog/preview?purl=" +
        encodeURIComponent("pkg:rpm/openssl"),
      viewerSession, // preview is a read — any authenticated role
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.category).toBe("COMPUTE");
    expect(body.provider).toBe("RPM");
    expect(body.mappedFrom).toEqual({ cdxType: "firmware", ecosystem: "rpm" });
    expect(body.existingComponent.id).toBe(existing);
  });

  it("preview 404s on unknown identity, 401 unauthenticated (T012)", async () => {
    const res = await get(
      "/api/v1/packages/add-to-catalog/preview?purl=pkg:npm/nope",
      editorSession,
    );
    expect(res.statusCode).toBe(404);
    const unauth = await app.inject({
      method: "GET",
      url: "/api/v1/packages/add-to-catalog/preview?purl=pkg:npm/nope",
    });
    expect(unauth.statusCode).toBe(401);
  });

  it("add creates one Library + links all consumers atomically (T013)", async () => {
    const db = testDb.db;
    const consumers = await Promise.all([
      seedComponent(db),
      seedComponent(db),
      seedComponent(db),
    ]);
    for (const c of consumers) await seedEntry(db, c);

    const res = await post(
      "/api/v1/packages/add-to-catalog",
      { purl: "pkg:npm/lodash@1.0.0", linkConsumers: true },
      editorSession,
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.linked).toBe(3);
    expect(body.alreadyLinked).toBe(0);
    expect(body.suggestionsStaged).toBe(0);
    expect(body.component.slug).toBe("pkg-npm-lodash");
    expect(body.component.externalId).toBe("pkg:npm/lodash");
    expect(body.component.category).toBe("LIBRARY");
    expect(body.component.provider).toBe("NPM");

    const edges = await db
      .selectFrom("component_depends_on_component")
      .selectAll()
      .where("childId", "=", body.component.id)
      .execute();
    expect(edges).toHaveLength(3);

    const resolved = await db
      .selectFrom("bom_entries")
      .selectAll()
      .where("resolvedComponentId", "=", body.component.id)
      .execute();
    expect(resolved).toHaveLength(3);
  });

  it("add with linkConsumers:false stages suggestions, zero edges (T013)", async () => {
    const db = testDb.db;
    const c1 = await seedComponent(db);
    const c2 = await seedComponent(db);
    await seedEntry(db, c1);
    await seedEntry(db, c2);

    const res = await post(
      "/api/v1/packages/add-to-catalog",
      { purl: "pkg:npm/lodash", linkConsumers: false },
      editorSession,
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.linked).toBe(0);
    expect(body.suggestionsStaged).toBe(2); // one staged pair per consumer
    const edges = await db
      .selectFrom("component_depends_on_component")
      .selectAll()
      .execute();
    expect(edges).toHaveLength(0);
    const staged = await db
      .selectFrom("bom_component_suggestions")
      .selectAll()
      .where("status", "=", "PENDING")
      .execute();
    expect(staged).toHaveLength(2);
  });

  it("add 409s when a component already covers the identity; 403 non-EDITOR (T013)", async () => {
    const db = testDb.db;
    const c = await seedComponent(db);
    await seedEntry(db, c);
    const existing = await seedComponent(db, {
      externalId: "pkg:npm/lodash",
      category: "LIBRARY",
      provider: "NPM",
    });

    const dup = await post(
      "/api/v1/packages/add-to-catalog",
      { purl: "pkg:npm/lodash@2.0.0", linkConsumers: true },
      editorSession,
    );
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.payload).details.existingComponent.id).toBe(existing);

    const forbidden = await post(
      "/api/v1/packages/add-to-catalog",
      { purl: "pkg:npm/lodash", linkConsumers: true },
      viewerSession,
    );
    expect(forbidden.statusCode).toBe(403);
  });

  it("link resolves identity onto a chosen component + counts alreadyLinked (T020)", async () => {
    const db = testDb.db;
    const c1 = await seedComponent(db);
    const c2 = await seedComponent(db);
    await seedEntry(db, c1);
    await seedEntry(db, c2);
    const target = await seedComponent(db, {
      category: "LIBRARY",
      provider: "NPM",
      name: "lodash-curated",
    });
    // Pre-existing edge on c1 → alreadyLinked.
    await db
      .insertInto("component_depends_on_component")
      .values({ parentId: c1, childId: target, createdAt: now() } as never)
      .execute();

    const res = await post(
      "/api/v1/packages/link",
      { purl: "pkg:npm/lodash", componentId: target, linkConsumers: true },
      editorSession,
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.component.id).toBe(target);
    expect(body.linked).toBe(1);
    expect(body.alreadyLinked).toBe(1);

    const resolved = await db
      .selectFrom("bom_entries")
      .selectAll()
      .where("resolvedComponentId", "=", target)
      .execute();
    expect(resolved).toHaveLength(2);
  });

  it("link 404s unknown package/component; viewer 403 (T020)", async () => {
    const db = testDb.db;
    const target = await seedComponent(db);
    const noPkg = await post(
      "/api/v1/packages/link",
      { purl: "pkg:npm/ghost", componentId: target, linkConsumers: false },
      editorSession,
    );
    expect(noPkg.statusCode).toBe(404);
    const c = await seedComponent(db);
    await seedEntry(db, c);
    const noComp = await post(
      "/api/v1/packages/link",
      {
        purl: "pkg:npm/lodash",
        componentId: uuidv7(),
        linkConsumers: false,
      },
      editorSession,
    );
    expect(noComp.statusCode).toBe(404);
    const forbidden = await post(
      "/api/v1/packages/link",
      { purl: "pkg:npm/lodash", componentId: target, linkConsumers: false },
      viewerSession,
    );
    expect(forbidden.statusCode).toBe(403);
  });

  it("link 409s when the target component is RETIRED", async () => {
    const db = testDb.db;
    const c = await seedComponent(db);
    await seedEntry(db, c);
    const retired = await seedComponent(db, { lifecycle: "RETIRED" });
    const res = await post(
      "/api/v1/packages/link",
      { purl: "pkg:npm/lodash", componentId: retired, linkConsumers: true },
      editorSession,
    );
    expect(res.statusCode).toBe(409);
    // No resolution side-effects on the entry.
    const entry = await db
      .selectFrom("bom_entries")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(entry.resolvedComponentId).toBeNull();
  });

  it("preview reports 'Used by 0' when every consumer is RETIRED (T057)", async () => {
    const db = testDb.db;
    const c = await seedComponent(db);
    await seedEntry(db, c);
    await db
      .updateTable("components")
      .set({ lifecycle: "RETIRED" })
      .where("id", "=", c)
      .execute();

    const res = await get(
      "/api/v1/packages/add-to-catalog/preview?purl=" +
        encodeURIComponent("pkg:npm/lodash@9.9.9"),
      editorSession,
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.identity).toBe("pkg:npm/lodash");
    expect(body.consumerCount).toBe(0);
    expect(body.versions).toEqual([]);
  });

  it("versions endpoint returns all versions for the identity", async () => {
    const db = testDb.db;
    const a = await seedComponent(db);
    const b = await seedComponent(db);
    const c = await seedComponent(db);
    await seedEntry(db, a, { version: "4.17.21" });
    await seedEntry(db, b, { version: "4.17.20" });
    await seedEntry(db, c, { version: "4.17.21" });
    const res = await get(
      "/api/v1/packages/versions?purl=" + encodeURIComponent("pkg:npm/lodash@x"),
      viewerSession,
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    // Contract: componentCount DESC, version ASC — 4.17.21 (2 components)
    // outranks 4.17.20 (1) despite the higher version string (T074).
    expect(body.data).toEqual([
      { version: "4.17.21", componentCount: 2 },
      { version: "4.17.20", componentCount: 1 },
    ]);
  });
});
