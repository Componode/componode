import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { csrfCookie, csrfHeader, loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";

// Spec 076 T021 — POST /component-edge-suppressions (UX-EDGE-02 Hide edge).

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

const now = () => new Date().toISOString();

async function seedComponent(db: TestDb["db"], slug: string) {
  const id = uuidv7();
  await db
    .insertInto("components")
    .values({
      id,
      name: slug,
      slug,
      category: "LIBRARY",
      provider: "NPM",
      resourceType: "npm:package",
      lifecycle: "ACTIVE",
      teamOwnerId: null,
      externalId: `pkg:npm/${slug}`,
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

async function seedImporterEdge(
  db: TestDb["db"],
  fromId: string,
  toId: string,
  provenance: "IMPORTER" | "CURATED" = "IMPORTER",
) {
  const sourceId =
    provenance === "IMPORTER"
      ? await (async () => {
          const id = uuidv7();
          await db
            .insertInto("importer_sources")
            .values({
              id,
              importerName: "github",
              externalIdentity: `org/src-${id.slice(-6)}`,
              label: null,
              status: "ACTIVE",
              boundConfigId: null,
              firstSeenInRunId: null,
              lastSeenInRunId: null,
              createdAt: now(),
              updatedAt: now(),
            } as never)
            .execute();
          return id;
        })()
      : null;
  await db
    .insertInto("component_depends_on_component")
    .values({
      parentId: fromId,
      childId: toId,
      createdAt: now(),
      provenance,
      importerSourceId: sourceId,
      importRunId: null,
    } as never)
    .execute();
}

describe("POST /component-edge-suppressions", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let editorSession: string | undefined;
  let viewerSession: string | undefined;
  const env: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"]) {
      env[k] = process.env[k];
    }
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    vi.resetModules();

    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);

    for (const [username, password, role] of [
      ["edge-viewer", "ViewerPass123!", "VIEWER"],
      ["edge-editor", "EditorPass123!", "EDITOR"],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/users",
        cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
        headers: csrfHeader,
        payload: { username, password, role },
      });
      expect(res.statusCode).toBe(201);
    }
    viewerSession = await loginAs(app, "edge-viewer", "ViewerPass123!");
    editorSession = await loginAs(app, "edge-editor", "EditorPass123!");
  });

  afterEach(async () => {
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    for (const [k, v] of Object.entries(env)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
    vi.resetModules();
  });

  const post = (session: string, payload: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/v1/component-edge-suppressions",
      cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
      headers: csrfHeader,
      payload,
    });

  const body = (fromComponentId: string, toComponentId: string, extra = {}) => ({
    edgeKind: "DEPENDS_ON",
    fromComponentId,
    toComponentId,
    ...extra,
  });

  async function junctionCount(fromId: string, toId: string) {
    const rows = await testDb!.db
      .selectFrom("component_depends_on_component")
      .selectAll()
      .where("parentId", "=", fromId)
      .where("childId", "=", toId)
      .execute();
    return rows.length;
  }

  async function suppressionCount(fromId: string, toId: string) {
    const rows = await testDb!.db
      .selectFrom("component_edge_suppressions")
      .selectAll()
      .where("fromComponentId", "=", fromId)
      .where("toComponentId", "=", toId)
      .execute();
    return rows.length;
  }

  it("hides an importer edge — suppression + junction delete + audit, idempotent", async () => {
    const a = await seedComponent(testDb!.db, "edge-a");
    const b = await seedComponent(testDb!.db, "edge-b");
    await seedImporterEdge(testDb!.db, a, b);

    const res = await post(editorSession!, body(a, b));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ suppressed: true, edgeRemoved: true });
    expect(await junctionCount(a, b)).toBe(0);
    expect(await suppressionCount(a, b)).toBe(1);

    const audit = await testDb!.db
      .selectFrom("edge_changes")
      .selectAll()
      .where("edgeType", "=", "component_depends_on_component")
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("removed");
    expect(audit[0].reason).toBe("edge-suppressed");

    // Re-hide — idempotent, no duplicate record, no second audit row.
    const res2 = await post(editorSession!, body(a, b));
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toEqual({ suppressed: true, edgeRemoved: false });
    expect(await suppressionCount(a, b)).toBe(1);
  });

  it("records the suppression even when the junction row is already gone", async () => {
    const a = await seedComponent(testDb!.db, "edge-c");
    const b = await seedComponent(testDb!.db, "edge-d");
    const res = await post(editorSession!, body(a, b));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ suppressed: true, edgeRemoved: false });
    expect(await suppressionCount(a, b)).toBe(1);
  });

  it("returns 409 on a curated edge", async () => {
    const a = await seedComponent(testDb!.db, "edge-e");
    const b = await seedComponent(testDb!.db, "edge-f");
    await seedImporterEdge(testDb!.db, a, b, "CURATED");
    const res = await post(editorSession!, body(a, b));
    expect(res.statusCode).toBe(409);
    expect(await junctionCount(a, b)).toBe(1);
    expect(await suppressionCount(a, b)).toBe(0);
  });

  it("returns 404 for a missing component", async () => {
    const a = await seedComponent(testDb!.db, "edge-g");
    const res = await post(editorSession!, body(a, uuidv7()));
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for a Viewer", async () => {
    const a = await seedComponent(testDb!.db, "edge-h");
    const b = await seedComponent(testDb!.db, "edge-i");
    const res = await post(viewerSession!, body(a, b));
    expect(res.statusCode).toBe(403);
  });

  it("rejects unknown fields and bad enum values with 400", async () => {
    const a = await seedComponent(testDb!.db, "edge-j");
    const b = await seedComponent(testDb!.db, "edge-k");
    expect((await post(editorSession!, body(a, b, { extra: 1 }))).statusCode).toBe(400);
    expect(
      (await post(editorSession!, { ...body(a, b), edgeKind: "COMPOSES" })).statusCode,
    ).toBe(400);
  });
});
