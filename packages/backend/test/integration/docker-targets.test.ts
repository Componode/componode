import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { randomBytes } from "crypto";
import { uuidv7 } from "uuidv7";

vi.mock("../../src/services/importer-registry.js", async () => {
  const actual = await vi.importActual<any>("../../src/services/importer-registry.js");
  return { ...actual, getImporter: vi.fn(), getManifest: vi.fn(async () => dockerManifest) };
});
import { getImporter, getManifest } from "../../src/services/importer-registry.js";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { loginAs, SESSION_COOKIE_NAME, csrfCookie, csrfHeader, createPersonInDb, createSessionInDb } from "../helpers/api.js";

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
    expect(listed.json().data.some((x: any) => x.id === t.id)).toBe(true);

    const patched = await app.inject({ method: "PATCH", url: `/api/v1/docker-targets/${t.id}`, ...authed({ label: "renamed" }) });
    expect(patched.json().target.label).toBe("renamed");
    const imm = await app.inject({ method: "PATCH", url: `/api/v1/docker-targets/${t.id}`, ...authed({ targetId: "x" }) });
    expect(imm.statusCode).toBe(400);

    expect((await app.inject({ method: "POST", url: `/api/v1/docker-targets/${t.id}/disable`, ...authed() })).json().target.enabled).toBe(false);
    expect((await app.inject({ method: "POST", url: `/api/v1/docker-targets/${t.id}/enable`, ...authed() })).json().target.enabled).toBe(true);

    const audits = await testDb!.db.selectFrom("entity_changes").selectAll().where("entityType", "=", "docker_target").where("entityId", "=", t.id).execute();
    expect(audits.map((a: any) => a.action)).toEqual(expect.arrayContaining(["created", "updated", "disabled", "enabled"]));

    // Activity feed resolves the target label for docker_target rows.
    const feed = await app.inject({ method: "GET", url: "/api/v1/audit/activity?pageSize=50", ...authed() });
    const row = feed.json().data.find((i: any) => i.entityType === "docker_target" && i.entityId === t.id);
    expect(row?.entityName).toBe("renamed");

    expect((await app.inject({ method: "DELETE", url: `/api/v1/docker-targets/${t.id}`, ...authed() })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/v1/docker-targets/${t.id}`, ...authed() })).statusCode).toBe(404);
  });

  // Spec 068 / ADR-130: standardized list contract — envelope, whitelisted
  // sort, search, strict query validation.
  it("paginates, sorts, and searches the target list", async () => {
    // Explicit targetIds — the helper's uuidv7-prefix ids can collide
    // within the same millisecond.
    await createTarget({ targetId: "alpha-t", label: "alpha-target" });
    await createTarget({ targetId: "beta-t", label: "beta-target" });

    const listRes = await app.inject({ method: "GET", url: "/api/v1/docker-targets", ...authed() });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json();
    expect(body.data).toHaveLength(2);
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 25, total: 2, pageCount: 1, hasNext: false });
    // Default sort is name (label) asc.
    expect(body.data.map((t: any) => t.label)).toEqual(["alpha-target", "beta-target"]);

    const pageRes = await app.inject({ method: "GET", url: "/api/v1/docker-targets?pageSize=1&page=2&sort=name&order=desc", ...authed() });
    expect(pageRes.json().data[0].label).toBe("alpha-target");
    expect(pageRes.json().pagination).toMatchObject({ page: 2, total: 2, hasNext: false });

    const searchRes = await app.inject({ method: "GET", url: "/api/v1/docker-targets?search=beta", ...authed() });
    const searched = searchRes.json().data;
    expect(searched).toHaveLength(1);
    expect(searched[0].label).toBe("beta-target");

    // FR-005: targetId/enabled are whitelisted sort keys for the stored
    // columns the Target ID/Status cells render.
    const byTarget = await app.inject({ method: "GET", url: "/api/v1/docker-targets?sort=targetId&order=asc", ...authed() });
    expect(byTarget.statusCode).toBe(200);
    expect(byTarget.json().data.map((t: any) => t.targetId)).toEqual(["alpha-t", "beta-t"]);

    const byEnabled = await app.inject({ method: "GET", url: "/api/v1/docker-targets?sort=enabled&order=desc", ...authed() });
    expect(byEnabled.statusCode).toBe(200);
    expect(byEnabled.json().data).toHaveLength(2);

    for (const url of ["/api/v1/docker-targets?sort=bogus", "/api/v1/docker-targets?bogus=1"]) {
      const res = await app.inject({ method: "GET", url, ...authed() });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    }
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

describe("docker target probe API (spec 063)", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let savedUrl: string | undefined;
  let savedKey: string | undefined;

  beforeEach(async () => {
    savedUrl = process.env.DATABASE_URL;
    savedKey = process.env.COMPONODE_SECRETS_KEY;
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = "admin";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "admin-password-123";
    process.env.COMPONODE_SECRETS_KEY = randomBytes(32).toString("base64");
    vi.resetModules(); vi.clearAllMocks();
    const { resetKeyringCache } = await import("../../src/utils/credential-crypto.js");
    resetKeyringCache();
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
    if (savedKey !== undefined) process.env.COMPONODE_SECRETS_KEY = savedKey;
    else delete process.env.COMPONODE_SECRETS_KEY;
    vi.resetModules();
  });

  const authed = (payload?: unknown) => ({
    cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie }, headers: csrfHeader, payload,
  });
  const probe = (payload: unknown) =>
    app.inject({ method: "POST", url: "/api/v1/docker-targets/probe", ...authed(payload) });
  const mockImporter = (testSecrets: unknown) =>
    vi.mocked(getImporter).mockResolvedValue({ name: "docker", version: "1", testSecrets } as any);

  it("returns ok for a valid secret-free profile and persists nothing", async () => {
    const spy = vi.fn(async () => ({ ok: true }));
    mockImporter(spy);
    const res = await probe({ profile: { transport: "socket", path: "/var/run/docker.sock" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith({}, {}, expect.objectContaining({ transport: "socket" }));
    expect(await testDb!.db.selectFrom("docker_targets").selectAll().execute()).toHaveLength(0);
    expect(await testDb!.db.selectFrom("credentials").selectAll().execute()).toHaveLength(0);
    expect(await testDb!.db.selectFrom("importer_configs").selectAll().execute()).toHaveLength(0);
    const audits = await testDb!.db.selectFrom("entity_changes").selectAll().where("entityType", "=", "docker_target").execute();
    expect(audits).toHaveLength(0);
  });

  it("returns ok:false with the importer error on probe failure", async () => {
    mockImporter(async () => ({ ok: false, error: "Docker probe failed: connect ECONNREFUSED" }));
    const res = await probe({ profile: { transport: "socket", path: "/var/run/docker.sock" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, error: "Docker probe failed: connect ECONNREFUSED" });
  });

  it("rejects an invalid profile before any network call", async () => {
    const spy = vi.fn(async () => ({ ok: true }));
    mockImporter(spy);
    vi.mocked(getManifest).mockResolvedValueOnce({
      ...dockerManifest,
      targetProfileSchema: { safeParse: () => ({ success: false }) },
    } as any);
    const res = await probe({ profile: { transport: "bogus" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects secrets and credentialId together", async () => {
    const res = await probe({ profile: { transport: "socket" }, secrets: { a: "b" }, credentialId: uuidv7() });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("404s on an unknown credentialId", async () => {
    const res = await probe({ profile: { transport: "socket" }, credentialId: uuidv7() });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("CREDENTIAL_NOT_FOUND");
  });

  it("400s CREDENTIAL_MISSING_KEY when the credential lacks required keys", async () => {
    const cred = await app.inject({
      method: "POST", url: "/api/v1/credentials",
      ...authed({ kind: "STORED", label: "partial", secrets: { unrelated: "x" } }),
    });
    expect(cred.statusCode).toBe(201);
    const res = await probe({
      profile: { transport: "tcp", host: "engine.example.com", clientCertKey: "clientCert", clientKeyKey: "clientKey" },
      credentialId: cred.json().credential.id,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_MISSING_KEY");
  });

  it("probes successfully with a covering STORED credential", async () => {
    const spy = vi.fn(async () => ({ ok: true }));
    mockImporter(spy);
    const cred = await app.inject({
      method: "POST", url: "/api/v1/credentials",
      ...authed({ kind: "STORED", label: "mtls", secrets: { clientCert: "CERT", clientKey: "KEY" } }),
    });
    expect(cred.statusCode).toBe(201);
    const res = await probe({
      profile: { transport: "tcp", host: "engine.example.com", clientCertKey: "clientCert", clientKeyKey: "clientKey" },
      credentialId: cred.json().credential.id,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledWith(
      { clientCert: "CERT", clientKey: "KEY" },
      {},
      expect.objectContaining({ transport: "tcp" }),
    );
  });

  it("denies non-admin callers", async () => {
    const viewerId = await createPersonInDb(testDb!.db, { username: "probe-viewer", role: "VIEWER" });
    const { token } = await createSessionInDb(testDb!.db, viewerId);
    const res = await app.inject({
      method: "POST", url: "/api/v1/docker-targets/probe",
      cookies: { [SESSION_COOKIE_NAME]: token, ...csrfCookie }, headers: csrfHeader,
      payload: { profile: { transport: "socket" } },
    });
    expect(res.statusCode).toBe(403);
  });
});
