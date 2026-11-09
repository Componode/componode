import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("users CRUD", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let originalDbUrl: string | undefined;
  let originalNodeEnv: string | undefined;
  let originalBootstrapUsername: string | undefined;
  let originalBootstrapPassword: string | undefined;

  beforeEach(async () => {
    originalDbUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    originalBootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
    originalBootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

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
  });

  afterEach(async () => {
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    else delete process.env.DATABASE_URL;
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalBootstrapUsername !== undefined) process.env.BOOTSTRAP_ADMIN_USERNAME = originalBootstrapUsername;
    else delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    if (originalBootstrapPassword !== undefined) process.env.BOOTSTRAP_ADMIN_PASSWORD = originalBootstrapPassword;
    else delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    vi.resetModules();
  });

  it("admin creates a user via POST /api/v1/users → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        username: "newuser",
        password: "NewUserPassword123!",
        role: "VIEWER",
        displayName: "New User",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toBeDefined();
    expect(body.user.username).toBe("newuser");
    expect(body.user.role).toBe("VIEWER");
    expect(body.user.id).toBeDefined();
  });

  it("admin create user with password < 12 chars → 400 (ADR-099)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        username: "shortpwuser",
        password: "ShortPwd9!",
        role: "VIEWER",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("admin lists users via GET /api/v1/users → 200 + array", async () => {
    // Create a user first
    await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        username: "listeduser",
        password: "ListedUser123!",
        role: "EDITOR",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession! },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect(body.pagination.total).toBeGreaterThanOrEqual(2);

    // lastActiveAt = most recent session sighting — the calling admin
    // just logged in, so it must be set; the fresh user never signed in.
    const admin = body.data.find((u: { username: string }) => u.username === ADMIN_USERNAME);
    const listed = body.data.find((u: { username: string }) => u.username === "listeduser");
    expect(admin.lastActiveAt).toBeTruthy();
    expect(listed.lastActiveAt).toBeNull();
  });

  it("admin updates a user role via PATCH /api/v1/users/:id → 200", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        username: "roleupdate",
        password: "RoleUpdate123!",
        role: "VIEWER",
      },
    });
    const created = createRes.json().user;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${created.id}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: { role: "EDITOR" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe("EDITOR");
  });

  it("duplicate username returns 409", async () => {
    const payload = {
      username: "dupuser",
      password: "DupUser12345!",
      role: "VIEWER",
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload,
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("AUTH_USERNAME_TAKEN");
  });

  it("uses uuidv7-shaped ids for created users", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        username: "uuiduser",
        password: "UuidUser123!",
        role: "VIEWER",
      },
    });
    const id = res.json().user.id;
    // uuidv7 is a 36-char UUID; just sanity-check it is a UUID string
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // ensure it's not the zero/sentinel value
    expect(id).not.toBe(uuidv7());
  });

  describe("PATCH /api/v1/users/me (self-service, spec 030)", () => {
    async function createNonAdminAndLogin(username: string, role = "VIEWER") {
      const password = "SelfEdit12345!";
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/users",
        cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
        headers: csrfHeader,
        payload: { username, password, role },
      });
      const user = res.json().user;
      const session = await loginAs(app, username, password);
      return { user, session: session! };
    }

    it("non-admin updates own displayName and email → 200 + persists", async () => {
      const { session } = await createNonAdminAndLogin("selfedit1");

      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me",
        cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
        headers: csrfHeader,
        payload: { displayName: "Self Editor", email: "self@example.com" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user.displayName).toBe("Self Editor");
      expect(res.json().user.email).toBe("self@example.com");

      const me = await app.inject({
        method: "GET",
        url: "/api/v1/users/me",
        cookies: { [SESSION_COOKIE_NAME]: session },
      });
      expect(me.json().user.displayName).toBe("Self Editor");
      expect(me.json().user.email).toBe("self@example.com");
    });

    it("empty body {} → 200 no-op returning current record", async () => {
      const { session } = await createNonAdminAndLogin("selfedit2");

      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me",
        cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
        headers: csrfHeader,
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user.username).toBe("selfedit2");
    });

    it.each(["EDITOR", "ADMIN"])(
      "%s user also self-updates via PATCH /users/me → 200 (US1/AC4, SC-001)",
      async (role) => {
        const { session } = await createNonAdminAndLogin(
          `self-${role.toLowerCase()}`,
          role,
        );

        const res = await app.inject({
          method: "PATCH",
          url: "/api/v1/users/me",
          cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
          headers: csrfHeader,
          payload: { displayName: `${role} Self` },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().user.displayName).toBe(`${role} Self`);
      },
    );

    it("unauthenticated → 401", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me",
        cookies: csrfCookie,
        headers: csrfHeader,
        payload: { displayName: "Nobody" },
      });

      expect(res.statusCode).toBe(401);
    });

    it.each(["role", "isActive", "teamId", "username", "password", "id"])(
      "rejects privileged/unknown key %s → 400 and record unchanged",
      async (key) => {
        const { session } = await createNonAdminAndLogin(
          `strict-${key.toLowerCase()}`,
        );

        const res = await app.inject({
          method: "PATCH",
          url: "/api/v1/users/me",
          cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
          headers: csrfHeader,
          payload: { [key]: key === "role" ? "ADMIN" : "x", displayName: "Sneaky" },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe("VALIDATION_FAILED");

        const me = await app.inject({
          method: "GET",
          url: "/api/v1/users/me",
          cookies: { [SESSION_COOKIE_NAME]: session },
        });
        expect(me.json().user.displayName).not.toBe("Sneaky");
        expect(me.json().user.role).toBe("VIEWER");
      },
    );

    it("cleared displayName stores null — single empty representation", async () => {
      const { session } = await createNonAdminAndLogin("clearname");

      await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me",
        cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
        headers: csrfHeader,
        payload: { displayName: "Has Name" },
      });

      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me",
        cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
        headers: csrfHeader,
        payload: { displayName: "" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user.displayName).toBeNull();
    });

    it("non-admin cannot reach the admin path — PATCH /users/:id still 403", async () => {
      const { user, session } = await createNonAdminAndLogin("boundary1");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/users/${user.id}`,
        cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
        headers: csrfHeader,
        payload: { role: "ADMIN" },
      });

      expect(res.statusCode).toBe(403);
    });

    it("self-edit writes an audited user change attributed to the caller", async () => {
      const { user, session } = await createNonAdminAndLogin("selfaudit");

      const patch = await app.inject({
        method: "PATCH",
        url: "/api/v1/users/me",
        cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
        headers: csrfHeader,
        payload: { displayName: "Audited Self", email: "audit@example.com" },
      });
      expect(patch.statusCode).toBe(200);

      const feed = await app.inject({
        method: "GET",
        url: "/api/v1/audit/activity?actor=selfaudit&entityType=user",
        cookies: { [SESSION_COOKIE_NAME]: adminSession! },
      });
      expect(feed.statusCode).toBe(200);
      const items = feed.json().data;
      const entry = items.find(
        (i: { entityId: string; action: string }) =>
          i.entityId === user.id && i.action === "updated",
      );
      expect(entry).toBeDefined();
      expect(entry.createdByName).toBe("selfaudit");
      expect(entry.changes.displayName).toBe("Audited Self");
      expect(entry.changes.email).toBe("audit@example.com");
    });
  });

  // Spec 068 / ADR-130: GET /users returns the {data, pagination}
  // envelope, validates query params at the route boundary, and never
  // exposes credential columns.
  describe("spec 068 — standardized list contract", () => {
    const get = (qs = "") =>
      app.inject({
        method: "GET",
        url: `/api/v1/users${qs}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession! },
      });

    const createUser = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/api/v1/users",
        cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
        headers: csrfHeader,
        payload,
      });

    it("rejects invalid query params with 400 VALIDATION_FAILED", async () => {
      for (const qs of [
        "?page=0",
        "?pageSize=101",
        "?sort=bogus",
        "?order=sideways",
        "?role=SUPERUSER",
        "?bogusParam=1",
      ]) {
        const res = await get(qs);
        expect(res.statusCode, qs).toBe(400);
        expect(res.json().code).toBe("VALIDATION_FAILED");
      }
    });

    it("returns the {data, pagination} envelope without credential fields", async () => {
      const created = await createUser({
        username: "env-user",
        password: "EnvUser12345!",
        role: "VIEWER",
      });
      expect(created.statusCode).toBe(201);

      const res = await get("");
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.data)).toBe(true);
      // admin + env-user
      expect(body.pagination).toMatchObject({
        page: 1,
        pageSize: 25,
        total: 2,
        pageCount: 1,
        hasNext: false,
      });
      for (const u of body.data) {
        expect(u).not.toHaveProperty("passwordHash");
        expect(u).not.toHaveProperty("oidcSubject");
      }
      // Default sort is createdAt desc — the just-created user leads.
      expect(body.data[0].username).toBe("env-user");

      const p1 = (await get("?page=1&pageSize=1")).json();
      expect(p1.data).toHaveLength(1);
      expect(p1.pagination).toMatchObject({
        page: 1,
        pageSize: 1,
        total: 2,
        pageCount: 2,
        hasNext: true,
      });
      const p2 = (await get("?page=2&pageSize=1")).json();
      expect(p2.data).toHaveLength(1);
      expect(p2.data[0].username).toBe(ADMIN_USERNAME);
      expect(p2.pagination.hasNext).toBe(false);
    });

    it("honors the sort whitelist (name/role/isActive/lastActiveAt/createdAt)", async () => {
      // coalesce(displayName, username): "Aaron" sorts before "admin" and
      // before sort-amy's username fallback.
      const zoe = await createUser({
        username: "sort-zoe",
        password: "SortZoe12345!",
        role: "VIEWER",
        displayName: "Aaron",
      });
      const amy = await createUser({
        username: "sort-amy",
        password: "SortAmy12345!",
        role: "EDITOR",
      });
      expect(zoe.statusCode).toBe(201);
      expect(amy.statusCode).toBe(201);

      const byName = (await get("?search=sort-&sort=name&order=asc")).json();
      expect(byName.data.map((u: any) => u.username)).toEqual([
        "sort-zoe",
        "sort-amy",
      ]);

      const byRole = (await get("?search=sort-&sort=role&order=asc")).json();
      expect(byRole.data.map((u: any) => u.role)).toEqual(["EDITOR", "VIEWER"]);

      // Deactivate zoe — isActive asc puts the inactive row first.
      const zoeId = zoe.json().user.id;
      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/users/${zoeId}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
        headers: csrfHeader,
        payload: { isActive: false },
      });
      expect(patch.statusCode).toBe(200);
      const byActive = (await get("?search=sort-&sort=isActive&order=asc")).json();
      expect(byActive.data.map((u: any) => u.username)).toEqual([
        "sort-zoe",
        "sort-amy",
      ]);

      // lastActiveAt asc: only the calling admin has a session sighting,
      // and non-null sorts before the never-active rows (NULLS LAST).
      const byActive2 = (await get("?sort=lastActiveAt&order=asc&pageSize=5")).json();
      expect(byActive2.data[0].username).toBe(ADMIN_USERNAME);
      expect(byActive2.data[0].lastActiveAt).toBeTruthy();

      // createdAt ordering is monotonic in both directions.
      const asc = (await get("?sort=createdAt&order=asc")).json().data;
      for (let i = 1; i < asc.length; i++) {
        expect(asc[i].createdAt >= asc[i - 1].createdAt).toBe(true);
      }
      const desc = (await get("?sort=createdAt&order=desc")).json().data;
      for (let i = 1; i < desc.length; i++) {
        expect(desc[i].createdAt <= desc[i - 1].createdAt).toBe(true);
      }
    });

    it("filters by role/isActive and searches display fields", async () => {
      await createUser({
        username: "find-me",
        password: "FindMe12345!",
        role: "EDITOR",
        displayName: "Unique Findable",
        email: "findable@example.com",
      });
      const other = await createUser({
        username: "other-user",
        password: "OtherUser12345!",
        role: "VIEWER",
      });
      expect(other.statusCode).toBe(201);
      await app.inject({
        method: "PATCH",
        url: `/api/v1/users/${other.json().user.id}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
        headers: csrfHeader,
        payload: { isActive: false },
      });

      // Search covers username, displayName, and email (ilike).
      for (const term of ["findable", "FINDABLE", "findable@example", "find-me"]) {
        const res = await get(`?search=${encodeURIComponent(term)}`);
        expect(res.statusCode, term).toBe(200);
        expect(res.json().pagination.total, term).toBe(1);
        expect(res.json().data[0].username).toBe("find-me");
      }
      expect((await get("?search=nomatch-zzz")).json().pagination.total).toBe(0);

      expect((await get("?role=EDITOR")).json().data.every((u: any) => u.role === "EDITOR")).toBe(true);
      const inactive = (await get("?isActive=false")).json();
      expect(inactive.data.length).toBeGreaterThanOrEqual(1);
      expect(inactive.data.every((u: any) => u.isActive === false)).toBe(true);
      expect(inactive.data.map((u: any) => u.username)).toContain("other-user");
    });
  });
});
