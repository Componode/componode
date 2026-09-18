import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
  createPersonInDb,
  createSessionInDb,
  truncateImportTables,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const TEST_KEY = randomBytes(32).toString("base64");

describe("credential store", () => {
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

  describe("POST /api/v1/credentials", () => {
    it("creates a credential and returns masked hints only", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ label: "GitHub PAT", secrets: { token: "ghp_supersecret" } }),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.credential.label).toBe("GitHub PAT");
      expect(body.credential.status).toBe("ACTIVE");
      expect(body.credential.keyHints.token).toBe("cret");
      expect(JSON.stringify(body)).not.toContain("ghp_supersecret");
      expect(body.credential.secrets).toBeUndefined();
      expect(body.credential.encryptedPayload).toBeUndefined();
    });

    it("stores the payload encrypted at rest", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ label: "GitHub PAT", secrets: { token: "ghp_supersecret" } }),
      });
      const id = res.json().credential.id;
      const row = await testDb!.db
        .selectFrom("credentials")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.encryptedPayload).not.toContain("ghp_supersecret");
      expect(row.encryptedPayload.startsWith("v1.")).toBe(true);
      expect(row.keyVersion).toBe(1);
    });

    it("records a credential.created audit entry without secret values", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ label: "GitHub PAT", secrets: { token: "ghp_supersecret" } }),
      });
      const id = res.json().credential.id;
      const change = await testDb!.db
        .selectFrom("entity_changes")
        .selectAll()
        .where("entityType", "=", "credential")
        .where("entityId", "=", id)
        .where("action", "=", "created")
        .executeTakeFirstOrThrow();
      expect(JSON.stringify(change.changes)).not.toContain("ghp_supersecret");
    });

    it("rejects invalid input", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ label: "", secrets: {} }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });

    it("denies non-admin users", async () => {
      const db = testDb!.db;
      const viewerId = await createPersonInDb(db, { username: "viewer", role: "VIEWER" });
      const { token } = await createSessionInDb(db, viewerId);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: token },
        headers: csrfHeader,
        payload: { label: "x", secrets: { token: "t" } },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /api/v1/credentials", () => {
    it("lists credentials without plaintext", async () => {
      await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ label: "A", secrets: { token: "ghp_first" } }),
      });
      await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ label: "B", secrets: { token: "ghp_second" } }),
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/credentials",
        cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.credentials).toHaveLength(2);
      const raw = JSON.stringify(body);
      expect(raw).not.toContain("ghp_first");
      expect(raw).not.toContain("ghp_second");
    });
  });

  describe("GET /api/v1/credentials/:id", () => {
    it("returns detail with dependents shape", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ label: "GitHub PAT", secrets: { token: "ghp_x" } }),
      });
      const id = created.json().credential.id;
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/credentials/${id}`,
        cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.credential.id).toBe(id);
      expect(body.dependents).toEqual({ importerConfigs: [], oidc: false });
    });

    it("404s for unknown id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/credentials/00000000-0000-7000-8000-000000000000",
        cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("CREDENTIAL_NOT_FOUND");
    });
  });

  describe("PATCH /api/v1/credentials/:id", () => {
    async function createCred(secrets: Record<string, string> = { token: "ghp_original_value" }) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ label: "PAT", secrets }),
      });
      return res.json().credential;
    }

    it("updates label and expiresAt", async () => {
      const cred = await createCred();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/credentials/${cred.id}`,
        ...authed({ label: "Renamed PAT", expiresAt: "2030-01-01T00:00:00Z" }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().credential.label).toBe("Renamed PAT");
      expect(res.json().credential.expiresAt).toContain("2030-01-01");
    });

    it("rotates the secret payload in place, preserving id and dependents", async () => {
      const cred = await createCred({ token: "ghp_old_token" });
      // Link it to an importer config first.
      const configRes = await app.inject({
        method: "POST",
        url: "/api/v1/importer-configs",
        ...authed({
          importerName: "github",
          label: "GH org",
          scope: { org: "acme" },
          credentialIds: [cred.id],
        }),
      });
      expect(configRes.statusCode).toBe(201);
      const configId = configRes.json().config.id;

      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/credentials/${cred.id}`,
        ...authed({ secrets: { token: "ghp_new_token" } }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json().credential;
      expect(body.id).toBe(cred.id);
      expect(body.keyHints.token).toBe("oken");

      const junction = await testDb!.db
        .selectFrom("importer_config_credentials")
        .selectAll()
        .where("configId", "=", configId)
        .where("credentialId", "=", cred.id)
        .execute();
      expect(junction).toHaveLength(1);

      const audit = await testDb!.db
        .selectFrom("entity_changes")
        .selectAll()
        .where("entityId", "=", cred.id)
        .where("action", "=", "rotated")
        .executeTakeFirstOrThrow();
      expect(JSON.stringify(audit.changes)).not.toContain("ghp_new_token");
      expect(JSON.stringify(audit.changes)).not.toContain("ghp_old_token");
    });

    it("revokes via status: REVOKED (one-way)", async () => {
      const cred = await createCred();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/credentials/${cred.id}`,
        ...authed({ status: "REVOKED" }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().credential.status).toBe("REVOKED");

      // ACTIVE is not a permitted status value — revocation is one-way.
      const back = await app.inject({
        method: "PATCH",
        url: `/api/v1/credentials/${cred.id}`,
        ...authed({ status: "ACTIVE" }),
      });
      expect(back.statusCode).toBe(400);
    });

    it("404s for unknown id", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/credentials/00000000-0000-7000-8000-000000000000",
        ...authed({ label: "x" }),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("CREDENTIAL_NOT_FOUND");
    });
  });

  describe("DELETE /api/v1/credentials/:id", () => {
    it("deletes an unreferenced credential", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ label: "PAT", secrets: { token: "ghp_del" } }),
      });
      const id = created.json().credential.id;
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/credentials/${id}`,
        cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
        headers: csrfHeader,
      });
      expect(res.statusCode).toBe(204);
      const row = await testDb!.db
        .selectFrom("credentials")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      expect(row).toBeUndefined();
    });

    it("409s with dependents when a config references the credential", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ label: "PAT", secrets: { token: "ghp_ref" } }),
      });
      const id = created.json().credential.id;
      const configRes = await app.inject({
        method: "POST",
        url: "/api/v1/importer-configs",
        ...authed({
          importerName: "github",
          label: "GH org",
          scope: { org: "acme" },
          credentialIds: [id],
        }),
      });
      expect(configRes.statusCode).toBe(201);

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/credentials/${id}`,
        cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
        headers: csrfHeader,
      });
      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.code).toBe("CREDENTIAL_IN_USE");
      expect(JSON.stringify(body)).toContain(configRes.json().config.id);
    });
  });

  describe("POST /api/v1/importer-configs/:id/convert-secrets", () => {
    async function createLegacyConfig(envVar: string) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/importer-configs",
        ...authed({
          importerName: "github",
          label: "Legacy GH",
          scope: { org: "acme" },
          secretRefs: [{ key: "token", env: envVar }],
        }),
      });
      expect(res.statusCode).toBe(201);
      return res.json().config.id as string;
    }

    it("converts legacy refs into a linked credential and clears secretRefs", async () => {
      process.env.COMPONODE_TEST_GITHUB_TOKEN = "ghp_legacy_token_99";
      const configId = await createLegacyConfig("COMPONODE_TEST_GITHUB_TOKEN");

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/importer-configs/${configId}/convert-secrets`,
        cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
        headers: csrfHeader,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.credential.id).toBeTruthy();
      expect(body.credential.keyHints.token).toBe("n_99");
      expect(body.config.credentialIds).toContain(body.credential.id);
      expect(body.config.secretRefs).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("ghp_legacy_token_99");

      const junction = await testDb!.db
        .selectFrom("importer_config_credentials")
        .selectAll()
        .where("configId", "=", configId)
        .execute();
      expect(junction.map((j) => j.credentialId)).toContain(body.credential.id);
    });

    it("400s CONVERSION_NOTHING_TO_CONVERT when no legacy refs exist", async () => {
      const credRes = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ label: "PAT", secrets: { token: "ghp_x" } }),
      });
      const configRes = await app.inject({
        method: "POST",
        url: "/api/v1/importer-configs",
        ...authed({
          importerName: "github",
          label: "Already migrated",
          scope: { org: "acme" },
          credentialIds: [credRes.json().credential.id],
        }),
      });
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/importer-configs/${configRes.json().config.id}/convert-secrets`,
        cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
        headers: csrfHeader,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("CONVERSION_NOTHING_TO_CONVERT");
    });

    it("502s LEGACY_SECRET_UNRESOLVABLE when the env var is absent", async () => {
      const configId = await createLegacyConfig("COMPONODE_MISSING_LEGACY_VAR");
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/importer-configs/${configId}/convert-secrets`,
        cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
        headers: csrfHeader,
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().code).toBe("LEGACY_SECRET_UNRESOLVABLE");
    });
  });
});
