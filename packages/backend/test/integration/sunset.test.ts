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

/** spec 017 US4 — sunsetAt set/clear round-trip + malformed rejection (T031). */
describe("sunsetAt metadata", () => {
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

    const editorId = await createPersonInDb(testDb.db, { username: "editor-sunset", role: "EDITOR" });
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

  it("sets, updates, and clears sunsetAt on a product (FR-011)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "Sunsetting", type: "PLATFORM", sunsetAt: "2027-06-30T00:00:00.000Z" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().product.id;
    expect(created.json().product.sunsetAt).toBeTruthy();

    // Omitting the field leaves it set
    const noop = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${id}`,
      ...authed(editorSession),
      payload: { description: "unchanged sunset" },
    });
    expect(noop.json().product.sunsetAt).toBeTruthy();

    // Explicit null clears it
    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${id}`,
      ...authed(editorSession),
      payload: { sunsetAt: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().product.sunsetAt).toBeNull();
  });

  it("sets sunsetAt on a component via PATCH", async () => {
    const id = uuidv7();
    await testDb.db
      .insertInto("components")
      .values({
        id,
        name: "sunset-comp",
        slug: "sunset-comp",
        category: "DATABASE",
        provider: "AWS",
        resourceType: "rds:db-instance",
        lifecycle: "ACTIVE",
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${id}`,
      ...authed(editorSession),
      payload: { sunsetAt: "2027-01-15T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().component.sunsetAt).toBeTruthy();
  });

  it("rejects a malformed sunsetAt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(editorSession),
      payload: { name: "BadSunset", type: "PLATFORM", sunsetAt: "next-tuesday" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});
