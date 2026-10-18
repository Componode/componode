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

async function mkComponent(testDb: TestDb, name: string, tags: string[] = []) {
  const id = uuidv7();
  await testDb.db
    .insertInto("components")
    .values({
      id,
      name,
      slug: name,
      category: "DATABASE",
      provider: "AWS",
      resourceType: "rds:db-instance",
      lifecycle: "ACTIVE",
      tags,
      createdAt: now(),
      updatedAt: now(),
    } as never)
    .execute();
  return id;
}

/** spec 017 US2 — tag normalization + ?tag= exact-match filters (T018). */
describe("tag filters", () => {
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

    const editorId = await createPersonInDb(testDb.db, { username: "editor-tags", role: "EDITOR" });
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

  it("normalizes and dedupes tags on write", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "Tagged", type: "PLATFORM", tags: ["PCI", " pci ", "beta", "pci"] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().product.tags).toEqual(["pci", "beta"]);
  });

  it("GET /products?tag= returns exact matches only", async () => {
    const mk = (name: string, slug: string, tags: string[]) =>
      app.inject({
        method: "POST",
        url: "/api/v1/products",
        ...authed(editorSession),
        payload: { name, slug, type: "PLATFORM", tags },
      });
    await mk("TP1", "tf-p1", ["pci"]);
    await mk("TP2", "tf-p2", ["pci", "beta"]);
    await mk("TP3", "tf-p3", ["beta"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/products?tag=pci",
      ...authed(editorSession),
    });
    expect(res.statusCode).toBe(200);
    const slugs = res.json().products.map((p: any) => p.slug);
    expect(slugs).toContain("tf-p1");
    expect(slugs).toContain("tf-p2");
    expect(slugs).not.toContain("tf-p3");
  });

  it("GET /components?tag= returns exact matches only", async () => {
    await mkComponent(testDb, "tf-c1", ["pci"]);
    await mkComponent(testDb, "tf-c2", ["pci", "beta"]);
    await mkComponent(testDb, "tf-c3", ["beta"]);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components?tag=pci",
      ...authed(editorSession),
    });
    expect(res.statusCode).toBe(200);
    const slugs = res.json().data.map((c: any) => c.slug);
    expect(slugs).toContain("tf-c1");
    expect(slugs).toContain("tf-c2");
    expect(slugs).not.toContain("tf-c3");
  });

  it("rejects invalid tag shapes", async () => {
    for (const tags of [
      ["has space"],
      ["-leading-dash"],
      ["x".repeat(33)],
      Array.from({ length: 21 }, (_, i) => `t${i}`),
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/products",
        ...authed(editorSession),
        payload: { name: `badtag-${Math.random()}`, type: "PLATFORM", tags },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    }
  });
});
