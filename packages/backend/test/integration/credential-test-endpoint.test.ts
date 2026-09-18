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

// Stub the importer registry: the endpoint must call the importer's
// testSecrets hook, but no test should ever hit live network (spec U3).
const testSecretsMock = vi.fn();
vi.mock("../../src/services/importer-registry.js", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("../../src/services/importer-registry.js")>();
  return {
    ...orig,
    getImporter: vi.fn(async (name: string) => {
      if (name === "github") {
        return {
          name: "github",
          version: "1.0.0",
          run: async function* () {},
          testSecrets: testSecretsMock,
        };
      }
      return orig.getImporter(name);
    }),
  };
});

describe("POST /api/v1/credentials/:id/test", () => {
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
    testSecretsMock.mockReset();

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
      ...authed({ label: "GitHub PAT", secrets }),
    });
    expect(res.statusCode).toBe(201);
    return res.json().credential.id as string;
  }

  it("passes decrypted secrets to the importer's testSecrets and returns ok", async () => {
    testSecretsMock.mockResolvedValue({ ok: true });
    const id = await createCredential({ token: "ghp_live_secret_1234" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/credentials/${id}/test`,
      ...authed({ importerName: "github", scope: { org: "acme" } }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(testSecretsMock).toHaveBeenCalledWith(
      { token: "ghp_live_secret_1234" },
      { org: "acme" },
    );
    expect(res.body).not.toContain("ghp_live_secret_1234");
  });

  it("returns the importer's failure result without leaking secrets", async () => {
    testSecretsMock.mockResolvedValue({ ok: false, error: "Authentication failed (401)" });
    const id = await createCredential({ token: "ghp_bad_9999" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/credentials/${id}/test`,
      ...authed({ importerName: "github" }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(res.body).not.toContain("ghp_bad_9999");
  });

  it("returns 404 CREDENTIAL_NOT_FOUND for a missing credential", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/credentials/${crypto.randomUUID()}/test`,
      ...authed({ importerName: "github" }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("CREDENTIAL_NOT_FOUND");
  });

  it("returns 400 CREDENTIAL_REVOKED for a revoked credential", async () => {
    const id = await createCredential({ token: "ghp_revoked_1" });
    await testDb!.db
      .updateTable("credentials")
      .set({ status: "REVOKED" })
      .where("id", "=", id)
      .execute();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/credentials/${id}/test`,
      ...authed({ importerName: "github" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_REVOKED");
  });

  it("returns 400 MANIFEST_NO_TEST when the importer has no testSecrets", async () => {
    const id = await createCredential({ token: "ghp_any_1" });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/credentials/${id}/test`,
      // web-url implements no testSecrets hook.
      ...authed({ importerName: "web-url" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("MANIFEST_NO_TEST");
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/credentials/${crypto.randomUUID()}/test`,
      cookies: csrfCookie,
      headers: csrfHeader,
      payload: { importerName: "github" },
    });
    expect(res.statusCode).toBe(401);
  });
});
