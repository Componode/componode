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
        // undefined → signal defaults; explicit null → tombstone shape
        // (SUPERSEDED rows carry NULL reason/score per ADR-113).
        reason: opts.reason === undefined ? "NAME_MATCH" : opts.reason,
        score: opts.score === undefined ? 100 : opts.score,
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
    const { data: items, pagination } = res.json();
    expect(pagination.total).toBeGreaterThanOrEqual(3);
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
    const ids = res.json().data.map((i: any) => i.id);
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
    const item = res.json().data.find((i: any) => i.id === suggestionId);
    expect(item).toBeDefined();
    expect(item.decidedByName).toBeTruthy();
    expect(item.decidedAt).toBeTruthy();
    expect(item.reason).toBe("NAME_MATCH");
    expect(item.score).toBe(1);
  });

  // Spec 068 / ADR-130: decided-history views keep their decision-recency
  // ordering — `decidedAt` is a whitelisted sort key and the effective
  // default for non-pending views; `createdAt` remains available.
  it("dismissed view honors sort=createdAt&order=desc", async () => {
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
      url: "/api/v1/suggestions?status=DISMISSED&sort=createdAt&order=desc&pageSize=100",
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((i: any) => i.id);
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
      url: "/api/v1/suggestions?status=DECIDED&pageSize=100",
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data;
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

    // Spec 068: decided views default to decidedAt desc — the seeded
    // tombstone (decided 2020) trails the just-decided rows.
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

  // Spec 068 regression: decided views must order by decidedAt — a
  // NULL-score SUPERSEDED tombstone sorted by `score DESC` would surface
  // FIRST in Postgres (NULLS FIRST is the default for DESC) ahead of real
  // decisions. The decided-history ordering is decidedAt desc + id.
  it("decided views order by decidedAt desc — NULL-score tombstones don't jump ahead", async () => {
    const productId = await mkProduct("decided-nulls-first");
    // Newly decided DISMISSED row (keeps its score) vs an older
    // SUPERSEDED tombstone (score NULL). Buggy score-DESC ordering puts
    // the tombstone first; decidedAt ordering puts the newer decision first.
    const dismissedId = await mkSuggestion(
      productId,
      await mkComponent("decided-nulls-d"),
      {
        status: "DISMISSED",
        score: 100,
        decidedAt: "2040-06-10T00:00:00Z",
        decidedBy: adminId,
      },
    );
    const tombstoneId = await mkSuggestion(
      productId,
      await mkComponent("decided-nulls-t"),
      {
        status: "SUPERSEDED",
        reason: null,
        score: null,
        decidedAt: "2040-06-01T00:00:00Z",
        decidedBy: adminId,
      },
    );

    for (const url of [
      // Default sort resolves to decidedAt on decided views.
      "/api/v1/suggestions?status=DECIDED&pageSize=100",
      // Explicit decidedAt sort.
      "/api/v1/suggestions?status=DECIDED&sort=decidedAt&pageSize=100",
      // score maps to decidedAt on decided views (tombstone scores are NULL).
      "/api/v1/suggestions?status=DECIDED&sort=score&pageSize=100",
    ]) {
      const res = await app.inject({ method: "GET", url, ...authed() });
      expect(res.statusCode).toBe(200);
      const ids = res.json().data.map((i: any) => i.id);
      expect(ids.indexOf(dismissedId)).toBeLessThan(ids.indexOf(tombstoneId));
    }

    // The per-status DISMISSED view orders the same way and simply excludes
    // the SUPERSEDED tombstone — our 2040-06-10 decision is the newest
    // dismissed row in the suite, so it leads the view.
    const dismissedRes = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?status=DISMISSED&pageSize=100",
      ...authed(),
    });
    expect(dismissedRes.statusCode).toBe(200);
    const dismissedIds = dismissedRes.json().data.map((i: any) => i.id);
    expect(dismissedIds[0]).toBe(dismissedId);
    expect(dismissedIds).not.toContain(tombstoneId);
  });

  it("paginates the decided history by decidedAt across pages", async () => {
    const productId = await mkProduct("decided-pages");
    const ids: string[] = [];
    // decidedAt 2041-* — newer than every other decided row in the suite,
    // so these five occupy the top of the DECIDED feed deterministically.
    for (let i = 1; i <= 5; i++) {
      ids.push(
        await mkSuggestion(productId, await mkComponent(`decided-pages-${i}`), {
          status: "DISMISSED",
          decidedAt: `2041-01-0${i}T00:00:00Z`,
          decidedBy: adminId,
        }),
      );
    }
    // decidedAt desc → ids[4] (2041-01-05) first … ids[0] last.

    const page1 = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?status=DECIDED&sort=decidedAt&page=1&pageSize=2",
      ...authed(),
    });
    const page2 = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?status=DECIDED&sort=decidedAt&page=2&pageSize=2",
      ...authed(),
    });
    const page3 = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?status=DECIDED&sort=decidedAt&page=3&pageSize=2",
      ...authed(),
    });
    for (const res of [page1, page2, page3]) expect(res.statusCode).toBe(200);

    const idsOf = (res: any) => res.json().data.map((i: any) => i.id);
    expect(idsOf(page1).slice(0, 2)).toEqual([ids[4], ids[3]]);
    expect(idsOf(page2).slice(0, 2)).toEqual([ids[2], ids[1]]);
    // Page 3 leads with the oldest of our rows; slot 2 is the next-oldest
    // decided row from earlier tests.
    expect(idsOf(page3)[0]).toBe(ids[0]);

    const p1 = page1.json().pagination;
    const p3 = page3.json().pagination;
    expect(p1.total).toBe(p3.total);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(2);
    expect(p1.hasNext).toBe(true);
    expect(p3.hasNext).toBe(true); // older decided rows remain
  });

  it("accepts sort=decidedAt on the pending queue (maps to createdAt) and rejects bad sorts", async () => {
    const pendingSort = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?status=PENDING&sort=decidedAt&pageSize=5",
      ...authed(),
    });
    expect(pendingSort.statusCode).toBe(200);

    const badSort = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?sort=bogus",
      ...authed(),
    });
    expect(badSort.statusCode).toBe(400);
    expect(badSort.json().code).toBe("VALIDATION_FAILED");
  });

  // Spec 068 T059 / FR-005: `status` is a stored column rendered as the
  // decision badge — whitelisted for sorting. It is constant within the
  // PENDING/DISMISSED views but a real ordering across DECIDED history.
  it("sorts the DECIDED history by status in both directions", async () => {
    const productId = await mkProduct("status-sort");
    // decidedAt far in the future so these rows lead every decided view —
    // but status sort ignores decidedAt, so only the status sequence matters.
    const seeded = {
      dismissed: await mkSuggestion(productId, await mkComponent("status-sort-d"), {
        status: "DISMISSED",
        decidedAt: "2043-01-01T00:00:00Z",
        decidedBy: adminId,
      }),
      accepted: await mkSuggestion(productId, await mkComponent("status-sort-a"), {
        status: "ACCEPTED",
        decidedAt: "2043-01-02T00:00:00Z",
        decidedBy: adminId,
      }),
      superseded: await mkSuggestion(productId, await mkComponent("status-sort-s"), {
        status: "SUPERSEDED",
        reason: null,
        score: null,
        decidedAt: "2043-01-03T00:00:00Z",
        decidedBy: adminId,
      }),
    };

    const fetchStatuses = async (order: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/suggestions?status=DECIDED&sort=status&order=${order}&pageSize=100`,
        ...authed(),
      });
      expect(res.statusCode).toBe(200);
      return res.json().data as { id: string; status: string }[];
    };

    const asc = await fetchStatuses("asc");
    const statusesAsc = asc.map((i) => i.status);
    // ACCEPTED < DISMISSED < SUPERSEDED — the whole decided view is sorted.
    expect(statusesAsc).toEqual([...statusesAsc].sort());
    const oursAsc = asc.filter((i) => Object.values(seeded).includes(i.id));
    expect(oursAsc.map((i) => i.id)).toEqual([
      seeded.accepted,
      seeded.dismissed,
      seeded.superseded,
    ]);

    const desc = await fetchStatuses("desc");
    const statusesDesc = desc.map((i) => i.status);
    expect(statusesDesc).toEqual([...statusesDesc].sort().reverse());
    const oursDesc = desc.filter((i) => Object.values(seeded).includes(i.id));
    expect(oursDesc.map((i) => i.id)).toEqual([
      seeded.superseded,
      seeded.dismissed,
      seeded.accepted,
    ]);
  });

  it("accepts sort=status on the pending queue (constant column) and rejects search", async () => {
    const pendingSort = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?status=PENDING&sort=status&pageSize=5",
      ...authed(),
    });
    expect(pendingSort.statusCode).toBe(200);

    // Spec 068 T061 / FR-006: the queue has no server-side search — the
    // shared `search` param is omitted from the strict schema.
    const search = await app.inject({
      method: "GET",
      url: "/api/v1/suggestions?search=dep",
      ...authed(),
    });
    expect(search.statusCode).toBe(400);
    expect(search.json().code).toBe("VALIDATION_FAILED");
  });
});
