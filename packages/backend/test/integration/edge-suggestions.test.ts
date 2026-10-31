import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  createPersonInDb,
  createSessionInDb,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
} from "../helpers/api.js";
import { hashPassword } from "../../src/utils/argon2.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const VIEWER_PASSWORD = "ViewerPassword123!";

function now() {
  return new Date().toISOString();
}

/**
 * Spec 022 / ADR-113: staged DEPENDS_ON edge suggestions — the review queue.
 * US1: list PENDING candidates score-desc, accept wires a real edge through
 * the standard path, dismiss is permanent, permissions enforced.
 */
describe("edge suggestions queue", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let viewerSession: string;
  let adminId: string;
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

    const admin = await testDb.db
      .selectFrom("persons")
      .select("id")
      .where("username", "=", ADMIN_USERNAME)
      .executeTakeFirstOrThrow();
    adminId = admin.id;

    const viewerId = await createPersonInDb(testDb.db, {
      username: "viewer",
      passwordHash: await hashPassword(VIEWER_PASSWORD),
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

  const authed = (session: string = adminSession) => ({
    cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
    headers: csrfHeader,
  });

  async function mkProduct(slug: string, lifecycle = "ACTIVE") {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(),
      payload: { name: slug, slug, type: "BUSINESS_CAPABILITY" },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().product.id as string;
    if (lifecycle !== "ACTIVE") {
      await testDb.db
        .updateTable("digital_products")
        .set({ lifecycle })
        .where("id", "=", id)
        .execute();
    }
    return id;
  }

  async function mkComponent(
    slug: string,
    opts: { lifecycle?: string; details?: Record<string, unknown> | null } = {},
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
        lifecycle: opts.lifecycle ?? "ACTIVE",
        details: opts.details ?? null,
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

  async function mkSuggestion(
    productId: string,
    componentId: string,
    opts: {
      reason?: string | null;
      score?: number | null;
      status?: string;
      decidedAt?: string | null;
      decidedBy?: string | null;
    } = {},
  ) {
    const id = uuidv7();
    await testDb.db
      .insertInto("edge_suggestions")
      .values({
        id,
        productId,
        componentId,
        reason: opts.reason ?? "NAME_MATCH",
        score: opts.score ?? 100,
        status: opts.status ?? "PENDING",
        createdAt: now(),
        decidedAt: opts.decidedAt ?? null,
        decidedBy: opts.decidedBy ?? null,
      } as never)
      .execute();
    return id;
  }

  it("lists pending candidates sorted by score with endpoint refs", async () => {
    const productId = await mkProduct("queue-sort");
    const c1 = await mkComponent("queue-sort-1");
    const c2 = await mkComponent("queue-sort-2");
    const c3 = await mkComponent("queue-sort-3");
    await mkSuggestion(productId, c1, { score: 50 });
    await mkSuggestion(productId, c2, { score: 105 });
    await mkSuggestion(productId, c3, { score: 80 });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?status=PENDING",
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const { items, total } = res.json();
    expect(total).toBeGreaterThanOrEqual(3);
    const ours = items.filter((i: any) => i.productId === productId);
    expect(ours.map((i: any) => i.componentId)).toEqual([c2, c3, c1]);
    expect(ours[0].product.name).toBe("queue-sort");
    expect(ours[0].product.slug).toBe("queue-sort");
    expect(ours[0].component.slug).toBe("queue-sort-2");
    expect(ours[0].component.category).toBe("REPOSITORY");
    expect(ours[0].reason).toBe("NAME_MATCH");
    expect(ours[0].score).toBe(1.05);
  });

  it("excludes pending rows whose product or component is RETIRED", async () => {
    const activeP = await mkProduct("queue-active");
    const retiredP = await mkProduct("queue-retired", "RETIRED");
    const activeC = await mkComponent("queue-c-active");
    const retiredC = await mkComponent("queue-c-retired", { lifecycle: "RETIRED" });
    await mkSuggestion(activeP, activeC);
    await mkSuggestion(retiredP, activeC);
    await mkSuggestion(activeP, retiredC);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions",
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((i: any) => i.id);
    const rows = await testDb.db
      .selectFrom("edge_suggestions")
      .select(["id", "productId", "componentId"])
      .where("productId", "in", [activeP, retiredP])
      .execute();
    const hidden = rows.filter(
      (r) => r.productId === retiredP || r.componentId === retiredC,
    );
    const visible = rows.filter(
      (r) => r.productId === activeP && r.componentId === activeC,
    );
    for (const r of hidden) expect(ids).not.toContain(r.id);
    for (const r of visible) expect(ids).toContain(r.id);
  });

  it("rejects bad query params and unauthenticated requests", async () => {
    const bad = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?status=ACCEPTED",
      ...authed(),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("VALIDATION_FAILED");

    const badKey = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?bogus=1",
      ...authed(),
    });
    expect(badKey.statusCode).toBe(400);

    const unauth = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions",
    });
    expect(unauth.statusCode).toBe(401);
  });

  it("accept wires a real edge with audit and marks the row ACCEPTED", async () => {
    const productId = await mkProduct("accept-basic");
    const componentId = await mkComponent("accept-basic-c");
    const suggestionId = await mkSuggestion(productId, componentId);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${suggestionId}/accept`,
      ...authed(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.status).toBe("ACCEPTED");

    const edge = await testDb.db
      .selectFrom("product_depends_on_component")
      .selectAll()
      .where("productId", "=", productId)
      .where("componentId", "=", componentId)
      .executeTakeFirst();
    expect(edge).toBeDefined();

    const audit = await testDb.db
      .selectFrom("edge_changes")
      .selectAll()
      .where("fromEntityId", "=", productId)
      .where("toEntityId", "=", componentId)
      .where("action", "=", "added")
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0].createdBy).toBe(adminId);

    const row = await testDb.db
      .selectFrom("edge_suggestions")
      .selectAll()
      .where("id", "=", suggestionId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("ACCEPTED");
    expect(row.decidedAt).toBeTruthy();
    expect(row.decidedBy).toBe(adminId);
  });

  it("accept on an already-wired pair is idempotent — no duplicate edge", async () => {
    const productId = await mkProduct("accept-dup");
    const componentId = await mkComponent("accept-dup-c");
    const suggestionId = await mkSuggestion(productId, componentId);

    // Wire the pair manually first.
    const wire = await app.inject({
      method: "POST",
      url: `/api/v1/products/${productId}/depends-on`,
      ...authed(),
      payload: { componentId },
    });
    expect(wire.statusCode).toBe(204);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${suggestionId}/accept`,
      ...authed(),
      payload: {},
    });
    expect([200, 409]).toContain(res.statusCode);

    const edges = await testDb.db
      .selectFrom("product_depends_on_component")
      .selectAll()
      .where("productId", "=", productId)
      .where("componentId", "=", componentId)
      .execute();
    expect(edges).toHaveLength(1);

    const row = await testDb.db
      .selectFrom("edge_suggestions")
      .select("status")
      .where("id", "=", suggestionId)
      .executeTakeFirstOrThrow();
    expect(["ACCEPTED", "SUPERSEDED"]).toContain(row.status);
  });

  it("accept on a pair wired outside the edge path lands SUPERSEDED", async () => {
    const productId = await mkProduct("accept-bypass");
    const componentId = await mkComponent("accept-bypass-c");
    const suggestionId = await mkSuggestion(productId, componentId);

    // Simulate a write path that bypassed tombstoning (catalog bootstrap,
    // platform promotion): the edge exists while the row is still PENDING.
    await testDb.db
      .insertInto("product_depends_on_component")
      .values({ productId, componentId })
      .execute();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${suggestionId}/accept`,
      ...authed(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    // No edge was created by this accept — the record is SUPERSEDED and
    // no second audit row appears (FR-010).
    const row = await testDb.db
      .selectFrom("edge_suggestions")
      .selectAll()
      .where("id", "=", suggestionId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("SUPERSEDED");
    expect(row.decidedBy).toBe(adminId);
    const edges = await testDb.db
      .selectFrom("product_depends_on_component")
      .selectAll()
      .where("productId", "=", productId)
      .where("componentId", "=", componentId)
      .execute();
    expect(edges).toHaveLength(1);
  });

  it("accept rejects non-pending rows and unknown ids", async () => {
    const productId = await mkProduct("accept-guards");
    const componentId = await mkComponent("accept-guards-c");
    const dismissed = await mkSuggestion(productId, componentId, {
      status: "DISMISSED",
      decidedAt: now(),
      decidedBy: adminId,
    });

    const conflict = await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${dismissed}/accept`,
      ...authed(),
      payload: {},
    });
    expect(conflict.statusCode).toBe(409);

    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${uuidv7()}/accept`,
      ...authed(),
      payload: {},
    });
    expect(missing.statusCode).toBe(404);
  });

  it("deleting a component cascades its suggestions away (no dangling rows)", async () => {
    const productId = await mkProduct("accept-gone");
    const componentId = await mkComponent("accept-gone-c");
    const suggestionId = await mkSuggestion(productId, componentId);
    await testDb.db
      .deleteFrom("components")
      .where("id", "=", componentId)
      .execute();

    // The FK cascade removes the staged row — accept then 404s cleanly.
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${suggestionId}/accept`,
      ...authed(),
      payload: {},
    });
    expect(res.statusCode).toBe(404);

    const row = await testDb.db
      .selectFrom("edge_suggestions")
      .select("status")
      .where("id", "=", suggestionId)
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it("dismiss marks DISMISSED permanently with decider attribution", async () => {
    const productId = await mkProduct("dismiss-basic");
    const componentId = await mkComponent("dismiss-basic-c");
    const suggestionId = await mkSuggestion(productId, componentId);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${suggestionId}/dismiss`,
      ...authed(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.status).toBe("DISMISSED");

    const row = await testDb.db
      .selectFrom("edge_suggestions")
      .selectAll()
      .where("id", "=", suggestionId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("DISMISSED");
    expect(row.decidedBy).toBe(adminId);
    expect(row.decidedAt).toBeTruthy();

    // No un-dismiss: a second dismiss is a conflict, and accept is too.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${suggestionId}/dismiss`,
      ...authed(),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
    const acceptAfter = await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${suggestionId}/accept`,
      ...authed(),
      payload: {},
    });
    expect(acceptAfter.statusCode).toBe(409);
  });

  it("dismissed view lists terminal rows with decider name", async () => {
    const productId = await mkProduct("dismissed-view");
    const componentId = await mkComponent("dismissed-view-c");
    const suggestionId = await mkSuggestion(productId, componentId);
    await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${suggestionId}/dismiss`,
      ...authed(),
      payload: {},
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?status=DISMISSED",
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: any) => i.id === suggestionId);
    expect(item).toBeDefined();
    expect(item.decidedByName).toBeTruthy();
    expect(item.decidedAt).toBeTruthy();
    expect(item.reason).toBe("NAME_MATCH");
    expect(item.score).toBe(1);
  });

  it("dismissed view orders by decidedAt descending", async () => {
    const productId = await mkProduct("dismissed-order");
    const older = await mkSuggestion(
      productId,
      await mkComponent("dismissed-order-a"),
      { status: "DISMISSED", decidedAt: "2020-01-01T00:00:00Z" },
    );
    const newer = await mkSuggestion(
      productId,
      await mkComponent("dismissed-order-b"),
      { status: "DISMISSED", decidedAt: "2030-01-01T00:00:00Z" },
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?status=DISMISSED&limit=200",
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((i: any) => i.id);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
  });

  it("DECIDED view returns every terminal row — accepted, dismissed, superseded — newest first", async () => {
    const productId = await mkProduct("decided-view");
    const pendingId = await mkSuggestion(productId, await mkComponent("decided-pend"));
    const dismissedId = await mkSuggestion(productId, await mkComponent("decided-dism"));
    const acceptedId = await mkSuggestion(productId, await mkComponent("decided-acc"));
    const supersededId = await mkSuggestion(productId, await mkComponent("decided-sup"), {
      status: "SUPERSEDED",
      decidedAt: "2020-01-01T00:00:00Z",
      decidedBy: adminId,
    });

    await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${dismissedId}/dismiss`,
      ...authed(),
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${acceptedId}/accept`,
      ...authed(),
      payload: {},
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?status=DECIDED&limit=200",
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    const byId = new Map(items.map((i: any) => [i.id, i]));

    // Every terminal status shows up with decider attribution.
    expect(byId.get(dismissedId)?.status).toBe("DISMISSED");
    expect(byId.get(acceptedId)?.status).toBe("ACCEPTED");
    expect(byId.get(supersededId)?.status).toBe("SUPERSEDED");
    for (const id of [dismissedId, acceptedId, supersededId]) {
      expect(byId.get(id)?.decidedAt).toBeTruthy();
      expect(byId.get(id)?.decidedByName).toBeTruthy();
      expect(byId.get(id)?.product.slug).toBe("decided-view");
    }

    // PENDING rows are excluded.
    expect(byId.has(pendingId)).toBe(false);

    // Ordered by decidedAt descending — the seeded 2020 tombstone trails.
    const ids = items.map((i: any) => i.id).filter((id: string) =>
      [dismissedId, acceptedId, supersededId].includes(id),
    );
    expect(ids.indexOf(supersededId)).toBe(ids.length - 1);
  });

  it("VIEWER can read but cannot accept or dismiss", async () => {
    const productId = await mkProduct("viewer-gate");
    const componentId = await mkComponent("viewer-gate-c");
    const suggestionId = await mkSuggestion(productId, componentId);

    const read = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions",
      ...authed(viewerSession),
    });
    expect(read.statusCode).toBe(200);

    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${suggestionId}/accept`,
      ...authed(viewerSession),
      payload: {},
    });
    expect(accept.statusCode).toBe(403);

    const dismiss = await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${suggestionId}/dismiss`,
      ...authed(viewerSession),
      payload: {},
    });
    expect(dismiss.statusCode).toBe(403);
  });
});
