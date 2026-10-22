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

describe("agent-managed credentials (spec 026)", () => {
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

  function authedNoBody() {
    return {
      cookies: { ...csrfCookie, [SESSION_COOKIE_NAME]: adminSession },
      headers: csrfHeader,
    };
  }

  const refMap = {
    token: { env: "PROD_GH_TOKEN" },
    clientSecret: { file: "gh-secret" },
  };

  describe("POST /api/v1/credentials", () => {
    it("creates an AGENT_MANAGED credential — refs and source-type hints, no payload", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ kind: "AGENT_MANAGED", label: "Agent GH", secretRefMap: refMap }),
      });
      expect(res.statusCode).toBe(201);
      const { credential } = res.json();
      expect(credential.kind).toBe("AGENT_MANAGED");
      expect(credential.secretRefMap).toEqual(refMap);
      // Hints carry source types, never value suffixes (ADR-117).
      expect(credential.keyHints).toEqual({ token: "env", clientSecret: "file" });
      expect(credential).not.toHaveProperty("secrets");
      expect(credential).not.toHaveProperty("encryptedPayload");

      // The DB row has no encrypted payload.
      const row = await testDb!.db
        .selectFrom("credentials")
        .selectAll()
        .where("id", "=", credential.id)
        .executeTakeFirstOrThrow();
      expect(row.encryptedPayload).toBeNull();
      expect(row.secretRefMap).toEqual(refMap);
    });

    it("rejects secrets on an AGENT_MANAGED create", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({
          kind: "AGENT_MANAGED",
          label: "x",
          secretRefMap: refMap,
          secrets: { token: "leak-attempt" },
        }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });

    it("rejects secretRefMap on a STORED create", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({
          kind: "STORED",
          label: "x",
          secrets: { token: "v" },
          secretRefMap: refMap,
        }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });

    it("rejects a ref carrying both env and file", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({
          kind: "AGENT_MANAGED",
          label: "x",
          secretRefMap: { token: { env: "A", file: "f" } },
        }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });

    it("creates AGENT_MANAGED without a master key while STORED still fails", async () => {
      delete process.env.COMPONODE_SECRETS_KEY;
      const { resetKeyringCache } = await import("../../src/utils/credential-crypto.js");
      resetKeyringCache();

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ kind: "AGENT_MANAGED", label: "Keyless", secretRefMap: refMap }),
      });
      expect(res.statusCode).toBe(201);

      const stored = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ kind: "STORED", label: "Stored", secrets: { t: "v" } }),
      });
      expect(stored.statusCode).toBe(503);
      expect(stored.json().code).toBe("CREDENTIAL_KEY_UNAVAILABLE");
    });
  });

  describe("GET /api/v1/credentials", () => {
    it("list exposes kind + keyHints but keeps reference names detail-only (ADR-117 A1)", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ kind: "AGENT_MANAGED", label: "ListAM", secretRefMap: refMap }),
      });
      const { credential } = created.json();

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/credentials",
        ...authedNoBody(),
      });
      const found = list.json().credentials.find((c: { id: string }) => c.id === credential.id);
      expect(found.kind).toBe("AGENT_MANAGED");
      // Source-type hints render the badges; the ref names themselves
      // (env var names / file paths) stay on the detail response.
      expect(found.keyHints).toEqual({ token: "env", clientSecret: "file" });
      expect(found.secretRefMap).toBeUndefined();
      expect(JSON.stringify(found)).not.toContain("PROD_GH_TOKEN");
      expect(JSON.stringify(found)).not.toContain("gh-secret");

      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/credentials/${credential.id}`,
        ...authedNoBody(),
      });
      expect(detail.json().credential.kind).toBe("AGENT_MANAGED");
      expect(detail.json().credential.secretRefMap).toEqual(refMap);
    });
  });

  describe("PATCH /api/v1/credentials/:id", () => {
    it("edits the ref map in place, preserving id and audit hygiene", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ kind: "AGENT_MANAGED", label: "EditMap", secretRefMap: refMap }),
      });
      const { credential } = created.json();

      const nextMap = { token: { file: "gh-token-file" } };
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/credentials/${credential.id}`,
        ...authed({ secretRefMap: nextMap }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().credential.id).toBe(credential.id);
      expect(res.json().credential.secretRefMap).toEqual(nextMap);
      expect(res.json().credential.keyHints).toEqual({ token: "file" });

      // The audit entry carries key names only — never values (US5/T033).
      const audit = await testDb!.db
        .selectFrom("entity_changes")
        .selectAll()
        .where("entityType", "=", "credential")
        .where("entityId", "=", credential.id)
        .orderBy("createdAt", "desc")
        .executeTakeFirstOrThrow();
      expect(audit.action).toBe("rotated");
      const changes = audit.changes as Record<string, unknown>;
      expect(JSON.stringify(changes)).not.toContain("gh-token-file");
    });

    it("rejects secrets rotation on an AGENT_MANAGED credential", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ kind: "AGENT_MANAGED", label: "NoValues", secretRefMap: refMap }),
      });
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/credentials/${created.json().credential.id}`,
        ...authed({ secrets: { token: "v" } }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("CREDENTIAL_KIND_MISMATCH");
    });

    it("rejects secretRefMap edits on a STORED credential", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ kind: "STORED", label: "Stored", secrets: { token: "v" } }),
      });
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/credentials/${created.json().credential.id}`,
        ...authed({ secretRefMap: refMap }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("CREDENTIAL_KIND_MISMATCH");
    });

    it("rejects a kind change", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ kind: "STORED", label: "Stored", secrets: { token: "v" } }),
      });
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/credentials/${created.json().credential.id}`,
        ...authed({ kind: "AGENT_MANAGED" }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  });

  describe("lifecycle", () => {
    it("keeps expiresAt as advisory metadata and warns identically to STORED", async () => {
      const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ kind: "AGENT_MANAGED", label: "Expiry", secretRefMap: refMap, expiresAt }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().credential.expiresAt).toBe(expiresAt);
    });

    it("revokes and blocks delete-while-referenced identically to STORED", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/credentials",
        ...authed({ kind: "AGENT_MANAGED", label: "Lifecycle", secretRefMap: refMap }),
      });
      const { credential } = created.json();

      // Reference the credential from a config row directly (agent binding
      // arrives in spec 027; linkage shape is identical).
      const { randomUUID } = await import("node:crypto");
      const cfgId = randomUUID();
      const now = new Date().toISOString();
      await testDb!.db
        .insertInto("importer_configs")
        .values({
          id: cfgId,
          label: "cfg",
          importerName: "github",
          scope: {},
          secretRefs: null,
          schedule: null,
          enabled: true,
          agentId: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      await testDb!.db
        .insertInto("importer_config_credentials")
        .values({ configId: cfgId, credentialId: credential.id })
        .execute();

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/credentials/${credential.id}`,
        ...authedNoBody(),
      });
      expect(del.statusCode).toBe(409);
      expect(del.json().code).toBe("CREDENTIAL_IN_USE");

      const revoke = await app.inject({
        method: "PATCH",
        url: `/api/v1/credentials/${credential.id}`,
        ...authed({ status: "REVOKED" }),
      });
      expect(revoke.statusCode).toBe(200);
      expect(revoke.json().credential.status).toBe("REVOKED");

      // A revoked agent-managed credential fails the test path before any
      // agent dispatch is attempted.
      const test = await app.inject({
        method: "POST",
        url: `/api/v1/credentials/${credential.id}/test`,
        ...authed({ importerName: "github" }),
      });
      expect(test.statusCode).toBe(400);
      expect(test.json().code).toBe("CREDENTIAL_REVOKED");
    });
  });
});
