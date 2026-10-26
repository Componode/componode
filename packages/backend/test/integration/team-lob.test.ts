import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
} from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

describe("team ↔ LOB association (G12)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  const ids: Record<string, string> = {};
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

    for (const [key, name, slug] of [
      ["lobA", "Retail", "retail"],
      ["lobB", "Platform", "platform"],
    ] as const) {
      ids[key] = uuidv7();
      await testDb.db
        .insertInto("line_of_businesses")
        .values({
          id: ids[key],
          name,
          slug,
          description: null,
          createdAt: now(),
          updatedAt: now(),
        } as never)
        .execute();
    }
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

  it("POST /teams accepts lobId and returns the resolved lob summary", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      ...authed(),
      payload: { name: "Store Ops", lobId: ids.lobA },
    });
    expect(res.statusCode).toBe(201);
    const team = res.json().team;
    expect(team.lobId).toBe(ids.lobA);
    expect(team.lob).toEqual({
      id: ids.lobA,
      name: "Retail",
      slug: "retail",
    });
    ids.team = team.id;
  });

  it("GET /teams and GET /teams/:id embed lobId + lob summary", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/teams",
      ...authed(),
    });
    expect(list.statusCode).toBe(200);
    const row = list.json().teams.find((t: any) => t.id === ids.team);
    expect(row.lobId).toBe(ids.lobA);
    expect(row.lob?.slug).toBe("retail");

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/teams/${ids.team}`,
      ...authed(),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().team.lobId).toBe(ids.lobA);
    expect(detail.json().team.lob?.name).toBe("Retail");
  });

  it("unassociated teams read lobId: null and lob: null", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      ...authed(),
      payload: { name: "Floating Team" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().team.lobId).toBeNull();
    expect(res.json().team.lob).toBeNull();
    ids.freeTeam = res.json().team.id;
  });

  it("PATCH changes and clears the association", async () => {
    const change = await app.inject({
      method: "PATCH",
      url: `/api/v1/teams/${ids.team}`,
      ...authed(),
      payload: { lobId: ids.lobB },
    });
    expect(change.statusCode).toBe(200);
    expect(change.json().team.lobId).toBe(ids.lobB);
    expect(change.json().team.lob?.slug).toBe("platform");

    const clear = await app.inject({
      method: "PATCH",
      url: `/api/v1/teams/${ids.team}`,
      ...authed(),
      payload: { lobId: null },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().team.lobId).toBeNull();
    expect(clear.json().team.lob).toBeNull();
  });

  it("rejects a nonexistent lobId with 400 VALIDATION_FAILED", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      ...authed(),
      payload: { name: "Ghost", lobId: uuidv7() },
    });
    expect(create.statusCode).toBe(400);
    expect(create.json().code).toBe("VALIDATION_FAILED");

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/teams/${ids.freeTeam}`,
      ...authed(),
      payload: { lobId: uuidv7() },
    });
    expect(patch.statusCode).toBe(400);
    expect(patch.json().code).toBe("VALIDATION_FAILED");
  });

  it("rejects lobId on /lobs writes (strict schema, unknown field)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/lobs",
      ...authed(),
      payload: { name: "Nope LOB", lobId: ids.lobA },
    });
    expect(create.statusCode).toBe(400);
    expect(create.json().code).toBe("VALIDATION_FAILED");

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/lobs/${ids.lobA}`,
      ...authed(),
      payload: { lobId: ids.lobB },
    });
    expect(patch.statusCode).toBe(400);
    expect(patch.json().code).toBe("VALIDATION_FAILED");
  });

  it("deleting a LOB clears the association on its teams (not blocked)", async () => {
    // Re-associate the team, then delete the LOB.
    await app.inject({
      method: "PATCH",
      url: `/api/v1/teams/${ids.team}`,
      ...authed(),
      payload: { lobId: ids.lobB },
    });
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/lobs/${ids.lobB}`,
      ...authed(),
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/teams/${ids.team}`,
      ...authed(),
    });
    expect(after.json().team.lobId).toBeNull();
    expect(after.json().team.lob).toBeNull();

    // FR-008: clearing the association is a change to the team — audit it.
    const history = await app.inject({
      method: "GET",
      url: `/api/v1/audit/entities/team/${ids.team}`,
      ...authed(),
    });
    const flat = JSON.stringify(history.json().items);
    expect(flat).toContain("lobId");
  });

  it("records lobId changes in entity history", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/audit/entities/team/${ids.team}`,
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const flat = JSON.stringify(res.json().items);
    expect(flat).toContain("lobId");
  });
});
