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

describe("org entity API (lobs + teams)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let viewerSession: string | undefined;
  let editorSession: string | undefined;
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
    const viewerId = await createPersonInDb(testDb.db, {
      username: "v1",
      role: "VIEWER",
    });
    viewerSession = (await createSessionInDb(testDb.db, viewerId)).token;
    const editorId = await createPersonInDb(testDb.db, {
      username: "e1",
      role: "EDITOR",
    });
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

  it("CRUD works for editor; viewer is read-only", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/lobs",
      ...authed(editorSession),
      payload: { name: "Revenue" },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().lob.slug).toBe("revenue");

    const viewerPost = await app.inject({
      method: "POST",
      url: "/api/v1/lobs",
      ...authed(viewerSession),
      payload: { name: "Nope" },
    });
    expect(viewerPost.statusCode).toBe(403);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/lobs",
      ...authed(viewerSession),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((l: any) => l.slug === "revenue")).toBe(true);
  });

  it("team roster returns members; delete blocked while referenced", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      ...authed(editorSession),
      payload: { name: "Payments Eng" },
    });
    const teamId = create.json().team.id;

    // Assign a person to the team + a product owner reference.
    const memberId = await createPersonInDb(testDb.db, {
      username: "member1",
      role: "VIEWER",
    });
    await testDb.db
      .updateTable("persons")
      .set({ teamId })
      .where("id", "=", memberId)
      .execute();
    await testDb.db
      .insertInto("digital_products")
      .values({
        id: uuidv7(),
        name: "Owned",
        slug: `owned-${Date.now()}`,
        description: null,
        type: "PLATFORM",
        lifecycle: "ACTIVE",
        lobOwnerId: null,
        teamOwnerId: teamId,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();

    const members = await app.inject({
      method: "GET",
      url: `/api/v1/teams/${teamId}/members`,
      ...authed(viewerSession),
    });
    expect(members.statusCode).toBe(200);
    expect(members.json().members.map((m: any) => m.username)).toContain("member1");

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/teams/${teamId}`,
      ...authed(editorSession),
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe("REFERENCED");
    expect(del.json().details.counts.members).toBe(1);
    expect(del.json().details.counts.products).toBe(1);

    // Unassign → delete succeeds
    await testDb.db
      .updateTable("persons")
      .set({ teamId: null })
      .where("id", "=", memberId)
      .execute();
    await testDb.db
      .updateTable("digital_products")
      .set({ teamOwnerId: null })
      .where("teamOwnerId", "=", teamId)
      .execute();
    const del2 = await app.inject({
      method: "DELETE",
      url: `/api/v1/teams/${teamId}`,
      ...authed(editorSession),
    });
    expect(del2.statusCode).toBe(204);
  });

  // Spec 068 / ADR-130: both org lists return the {data, pagination}
  // envelope, validate query params at the route boundary, and carry
  // server-derived counts so pages stop fetching whole collections.
  describe("spec 068 — standardized list contract", () => {
    const get = (base: "/lobs" | "/teams", qs = "") =>
      app.inject({
        method: "GET",
        url: `/api/v1${base}${qs}`,
        ...authed(),
      });

    const insertLob = async (name: string, slug: string, createdAt: string) => {
      const id = uuidv7();
      await testDb.db
        .insertInto("line_of_businesses")
        .values({ id, name, slug, description: null, createdAt, updatedAt: createdAt } as never)
        .execute();
      return id;
    };

    const insertTeam = async (name: string, slug: string, lobId: string | null, createdAt: string) => {
      const id = uuidv7();
      await testDb.db
        .insertInto("teams")
        .values({ id, name, slug, description: null, lobId, createdAt, updatedAt: createdAt } as never)
        .execute();
      return id;
    };

    const insertProduct = async (name: string, slug: string, lobOwnerId: string | null, teamOwnerId: string | null, lifecycle = "ACTIVE") => {
      const id = uuidv7();
      await testDb.db
        .insertInto("digital_products")
        .values({
          id,
          name,
          slug,
          description: null,
          type: "PLATFORM",
          lifecycle,
          lobOwnerId,
          teamOwnerId,
          createdBy: null,
          updatedBy: null,
          createdAt: now(),
          updatedAt: now(),
        } as never)
        .execute();
      return id;
    };

    it("rejects invalid query params with 400 VALIDATION_FAILED", async () => {
      for (const qs of [
        "?page=0",
        "?pageSize=101",
        "?pageSize=abc",
        "?sort=bogus",
        "?order=sideways",
        "?bogusParam=1",
        `?search=${"x".repeat(101)}`,
      ]) {
        for (const base of ["/lobs", "/teams"] as const) {
          const res = await get(base, qs);
          expect(res.statusCode, `${base}${qs}`).toBe(400);
          expect(res.json().code).toBe("VALIDATION_FAILED");
        }
      }
      // Sort whitelists are per-endpoint: `lob` is teams-only, and the
      // FR-005 count keys are endpoint-specific (member/component counts
      // are teams-only; teamCount is lobs-only).
      expect((await get("/lobs", "?sort=lob")).statusCode).toBe(400);
      expect((await get("/teams", "?sort=lob")).statusCode).toBe(200);
      expect((await get("/lobs", "?sort=memberCount")).statusCode).toBe(400);
      expect((await get("/teams", "?sort=memberCount")).statusCode).toBe(200);
      expect((await get("/teams", "?sort=teamCount")).statusCode).toBe(400);
      expect((await get("/lobs", "?sort=teamCount")).statusCode).toBe(200);
      expect((await get("/lobs", "?sort=componentCount")).statusCode).toBe(400);
      expect((await get("/teams", "?sort=componentCount")).statusCode).toBe(200);
    });

    it("paginates /lobs with the shared envelope and honors sort keys", async () => {
      await insertLob("CTR Pagi Alpha", "ctr-pagi-alpha", "2026-01-01T00:00:01.000Z");
      await insertLob("CTR Pagi Beta", "ctr-pagi-beta", "2026-01-01T00:00:03.000Z");
      await insertLob("CTR Pagi Gamma", "ctr-pagi-gamma", "2026-01-01T00:00:02.000Z");

      const p1 = (await get("/lobs", "?search=ctr-pagi&page=1&pageSize=2&sort=name&order=asc")).json();
      expect(p1.data.map((l: any) => l.slug)).toEqual(["ctr-pagi-alpha", "ctr-pagi-beta"]);
      expect(p1.pagination).toMatchObject({
        page: 1,
        pageSize: 2,
        total: 3,
        pageCount: 2,
        hasNext: true,
      });

      const p2 = (await get("/lobs", "?search=ctr-pagi&page=2&pageSize=2&sort=name&order=asc")).json();
      expect(p2.data.map((l: any) => l.slug)).toEqual(["ctr-pagi-gamma"]);
      expect(p2.pagination.hasNext).toBe(false);

      // createdAt desc puts the newest fixture first.
      const byCreated = (await get("/lobs", "?search=ctr-pagi&sort=createdAt&order=desc")).json();
      expect(byCreated.data[0].slug).toBe("ctr-pagi-beta");

      // Envelope shape on the unfiltered list too.
      const all = (await get("/lobs")).json();
      expect(all.pagination.page).toBe(1);
      expect(all.pagination.pageSize).toBe(25);
      expect(all.pagination.total).toBeGreaterThanOrEqual(4);
    });

    it("paginates /teams, sorts by parent LOB name, and searches", async () => {
      const lobA = await insertLob("CTR Sort Zulu", "ctr-sort-zulu", now());
      const lobB = await insertLob("CTR Sort Alpha", "ctr-sort-alpha", now());
      await insertTeam("CTR Team Under Zulu", "ctr-team-zulu", lobA, now());
      await insertTeam("CTR Team Under Alpha", "ctr-team-alpha", lobB, now());
      await insertTeam("CTR Team Floating", "ctr-team-floating", null, now());

      // sort=lob orders by the joined parent LOB name; the unassociated
      // team sorts last under asc (Postgres NULLS LAST).
      const byLob = (await get("/teams", "?search=ctr-team&sort=lob&order=asc")).json();
      expect(byLob.data.map((t: any) => t.slug)).toEqual([
        "ctr-team-alpha",
        "ctr-team-zulu",
        "ctr-team-floating",
      ]);
      expect(byLob.data[2].lob).toBeNull();

      // name desc: Under Zulu > Under Alpha > Floating.
      const byName = (await get("/teams", "?search=ctr-team&sort=name&order=desc&pageSize=2")).json();
      expect(byName.data.map((t: any) => t.slug)).toEqual([
        "ctr-team-zulu",
        "ctr-team-alpha",
      ]);
      expect(byName.pagination.total).toBe(3);

      // name fragment search matches the display name too.
      const byNameSearch = (await get("/teams", "?search=under")).json();
      expect(byNameSearch.pagination.total).toBe(2);
    });

    it("returns derived counts per row for lobs and teams", async () => {
      const lobId = await insertLob("CTR Count LOB", "ctr-count-lob", now());
      const teamId = await insertTeam("CTR Count Team", "ctr-count-team", lobId, now());
      await insertTeam("CTR Count Other", "ctr-count-other", lobId, now());

      // LOB counts: 2 teams + 2 products (one RETIRED still counts — the
      // page used to count with includeRetired).
      await insertProduct("CTR Count Prod A", "ctr-count-prod-a", lobId, null);
      await insertProduct("CTR Count Prod B", "ctr-count-prod-b", lobId, null, "RETIRED");
      // Team counts: 2 members, 2 components, 2 products (one RETIRED).
      for (const uname of ["ctr-m1", "ctr-m2"]) {
        const pid = await createPersonInDb(testDb.db, { username: uname });
        await testDb.db.updateTable("persons").set({ teamId }).where("id", "=", pid).execute();
      }
      const nowIso = now();
      for (const slug of ["ctr-comp-a", "ctr-comp-b"]) {
        await testDb.db
          .insertInto("components")
          .values({
            id: uuidv7(),
            name: slug,
            slug,
            category: "API",
            provider: "GITHUB",
            resourceType: "github:repository",
            lifecycle: "ACTIVE",
            teamOwnerId: teamId,
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
      }
      await insertProduct("CTR Count Team Prod A", "ctr-count-tp-a", null, teamId);
      await insertProduct("CTR Count Team Prod B", "ctr-count-tp-b", null, teamId, "RETIRED");

      const lobRow = (await get("/lobs", "?search=ctr-count-lob")).json().data[0];
      expect(lobRow.teamCount).toBe(2);
      expect(lobRow.productCount).toBe(2);

      const teamRow = (await get("/teams", "?search=ctr-count-team&sort=name")).json().data
        .find((t: any) => t.slug === "ctr-count-team");
      expect(teamRow.memberCount).toBe(2);
      expect(teamRow.componentCount).toBe(2);
      expect(teamRow.productCount).toBe(2);
      expect(teamRow.lob?.slug).toBe("ctr-count-lob");

      const otherRow = (await get("/teams", "?search=ctr-count-other")).json().data[0];
      expect(otherRow.memberCount).toBe(0);
      expect(otherRow.productCount).toBe(0);
    });

    // FR-005: every displayed count column is a legal sort key — the
    // service orders by the same count subquery the row displays.
    it("sorts lobs and teams by the derived count columns", async () => {
      const nowIso = now();
      const insertComponent = (slug: string, teamOwnerId: string) =>
        testDb.db
          .insertInto("components")
          .values({
            id: uuidv7(),
            name: slug,
            slug,
            category: "API",
            provider: "GITHUB",
            resourceType: "github:repository",
            lifecycle: "ACTIVE",
            teamOwnerId,
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
      const assignMember = async (teamId: string, username: string) => {
        const pid = await createPersonInDb(testDb.db, { username });
        await testDb.db
          .updateTable("persons")
          .set({ teamId })
          .where("id", "=", pid)
          .execute();
      };

      // LOBs: hi = 2 teams + 3 products, lo = 1 team + 1 product.
      const lobHi = await insertLob("CTR SCnt Hi", "ctr-scnt-hi", now());
      const lobLo = await insertLob("CTR SCnt Lo", "ctr-scnt-lo", now());
      const teamA = await insertTeam("CTR SCnt Team A", "ctr-scnt-team-a", lobHi, now());
      const teamB = await insertTeam("CTR SCnt Team B", "ctr-scnt-team-b", lobHi, now());
      const teamC = await insertTeam("CTR SCnt Team C", "ctr-scnt-team-c", lobLo, now());
      for (const slug of ["ctr-scnt-prod-1", "ctr-scnt-prod-2", "ctr-scnt-prod-3"]) {
        await insertProduct(`CTR SCnt ${slug}`, slug, lobHi, null);
      }
      await insertProduct("CTR SCnt Prod 4", "ctr-scnt-prod-4", lobLo, null);

      // Team counts: A = 2 members/1 component/1 product,
      // B = 1/2/3, C = 0/0/0 — each key orders differently.
      await assignMember(teamA, "ctr-scnt-m1");
      await assignMember(teamA, "ctr-scnt-m2");
      await assignMember(teamB, "ctr-scnt-m3");
      await insertComponent("ctr-scnt-comp-1", teamA);
      await insertComponent("ctr-scnt-comp-2", teamB);
      await insertComponent("ctr-scnt-comp-3", teamB);
      await insertProduct("CTR SCnt TP A", "ctr-scnt-tp-a", null, teamA);
      await insertProduct("CTR SCnt TP B1", "ctr-scnt-tp-b1", null, teamB);
      await insertProduct("CTR SCnt TP B2", "ctr-scnt-tp-b2", null, teamB);
      await insertProduct("CTR SCnt TP B3", "ctr-scnt-tp-b3", null, teamB);

      const lobSlugs = async (qs: string) =>
        (await get("/lobs", `?search=ctr-scnt&${qs}`)).json().data.map((l: any) => l.slug);
      expect(await lobSlugs("sort=teamCount&order=asc")).toEqual(["ctr-scnt-lo", "ctr-scnt-hi"]);
      expect(await lobSlugs("sort=teamCount&order=desc")).toEqual(["ctr-scnt-hi", "ctr-scnt-lo"]);
      expect(await lobSlugs("sort=productCount&order=asc")).toEqual(["ctr-scnt-lo", "ctr-scnt-hi"]);
      expect(await lobSlugs("sort=productCount&order=desc")).toEqual(["ctr-scnt-hi", "ctr-scnt-lo"]);

      const teamSlugs = async (qs: string) =>
        (await get("/teams", `?search=ctr-scnt-team&${qs}`)).json().data.map((t: any) => t.slug);
      expect(await teamSlugs("sort=memberCount&order=asc")).toEqual([
        "ctr-scnt-team-c",
        "ctr-scnt-team-b",
        "ctr-scnt-team-a",
      ]);
      expect(await teamSlugs("sort=memberCount&order=desc")).toEqual([
        "ctr-scnt-team-a",
        "ctr-scnt-team-b",
        "ctr-scnt-team-c",
      ]);
      expect(await teamSlugs("sort=componentCount&order=asc")).toEqual([
        "ctr-scnt-team-c",
        "ctr-scnt-team-a",
        "ctr-scnt-team-b",
      ]);
      expect(await teamSlugs("sort=componentCount&order=desc")).toEqual([
        "ctr-scnt-team-b",
        "ctr-scnt-team-a",
        "ctr-scnt-team-c",
      ]);
      expect(await teamSlugs("sort=productCount&order=asc")).toEqual([
        "ctr-scnt-team-c",
        "ctr-scnt-team-a",
        "ctr-scnt-team-b",
      ]);
      expect(await teamSlugs("sort=productCount&order=desc")).toEqual([
        "ctr-scnt-team-b",
        "ctr-scnt-team-a",
        "ctr-scnt-team-c",
      ]);
    });
  });
});
