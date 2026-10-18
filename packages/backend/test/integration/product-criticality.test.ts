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

/** spec 017 US3 — product criticality: round-trip, filter, enum guard (T026). */
describe("product criticality", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let editorSession: string | undefined;
  let viewerSession: string | undefined;
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

    const editorId = await createPersonInDb(testDb.db, { username: "editor-crit", role: "EDITOR" });
    editorSession = (await createSessionInDb(testDb.db, editorId)).token;
    const viewerId = await createPersonInDb(testDb.db, { username: "viewer-crit", role: "VIEWER" });
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

  const authed = (session?: string) => ({
    cookies: { [SESSION_COOKIE_NAME]: session ?? adminSession, ...csrfCookie },
    headers: csrfHeader,
  });

  it("create/update/clear criticality round-trips", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "CritP", type: "PLATFORM", criticality: "HIGH" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().product.id;
    expect(created.json().product.criticality).toBe("HIGH");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${id}`,
      ...authed(editorSession),
      payload: { criticality: "CRITICAL" },
    });
    expect(patched.json().product.criticality).toBe("CRITICAL");

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${id}`,
      ...authed(editorSession),
      payload: { criticality: null },
    });
    expect(cleared.json().product.criticality).toBeNull();
  });

  it("rejects non-enum criticality values", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "BadCrit", type: "PLATFORM", criticality: "TIER_1" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("GET /products?criticality= filters exactly", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "CritF1", slug: "crit-f1", type: "PLATFORM", criticality: "CRITICAL" },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "CritF2", slug: "crit-f2", type: "PLATFORM", criticality: "LOW" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products?criticality=CRITICAL",
      ...authed(editorSession),
    });
    expect(res.statusCode).toBe(200);
    const slugs = res.json().products.map((p: any) => p.slug);
    expect(slugs).toContain("crit-f1");
    expect(slugs).not.toContain("crit-f2");
  });

  it("viewer session is forbidden from criticality edits (FR-014)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "Crit403", type: "PLATFORM" },
    });
    const id = created.json().product.id;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${id}`,
      ...authed(viewerSession),
      payload: { criticality: "HIGH" },
    });
    expect(res.statusCode).toBe(403);
  });
});
