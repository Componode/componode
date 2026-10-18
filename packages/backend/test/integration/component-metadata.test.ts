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

async function mkComponent(testDb: TestDb, name: string) {
  const id = uuidv7();
  await testDb.db
    .insertInto("components")
    .values({
      id,
      name,
      slug: name,
      category: "REPOSITORY",
      provider: "GITHUB",
      resourceType: "repo",
      lifecycle: "ACTIVE",
      createdAt: now(),
      updatedAt: now(),
    } as never)
    .execute();
  return id;
}

/** spec 017 — PATCH /components/:id curated metadata + permission gate (T010, FR-008, FR-014). */
describe("component metadata PATCH", () => {
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

    const editorId = await createPersonInDb(testDb.db, { username: "editor-cmeta", role: "EDITOR" });
    editorSession = (await createSessionInDb(testDb.db, editorId)).token;
    const viewerId = await createPersonInDb(testDb.db, { username: "viewer-cmeta", role: "VIEWER" });
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

  it("persists links in order on PATCH /components/:id", async () => {
    const id = await mkComponent(testDb, "meta-links");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${id}`,
      ...authed(editorSession),
      payload: {
        links: [
          { title: "Runbook", url: "https://wiki.example/comp" },
          { title: "Dashboard", url: "https://grafana.example/d/1" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().component.links.map((l: any) => l.title)).toEqual(["Runbook", "Dashboard"]);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/components/${id}`,
      ...authed(editorSession),
    });
    expect(detail.json().component.links).toHaveLength(2);
  });

  it("keeps group-assignment fields working alongside metadata", async () => {
    const id = await mkComponent(testDb, "meta-mixed");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${id}`,
      ...authed(editorSession),
      payload: {
        componentGroupId: null,
        tags: ["beta", " PCI ", "beta"],
        sunsetAt: "2027-01-01T00:00:00.000Z",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().component;
    expect(body.tags).toEqual(["beta", "pci"]);
    expect(body.sunsetAt).toBeTruthy();
  });

  it("PATCH with empty arrays persists empty collections (edge case, T043)", async () => {
    const id = await mkComponent(testDb, "meta-empties");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${id}`,
      ...authed(editorSession),
      payload: {
        links: [{ title: "Docs", url: "https://docs.example" }],
        tags: ["temp"],
      },
    });

    const cleared = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${id}`,
      ...authed(editorSession),
      payload: { links: [], tags: [] },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().component.links).toEqual([]);
    expect(cleared.json().component.tags).toEqual([]);
  });

  it("tag filter normalizes case like writes (T042)", async () => {
    const id = await mkComponent(testDb, "meta-tagfilter");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${id}`,
      ...authed(editorSession),
      payload: { tags: ["pci-dss"] },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/components?tag=PCI-DSS",
      ...authed(editorSession),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((c: any) => c.name === "meta-tagfilter")).toBe(true);
  });

  it("rejects a criticality field on components (FR-008)", async () => {
    const id = await mkComponent(testDb, "meta-crit");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${id}`,
      ...authed(editorSession),
      payload: { criticality: "CRITICAL" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("viewer session is forbidden from metadata edits (FR-014)", async () => {
    const id = await mkComponent(testDb, "meta-403");
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${id}`,
      ...authed(viewerSession),
      payload: { links: [{ title: "x", url: "https://x.example" }] },
    });
    expect(res.statusCode).toBe(403);
  });
});
