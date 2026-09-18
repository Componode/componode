import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";
import type { DiscoveredAsset, Importer, ImporterContext } from "@componode/core";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const TEST_KEY = randomBytes(32).toString("base64");

vi.mock("../../src/services/importer-registry.js", async () => {
  const actual = await vi.importActual("../../src/services/importer-registry.js");
  return {
    ...actual,
    getImporter: vi.fn(),
  };
});

import { getImporter } from "../../src/services/importer-registry.js";

function makeRepoAsset(name: string): DiscoveredAsset {
  return {
    category: "REPOSITORY",
    provider: "GITHUB",
    resourceType: "github:repository",
    name,
    externalId: name,
    slug: name.toLowerCase().replace(/\//g, "-"),
    instances: [
      { environment: "PRODUCTION", externalId: "main", status: "RUNNING" },
    ],
    details: null,
  };
}

// Captures the resolved `secrets` record handed to the importer so tests can
// assert what was actually decrypted/merged at run time.
function makeSecretsCapture(): {
  importer: Importer;
  seen: () => Record<string, string> | null;
} {
  let captured: Record<string, string> | null = null;
  return {
    seen: () => captured,
    importer: {
      name: "github",
      version: "1.0.0",
      async *run(
        _config: Record<string, unknown>,
        secrets: Record<string, string>,
        context: ImporterContext,
      ) {
        captured = secrets;
        yield makeRepoAsset("testorg/repo-a");
        await context.reportPhase("Completed");
      },
    },
  };
}

describe("credential run resolution", () => {
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
    vi.clearAllMocks();

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

  async function createCredential(secrets: Record<string, string>, label = "GitHub PAT") {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed({ label, secrets }),
    });
    expect(res.statusCode).toBe(201);
    return res.json().credential;
  }

  async function createConfig(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed({
        importerName: "github",
        label: "GitHub",
        scope: { org: "testorg" },
        secretRefs: [],
        ...payload,
      }),
    });
  }

  async function waitForRun(configId: string, runId: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < 100; i++) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/importer-configs/${configId}/runs/${runId}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      const body = JSON.parse(res.payload);
      if (["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(body.run.status)) {
        return body.run;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Run did not reach terminal state in time");
  }

  it("resolves credential secrets, stamps the run, and updates lastUsedAt", async () => {
    const capture = makeSecretsCapture();
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(capture.importer);

    const credential = await createCredential({ token: "ghp_from_store" });
    const res = await createConfig({ credentialIds: [credential.id] });
    expect(res.statusCode).toBe(201);
    const config = res.json().config;
    expect(config.credentialIds).toEqual([credential.id]);
    expect(config.secretRefsDeprecated).toBe(false);

    const trigger = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(trigger.statusCode).toBe(202);
    const { runId } = trigger.json();

    const run = await waitForRun(config.id, runId);
    expect(run.status).toBe("COMPLETED");
    expect(run.credentialIds).toEqual([credential.id]);
    expect(capture.seen()?.token).toBe("ghp_from_store");

    const row = await testDb!.db
      .selectFrom("credentials")
      .select("lastUsedAt")
      .where("id", "=", credential.id)
      .executeTakeFirstOrThrow();
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("rejects save when the required key is not covered", async () => {
    const credential = await createCredential({ other: "x" });
    const res = await createConfig({ credentialIds: [credential.id] });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_MISSING_KEY");
  });

  it("rejects save when no secret source covers a required key", async () => {
    const res = await createConfig({ credentialIds: [], secretRefs: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_MISSING_KEY");
    expect(res.json().message).toContain("token");
  });

  it("rejects save on duplicate keys across a credential and a legacy ref", async () => {
    const credential = await createCredential({ token: "ghp_x" });
    const res = await createConfig({
      credentialIds: [credential.id],
      secretRefs: [{ key: "token", env: "GITHUB_TOKEN" }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CREDENTIAL_KEY_COLLISION");
  });

  it("fails fast when the credential is revoked after save", async () => {
    const credential = await createCredential({ token: "ghp_x" });
    const res = await createConfig({ credentialIds: [credential.id] });
    const config = res.json().config;

    await testDb!.db
      .updateTable("credentials")
      .set({ status: "REVOKED" })
      .where("id", "=", credential.id)
      .execute();

    const trigger = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    const { runId } = trigger.json();
    const run = await waitForRun(config.id, runId);
    expect(run.status).toBe("FAILED");
    expect(run.errorType).toBe("CREDENTIAL_REVOKED");
  });

  it("blocks credential deletion at the FK level while referenced", async () => {
    const credential = await createCredential({ token: "ghp_x" });
    await createConfig({ credentialIds: [credential.id] });

    await expect(
      testDb!.db.deleteFrom("credentials").where("id", "=", credential.id).execute(),
    ).rejects.toThrow();
  });

  it("still resolves a legacy env ref during the deprecation window", async () => {
    process.env.COMPONODE_TEST_GH_TOKEN = "ghp_legacy_env";
    const capture = makeSecretsCapture();
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(capture.importer);

    const res = await createConfig({
      secretRefs: [{ key: "token", env: "COMPONODE_TEST_GH_TOKEN" }],
    });
    expect(res.statusCode).toBe(201);
    const config = res.json().config;
    expect(config.secretRefsDeprecated).toBe(true);

    const trigger = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    const { runId } = trigger.json();
    const run = await waitForRun(config.id, runId);
    expect(run.status).toBe("COMPLETED");
    expect(capture.seen()?.token).toBe("ghp_legacy_env");
  });
});
