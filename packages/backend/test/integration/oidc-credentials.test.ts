import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
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

// OIDC client secret via the credential store (spec 013 US7): the stored
// credential is preferred over the legacy env `clientSecretRef`, and OIDC
// usage protects the credential from deletion.
describe("OIDC credential store", () => {
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
    vi.resetModules();
  });

  function authed(payload: Record<string, unknown>) {
    return {
      cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
      headers: csrfHeader,
      payload,
    };
  }

  async function createCredential(secrets: Record<string, string>) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed({ label: "OIDC secret", secrets }),
    });
    expect(res.statusCode).toBe(201);
    return res.json().credential.id as string;
  }

  it("persists clientSecretCredentialId via PUT /settings/oidc", async () => {
    const credId = await createCredential({ clientSecret: "oidc_secret_1" });
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/settings/oidc",
      ...authed({
        enabled: false,
        issuer: "https://idp.example.com",
        clientId: "componode",
        clientSecretCredentialId: credId,
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().oidcConfig.clientSecretCredentialId).toBe(credId);
    expect(JSON.stringify(res.body)).not.toContain("oidc_secret_1");
  });

  it("reports OIDC as a dependent and blocks credential deletion", async () => {
    const credId = await createCredential({ clientSecret: "oidc_secret_2" });
    await app.inject({
      method: "PUT",
      url: "/api/v1/settings/oidc",
      ...authed({
        enabled: false,
        issuer: "https://idp.example.com",
        clientId: "componode",
        clientSecretCredentialId: credId,
      }),
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/credentials/${credId}`,
      cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(detail.json().dependents.oidc).toBe(true);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/credentials/${credId}`,
      cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
      headers: csrfHeader,
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe("CREDENTIAL_IN_USE");
  });

  it("resolveClientSecret prefers the stored credential over the env ref", async () => {
    process.env.OIDC_LEGACY_SECRET = "legacy_env_secret";
    const credId = await createCredential({ clientSecret: "stored_cred_secret" });
    const { resolveClientSecret } = await import("../../src/services/oidc-service.js");

    const viaCredential = await resolveClientSecret({
      clientSecretCredentialId: credId,
      clientSecretRef: "OIDC_LEGACY_SECRET",
    });
    expect(viaCredential).toBe("stored_cred_secret");

    const viaLegacy = await resolveClientSecret({
      clientSecretCredentialId: null,
      clientSecretRef: "OIDC_LEGACY_SECRET",
    });
    expect(viaLegacy).toBe("legacy_env_secret");
    delete process.env.OIDC_LEGACY_SECRET;
  });

  it("resolveClientSecret fails on a revoked credential", async () => {
    const credId = await createCredential({ clientSecret: "oidc_secret_3" });
    await testDb!.db
      .updateTable("credentials")
      .set({ status: "REVOKED" })
      .where("id", "=", credId)
      .execute();

    const { resolveClientSecret } = await import("../../src/services/oidc-service.js");
    await expect(
      resolveClientSecret({ clientSecretCredentialId: credId, clientSecretRef: null }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_REVOKED" });
  });
});
