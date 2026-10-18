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

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

/** spec 017 US1 — links on products: round-trip, validation, audit, partial update (T009). */
describe("product links metadata", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let editorSession: string | undefined;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"]) {
      saved[k] = process.env[k];
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
    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD))!;

    const editorId = await createPersonInDb(testDb.db, { username: "editor-links", role: "EDITOR" });
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
    cookies: { [SESSION_COOKIE_NAME]: session ?? adminSession, ...csrfCookie },
    headers: csrfHeader,
  });

  it("POST /products accepts links and echoes them", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: {
        name: "Linky",
        type: "PLATFORM",
        links: [
          { title: "Runbook", url: "https://wiki.example/runbook" },
          { title: "Repo", url: "https://github.com/example/repo" },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().product.links).toEqual([
      { title: "Runbook", url: "https://wiki.example/runbook" },
      { title: "Repo", url: "https://github.com/example/repo" },
    ]);
  });

  it("PATCH /products/:id round-trips links in order; omitting links preserves them", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: {
        name: "Orderly",
        type: "PLATFORM",
        links: [
          { title: "A", url: "https://a.example" },
          { title: "B", url: "https://b.example" },
          { title: "C", url: "https://c.example" },
        ],
      },
    });
    const id = created.json().product.id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${id}`,
      ...authed(editorSession),
      payload: { links: [{ title: "B2", url: "https://b2.example" }, { title: "A", url: "https://a.example" }] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().product.links.map((l: any) => l.title)).toEqual(["B2", "A"]);

    // FR-011: omitting the field must not clear it
    const noop = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${id}`,
      ...authed(editorSession),
      payload: { description: "still has links" },
    });
    expect(noop.json().product.links).toHaveLength(2);
  });

  it("rejects malformed links with VALIDATION_FAILED", async () => {
    for (const links of [
      [{ title: "X", url: "javascript:alert(1)" }],
      [{ title: "", url: "https://ok.example" }],
      [{ title: "t".repeat(81), url: "https://ok.example" }],
      [{ title: "X", url: "not-a-url" }],
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/products",
        ...authed(editorSession),
        payload: { name: `bad-${Math.random()}`, type: "PLATFORM", links },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    }
  });

  it("rejects a 21st link", async () => {
    const links = Array.from({ length: 21 }, (_, i) => ({
      title: `l${i}`,
      url: `https://l${i}.example`,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "too-many", type: "PLATFORM", links },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("PATCH with empty arrays persists empty collections (edge case, T043)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: {
        name: `empties-${Date.now()}`,
        type: "PLATFORM",
        links: [{ title: "Docs", url: "https://docs.example" }],
        tags: ["keep-me"],
      },
    });
    const id = created.json().product.id;

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${id}`,
      ...authed(editorSession),
      payload: { links: [], tags: [] },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().product.links).toEqual([]);
    expect(cleared.json().product.tags).toEqual([]);
  });

  it("tag filter normalizes case like writes (T042)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: `tagged-${Date.now()}`, type: "PLATFORM", tags: ["pci-dss"] },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products?tag=PCI-DSS",
      ...authed(editorSession),
    });
    expect(res.statusCode).toBe(200);
    const names = res.json().products.map((p: any) => p.name);
    expect(names.some((n: string) => n.startsWith("tagged-"))).toBe(true);
  });

  it("metadata changes write an entity_changes audit row (FR-012)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: `audit-links-${Date.now()}`, type: "PLATFORM" },
    });
    const id = created.json().product.id;

    await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${id}`,
      ...authed(editorSession),
      payload: { links: [{ title: "Docs", url: "https://docs.example" }] },
    });

    const rows = await testDb.db
      .selectFrom("entity_changes")
      .selectAll()
      .where("entityId", "=", id)
      .where("action", "=", "updated")
      .execute();
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.at(-1)!.changes)).toContain("docs.example");
  });
});
