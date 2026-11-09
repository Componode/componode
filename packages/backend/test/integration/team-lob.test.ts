import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
  createPersonInDb,
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
    const row = list.json().data.find((t: any) => t.id === ids.team);
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
    const flat = JSON.stringify(history.json().data);
    expect(flat).toContain("lobId");
  });

  it("records lobId changes in entity history", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/audit/entities/team/${ids.team}`,
      ...authed(),
    });
    expect(res.statusCode).toBe(200);
    const flat = JSON.stringify(res.json().data);
    expect(flat).toContain("lobId");
  });

  it("GET /teams returns memberCount + componentCount per row (spec 039, G22)", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/teams",
      ...authed(),
    });
    expect(list.statusCode).toBe(200);
    const row = list.json().data.find((t: any) => t.id === ids.team);
    expect(typeof row.memberCount).toBe("number");
    expect(typeof row.componentCount).toBe("number");
    expect(typeof row.productCount).toBe("number");
  });

  // FR-005: the displayed counts are SQL subqueries, so they are legal sort
  // keys — fixtures below give the two LOBs opposite teamCount/productCount
  // orders, proving each key sorts by its own subquery.
  it("sorts /teams and /lobs by the derived count columns", async () => {
    const nowIso = now();
    const mkLob = async (slug: string) => {
      const id = uuidv7();
      await testDb.db
        .insertInto("line_of_businesses")
        .values({
          id,
          name: `TL Sort ${slug}`,
          slug,
          description: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        } as never)
        .execute();
      return id;
    };
    const mkTeam = async (slug: string, lobId: string | null) => {
      const id = uuidv7();
      await testDb.db
        .insertInto("teams")
        .values({
          id,
          name: `TL Sort ${slug}`,
          slug,
          description: null,
          lobId,
          createdAt: nowIso,
          updatedAt: nowIso,
        } as never)
        .execute();
      return id;
    };
    const mkProduct = async (slug: string, lobOwnerId: string | null, teamOwnerId: string | null) => {
      await testDb.db
        .insertInto("digital_products")
        .values({
          id: uuidv7(),
          name: `TL Sort ${slug}`,
          slug,
          description: null,
          type: "PLATFORM",
          lifecycle: "ACTIVE",
          lobOwnerId,
          teamOwnerId,
          createdBy: null,
          updatedBy: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        } as never)
        .execute();
    };
    const mkComponent = async (slug: string, teamOwnerId: string) => {
      await testDb.db
        .insertInto("components")
        .values({
          id: uuidv7(),
          name: `TL Sort ${slug}`,
          slug,
          category: "API",
          provider: "GITHUB",
          resourceType: "github:repository",
          lifecycle: "ACTIVE",
          teamOwnerId,
          componentGroupId: null,
          externalId: null,
          details: null,
          lastSeenAt: null,
          lastSeenInRunId: null,
          createdBy: null,
          updatedBy: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        } as any)
        .execute();
    };
    const assignMember = async (teamId: string, username: string) => {
      const pid = await createPersonInDb(testDb.db, { username });
      await testDb.db
        .updateTable("persons")
        .set({ teamId })
        .where("id", "=", pid)
        .execute();
    };

    // lobP owns 2 teams + 1 product; lobQ owns 1 team + 3 products — the
    // two count keys order the LOBs oppositely.
    const lobP = await mkLob("tl-sort-lob-p");
    const lobQ = await mkLob("tl-sort-lob-q");
    const teamP1 = await mkTeam("tl-sort-team-p1", lobP);
    const teamP2 = await mkTeam("tl-sort-team-p2", lobP);
    const teamQ1 = await mkTeam("tl-sort-team-q1", lobQ);

    // Team counts: P1 = 2 members/1 component/1 product,
    // P2 = 1/2/2, Q1 = 0/0/0.
    await assignMember(teamP1, "tl-sort-m1");
    await assignMember(teamP1, "tl-sort-m2");
    await assignMember(teamP2, "tl-sort-m3");
    await mkComponent("tl-sort-comp-1", teamP1);
    await mkComponent("tl-sort-comp-2", teamP2);
    await mkComponent("tl-sort-comp-3", teamP2);
    await mkProduct("tl-sort-tp-1", null, teamP1);
    await mkProduct("tl-sort-tp-2", null, teamP2);
    await mkProduct("tl-sort-tp-3", null, teamP2);
    await mkProduct("tl-sort-lp-1", lobP, null);
    await mkProduct("tl-sort-lq-1", lobQ, null);
    await mkProduct("tl-sort-lq-2", lobQ, null);
    await mkProduct("tl-sort-lq-3", lobQ, null);

    const get = (base: string, qs: string) =>
      app.inject({ method: "GET", url: `/api/v1${base}${qs}`, ...authed() });

    const teamSlugs = async (qs: string) =>
      (await get("/teams", `?search=tl-sort-team&${qs}`)).json().data.map((t: any) => t.slug);
    expect(await teamSlugs("sort=memberCount&order=asc")).toEqual([
      "tl-sort-team-q1",
      "tl-sort-team-p2",
      "tl-sort-team-p1",
    ]);
    expect(await teamSlugs("sort=memberCount&order=desc")).toEqual([
      "tl-sort-team-p1",
      "tl-sort-team-p2",
      "tl-sort-team-q1",
    ]);
    expect(await teamSlugs("sort=componentCount&order=asc")).toEqual([
      "tl-sort-team-q1",
      "tl-sort-team-p1",
      "tl-sort-team-p2",
    ]);
    expect(await teamSlugs("sort=productCount&order=desc")).toEqual([
      "tl-sort-team-p2",
      "tl-sort-team-p1",
      "tl-sort-team-q1",
    ]);

    const lobSlugs = async (qs: string) =>
      (await get("/lobs", `?search=tl-sort-lob&${qs}`)).json().data.map((l: any) => l.slug);
    // teamCount desc → P(2 teams), Q(1); productCount asc → P(1), Q(3):
    // the keys order the same pair oppositely.
    expect(await lobSlugs("sort=teamCount&order=desc")).toEqual(["tl-sort-lob-p", "tl-sort-lob-q"]);
    expect(await lobSlugs("sort=teamCount&order=asc")).toEqual(["tl-sort-lob-q", "tl-sort-lob-p"]);
    expect(await lobSlugs("sort=productCount&order=asc")).toEqual(["tl-sort-lob-p", "tl-sort-lob-q"]);
    expect(await lobSlugs("sort=productCount&order=desc")).toEqual(["tl-sort-lob-q", "tl-sort-lob-p"]);

    // Count keys are endpoint-specific; unknown keys stay 400.
    expect((await get("/teams", "?sort=teamCount")).statusCode).toBe(400);
    expect((await get("/lobs", "?sort=memberCount")).statusCode).toBe(400);
    expect((await get("/teams", "?sort=members")).statusCode).toBe(400);
  });

});
