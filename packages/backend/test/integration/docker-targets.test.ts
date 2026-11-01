import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { uuidv7 } from "uuidv7";

vi.mock("../../src/services/importer-registry.js", async () => {
  const actual = await vi.importActual<any>("../../src/services/importer-registry.js");
  return { ...actual, getImporter: vi.fn(), getManifest: vi.fn(async () => dockerManifest) };
});
import { getImporter } from "../../src/services/importer-registry.js";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME, csrfCookie, csrfHeader } from "../helpers/api.js";

const dockerManifest = {
  name: "docker", label: "Docker", description: "t", version: "1.0.0",
  implPath: "x", reportsSourceIdentity: true, targetRefKey: "targetId",
  targetProfileSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
};

describe("docker target management API (spec 049)", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let savedUrl: string | undefined;

  beforeEach(async () => {
    savedUrl = process.env.DATABASE_URL;
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = "admin";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "admin-password-123";
    vi.resetModules(); vi.clearAllMocks();
    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp(); await app.ready();
    adminSession = await loginAs(app, "admin", "admin-password-123");
  });
  afterEach(async () => {
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
    vi.resetModules();
  });

  const authed = (payload?: unknown) => ({
    cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie }, headers: csrfHeader, payload,
  });
  const createTarget = async (over: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST", url: "/api/v1/docker-targets",
      ...authed({ targetId: `t-${uuidv7().slice(0, 8)}`, label: "local", profile: { transport: "socket", path: "/var/run/docker.sock" }, ...over }),
    });

  it("CRUD + lifecycle + audit rows", async () => {
    const created = await createTarget();
    expect(created.statusCode).toBe(201);
    const t = created.json().target;
    expect(t.enabled).toBe(true);

    const listed = await app.inject({ method: "GET", url: "/api/v1/docker-targets", ...authed() });
    expect(listed.json().targets.some((x: any) => x.id === t.id)).toBe(true);

    const patched = await app.inject({ method: "PATCH", url: `/api/v1/docker-targets/${t.id}`, ...authed({ label: "renamed" }) });
    expect(patched.json().target.label).toBe("renamed");
    const imm = await app.inject({ method: "PATCH", url: `/api/v1/docker-targets/${t.id}`, ...authed({ targetId: "x" }) });
    expect(imm.statusCode).toBe(400);

    expect((await app.inject({ method: "POST", url: `/api/v1/docker-targets/${t.id}/disable`, ...authed() })).json().target.enabled).toBe(false);
    expect((await app.inject({ method: "POST", url: `/api/v1/docker-targets/${t.id}/enable`, ...authed() })).json().target.enabled).toBe(true);

    const audits = await testDb!.db.selectFrom("entity_changes").selectAll().where("entityType", "=", "docker_target").where("entityId", "=", t.id).execute();
    expect(audits.map((a: any) => a.action)).toEqual(expect.arrayContaining(["created", "updated", "disabled", "enabled"]));

    // Activity feed resolves the target label for docker_target rows.
    const feed = await app.inject({ method: "GET", url: "/api/v1/audit/activity?limit=50", ...authed() });
    const row = feed.json().items.find((i: any) => i.entityType === "docker_target" && i.entityId === t.id);
    expect(row?.entityName).toBe("renamed");

    expect((await app.inject({ method: "DELETE", url: `/api/v1/docker-targets/${t.id}`, ...authed() })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/v1/docker-targets/${t.id}`, ...authed() })).statusCode).toBe(404);
  });

  it("delete is TARGET_IN_USE while a config references the target", async () => {
    const t = (await createTarget({ targetId: "in-use" })).json().target;
    const cfg = await app.inject({ method: "POST", url: "/api/v1/importer-configs", ...authed({ importerName: "docker", label: "d", scope: { targetId: "in-use" } }) });
    expect(cfg.statusCode).toBe(201);
    const del = await app.inject({ method: "DELETE", url: `/api/v1/docker-targets/${t.id}`, ...authed() });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe("TARGET_IN_USE");
  });

  it("disabled target rejects config assignment and reports test as disabled", async () => {
    const t = (await createTarget({ targetId: "off" })).json().target;
    await app.inject({ method: "POST", url: `/api/v1/docker-targets/${t.id}/disable`, ...authed() });
    const cfg = await app.inject({ method: "POST", url: "/api/v1/importer-configs", ...authed({ importerName: "docker", label: "d", scope: { targetId: "off" } }) });
    expect(cfg.statusCode).toBe(409);
    expect(cfg.json().code).toBe("TARGET_DISABLED");
    const test = await app.inject({ method: "POST", url: `/api/v1/docker-targets/${t.id}/test`, ...authed({}) });
    expect(test.json()).toMatchObject({ ok: false, error: "TARGET_DISABLED" });
  });

  it("test runs the importer /version probe for secret-free profiles", async () => {
    (getImporter as any).mockResolvedValueOnce({ name: "docker", version: "1", testSecrets: async () => ({ ok: true }) });
    const t = (await createTarget({ targetId: "probe" })).json().target;
    const res = await app.inject({ method: "POST", url: `/api/v1/docker-targets/${t.id}/test`, ...authed({}) });
    expect(res.json().ok).toBe(true);
    const audits = await testDb!.db.selectFrom("entity_changes").selectAll().where("entityType", "=", "docker_target").where("entityId", "=", t.id).where("action", "=", "tested").execute();
    expect(audits).toHaveLength(1);
  });
});
