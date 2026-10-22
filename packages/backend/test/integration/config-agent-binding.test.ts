import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
  truncateImportTables,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const TEST_KEY = randomBytes(32).toString("base64");

// Config↔agent binding (spec 027 US1): agentId writable on create/update,
// save-time rejection of every invalid binding, agent summary +
// agentIncompatible on responses.
describe("config agent binding (spec 027 US1)", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    savedEnv = {
      DATABASE_URL: process.env.DATABASE_URL,
      NODE_ENV: process.env.NODE_ENV,
      BOOTSTRAP_ADMIN_USERNAME: process.env.BOOTSTRAP_ADMIN_USERNAME,
      BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD,
      COMPONODE_SECRETS_KEY: process.env.COMPONODE_SECRETS_KEY,
    };

    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.COMPONODE_SECRETS_KEY = TEST_KEY;
    vi.resetModules();

    const { resetKeyringCache } = await import("../../src/utils/credential-crypto.js");
    resetKeyringCache();
    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (testDb) {
      await truncateImportTables(testDb.db);
      await testDb.cleanup();
      testDb = null;
    }
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const { resetKeyringCache } = await import("../../src/utils/credential-crypto.js");
    resetKeyringCache();
    vi.resetModules();
  });

  function authed(payload: Record<string, unknown>) {
    return {
      cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
      headers: csrfHeader,
      payload,
    };
  }

  async function insertAgent(
    name = "agent-1",
    opts: { allowedImporters?: string[]; revoked?: boolean } = {},
  ) {
    const id = randomUUID();
    const now = new Date().toISOString();
    await testDb!.db
      .insertInto("import_agents")
      .values({
        id,
        name,
        allowedImporters: JSON.stringify(opts.allowedImporters ?? []),
        revokedAt: opts.revoked ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    return id;
  }

  async function createAmCred() {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed({
        kind: "AGENT_MANAGED",
        label: "AM",
        secretRefMap: { token: { env: "GH_TOKEN" } },
      }),
    });
    return res.json().credential;
  }

  // github's manifest declares a required "token" key — hub-executed
  // configs cover it with a legacy secretRef, agent-bound configs with an
  // AGENT_MANAGED credential.
  const hubRefs = [{ key: "token", env: "GH_TOKEN" }];

  async function createConfig(payload: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed({ importerName: "github", label: "GH org", scope: { org: "acme" }, ...payload }),
    });
    return res;
  }

  it("binds a config to an agent on create and returns the agent summary", async () => {
    const agentId = await insertAgent("eu-prod");
    const am = await createAmCred();
    const res = await createConfig({ agentId, credentialIds: [am.id] });
    expect(res.statusCode).toBe(201);
    const cfg = res.json().config;
    expect(cfg.agentId).toBe(agentId);
    expect(cfg.agent).toMatchObject({ id: agentId, name: "eu-prod" });
    expect(cfg.agentIncompatible).toBe(false);
  });

  it("creates an in-process config when agentId is absent or null", async () => {
    const res = await createConfig({ secretRefs: hubRefs });
    expect(res.statusCode).toBe(201);
    const cfg = res.json().config;
    expect(cfg.agentId).toBeNull();
    expect(cfg.agent).toBeNull();
  });

  it("rejects an unknown agentId with 404 AGENT_NOT_FOUND", async () => {
    const res = await createConfig({ agentId: randomUUID() });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("AGENT_NOT_FOUND");
  });

  it("rejects a revoked agent with 400 AGENT_INCOMPATIBLE", async () => {
    const agentId = await insertAgent("dead", { revoked: true });
    const res = await createConfig({ agentId });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("AGENT_INCOMPATIBLE");
    expect(res.json().message).toContain("dead");
  });

  it("rejects an agent whose allowedImporters misses the importer; empty set allows all", async () => {
    const narrow = await insertAgent("narrow", { allowedImporters: ["web-url"] });
    const res = await createConfig({ agentId: narrow });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("AGENT_INCOMPATIBLE");
    expect(res.json().message).toContain("github");

    const open = await insertAgent("open", { allowedImporters: [] });
    const am = await createAmCred();
    const res2 = await createConfig({ agentId: open, credentialIds: [am.id] });
    expect(res2.statusCode).toBe(201);
  });

  it("rejects a STORED credential on an agent-bound config create", async () => {
    const agentId = await insertAgent();
    const credRes = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed({ label: "Stored", secrets: { token: "v123456789" } }),
    });
    const cred = credRes.json().credential;
    const res = await createConfig({ agentId, credentialIds: [cred.id] });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_KIND_MISMATCH");
  });

  it("accepts an AGENT_MANAGED credential on an agent-bound config create", async () => {
    const agentId = await insertAgent();
    const credRes = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed({
        kind: "AGENT_MANAGED",
        label: "AM",
        secretRefMap: { token: { env: "GH_TOKEN" } },
      }),
    });
    const cred = credRes.json().credential;
    const res = await createConfig({ agentId, credentialIds: [cred.id] });
    expect(res.statusCode).toBe(201);
  });

  it("switching executor re-validates the effective credential set", async () => {
    // Hub config with a STORED credential — binding it to an agent must fail.
    const credRes = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed({ label: "Stored", secrets: { token: "v123456789" } }),
    });
    const cred = credRes.json().credential;
    const created = await createConfig({ credentialIds: [cred.id] });
    const configId = created.json().config.id;

    const agentId = await insertAgent();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/importer-configs/${configId}`,
      ...authed({ agentId }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_KIND_MISMATCH");
  });

  it("unbinding (agentId null) restores in-process execution", async () => {
    const agentId = await insertAgent();
    const amRes = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed({
        kind: "AGENT_MANAGED",
        label: "AM",
        secretRefMap: { token: { env: "GH_TOKEN" } },
      }),
    });
    const am = amRes.json().credential;
    const created = await createConfig({ agentId, credentialIds: [am.id] });
    const configId = created.json().config.id;

    // Unbind without touching credentials → the AGENT_MANAGED credential is
    // now invalid for a hub-executed config.
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/importer-configs/${configId}`,
      ...authed({ agentId: null }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_KIND_MISMATCH");

    // Swap to a STORED credential and unbind → accepted.
    const storedRes = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed({ label: "S", secrets: { token: "v123456789" } }),
    });
    const stored = storedRes.json().credential;
    const res2 = await app.inject({
      method: "PATCH",
      url: `/api/v1/importer-configs/${configId}`,
      ...authed({ agentId: null, credentialIds: [stored.id] }),
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().config.agentId).toBeNull();
  });

  it("list and detail responses carry agent + agentIncompatible", async () => {
    const narrow = await insertAgent("narrow", { allowedImporters: ["web-url"] });
    const created = await createConfig({ secretRefs: hubRefs });
    expect(created.statusCode).toBe(201);
    const hubId = created.json().config.id;

    // Bind via direct insert to simulate drift (allowedImporters narrowed
    // after binding) — the read-time flag must reflect it.
    const boundId = randomUUID();
    const now = new Date().toISOString();
    await testDb!.db
      .insertInto("importer_configs")
      .values({
        id: boundId,
        label: "drifted",
        importerName: "github",
        scope: {},
        secretRefs: null,
        schedule: null,
        enabled: true,
        agentId: narrow,
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    const rows = list.json().configs;
    const drifted = rows.find((c: any) => c.id === boundId);
    expect(drifted.agentIncompatible).toBe(true);
    expect(drifted.agent.name).toBe("narrow");
    const hub = rows.find((c: any) => c.id === hubId);
    expect(hub.agentIncompatible).toBe(false);
    expect(hub.agent).toBeNull();
  });
});
