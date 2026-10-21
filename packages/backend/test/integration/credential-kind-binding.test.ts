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

describe("credential-kind binding enforcement (spec 026 US2)", () => {
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

  async function createCredential(payload: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed(payload),
    });
    expect(res.statusCode).toBe(201);
    return res.json().credential;
  }

  async function insertAgent(name = "agent-1") {
    const id = randomUUID();
    const now = new Date().toISOString();
    await testDb!.db
      .insertInto("import_agents")
      .values({ id, name, createdAt: now, updatedAt: now })
      .execute();
    return id;
  }

  async function insertConfigRow(opts: { agentId?: string | null; importerName?: string }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    await testDb!.db
      .insertInto("importer_configs")
      .values({
        id,
        label: "bound cfg",
        importerName: opts.importerName ?? "github",
        scope: { org: "acme" },
        secretRefs: null,
        schedule: null,
        enabled: true,
        agentId: opts.agentId ?? null,
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    return id;
  }

  const amPayload = {
    kind: "AGENT_MANAGED",
    label: "AM cred",
    secretRefMap: { token: { env: "GH_TOKEN" } },
  };

  it("rejects AGENT_MANAGED credential on a hub-executed config create", async () => {
    const cred = await createCredential(amPayload);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed({
        importerName: "github",
        label: "GH org",
        scope: { org: "acme" },
        credentialIds: [cred.id],
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("CREDENTIAL_KIND_MISMATCH");
    expect(body.message).toContain("AM cred");
  });

  it("rejects AGENT_MANAGED credential on a hub-executed config update", async () => {
    const stored = await createCredential({ label: "Stored", secrets: { token: "v123456789" } });
    const cfgRes = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed({
        importerName: "github",
        label: "GH org",
        scope: { org: "acme" },
        credentialIds: [stored.id],
      }),
    });
    expect(cfgRes.statusCode).toBe(201);
    const configId = cfgRes.json().config.id;

    const am = await createCredential(amPayload);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/importer-configs/${configId}`,
      ...authed({ credentialIds: [am.id] }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_KIND_MISMATCH");
  });

  it("rejects STORED credential on an agent-bound config update", async () => {
    const agentId = await insertAgent();
    const configId = await insertConfigRow({ agentId });
    const stored = await createCredential({ label: "Stored", secrets: { token: "v123456789" } });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/importer-configs/${configId}`,
      ...authed({ credentialIds: [stored.id] }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_KIND_MISMATCH");
  });

  it("accepts AGENT_MANAGED credential on an agent-bound config — coverage from ref keys", async () => {
    const agentId = await insertAgent();
    const configId = await insertConfigRow({ agentId });
    const am = await createCredential(amPayload);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/importer-configs/${configId}`,
      ...authed({ credentialIds: [am.id] }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().config.credentialIds).toContain(am.id);
  });

  it("still reports key collisions across credentials and legacy refs", async () => {
    const stored = await createCredential({ label: "Stored", secrets: { token: "v123456789" } });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed({
        importerName: "github",
        label: "GH org",
        scope: { org: "acme" },
        secretRefs: [{ key: "token", env: "GH_TOKEN" }],
        credentialIds: [stored.id],
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_KEY_COLLISION");
  });

  it("rejects an AGENT_MANAGED credential as the OIDC client secret", async () => {
    const am = await createCredential(amPayload);
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/settings/oidc",
      // enabled:false keeps issuer discovery out of the path — the kind
      // check is what this test exercises.
      ...authed({
        enabled: false,
        clientSecretCredentialId: am.id,
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_KIND_MISMATCH");
  });
});
