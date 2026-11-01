import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { randomBytes } from "node:crypto";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
} from "../helpers/api.js";

// Spec 051 — URL Check auth validation + hub header construction (task
// T047, gap G2). Route-level auth contract tests (Authorization reserved,
// API-category gate, AGENT vantage × STORED credential, missing credential
// keys) plus dispatchProbe header injection for BASIC/BEARER/CUSTOM_HEADERS.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const TEST_KEY = randomBytes(32).toString("base64");

function now() {
  return new Date().toISOString();
}

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const okResponse = (status: number) =>
  ({
    status,
    body: { cancel: async () => {} },
  }) as unknown as Response;

async function seedComponent(
  db: TestDb["db"],
  slug: string,
  opts: { category?: string } = {},
) {
  const componentId = uuidv7();
  await db
    .insertInto("components")
    .values({
      id: componentId,
      name: `Comp ${slug}`,
      slug,
      category: opts.category ?? "API",
      provider: "GITHUB",
      resourceType: "github:repository",
      lifecycle: "ACTIVE",
      componentGroupId: null,
      externalId: null,
      details: null,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
    } as any)
    .execute();
  const instanceId = uuidv7();
  await db
    .insertInto("component_instances")
    .values({
      id: instanceId,
      componentId,
      environment: "PRODUCTION",
      url: null,
      region: null,
      status: "RUNNING",
      version: null,
      deployedAt: null,
      rawConfig: null,
      externalId: `${slug}-prod`,
      slug: `${slug}-prod`,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now(),
      updatedAt: now(),
    } as any)
    .execute();
  return { componentId, instanceId };
}

describe("url check auth (validation + hub headers)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let dispatchProbe: typeof import("../../src/services/probe-dispatcher.js").dispatchProbe;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.COMPONODE_SECRETS_KEY = TEST_KEY;
    vi.resetModules();

    const { resetKeyringCache } = await import(
      "../../src/utils/credential-crypto.js"
    );
    resetKeyringCache();

    const { bootstrapAdmin } = await import(
      "../../src/services/bootstrap-service.js"
    );
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();

    ({ dispatchProbe } = await import(
      "../../src/services/probe-dispatcher.js"
    ));

    const { loginAs } = await import("../helpers/api.js");
    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD))!;
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    delete process.env.COMPONODE_SECRETS_KEY;
  });

  const authed = (session: string) => ({
    cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
    headers: csrfHeader,
  });

  async function createCredential(secrets: Record<string, string>) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      ...authed(adminSession),
      payload: { label: `cred-${uuidv7()}`, secrets },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.payload).credential.id as string;
  }

  async function createCheck(
    componentId: string,
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(adminSession),
      payload,
    });
  }

  it("rejects a CUSTOM_HEADERS authConfig that names the reserved Authorization header", async () => {
    const credentialId = await createCredential({ k: "v" });
    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "auth-reserved",
    );
    const res = await createCheck(componentId, {
      name: "reserved",
      url: "https://example.com/",
      componentInstanceId: instanceId,
      authMode: "CUSTOM_HEADERS",
      credentialId,
      authConfig: { headers: [{ name: "Authorization", key: "k" }] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).code).toBe("VALIDATION_FAILED");
  });

  it("rejects authMode BASIC on a non-API (WEB_ENDPOINT) component", async () => {
    const credentialId = await createCredential({ u: "x", p: "y" });
    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "auth-web",
      { category: "WEB_ENDPOINT" },
    );
    const res = await createCheck(componentId, {
      name: "web-auth",
      url: "https://example.com/",
      componentInstanceId: instanceId,
      authMode: "BASIC",
      credentialId,
      authConfig: { usernameKey: "u", passwordKey: "p" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).code).toBe("VALIDATION_FAILED");
  });

  it("rejects a STORED credential for an AGENT-vantage check (CREDENTIAL_KIND_MISMATCH)", async () => {
    const agentId = uuidv7();
    await testDb.db
      .insertInto("import_agents")
      .values({ id: agentId, name: "auth-agent", createdBy: null } as any)
      .execute();

    const credentialId = await createCredential({ u: "x", p: "y" });
    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "auth-agent-vantage",
    );

    const setup = await app.inject({
      method: "PUT",
      url: `/api/v1/components/${componentId}/monitoring-setup`,
      ...authed(adminSession),
      payload: { vantage: "AGENT", agentId },
    });
    expect(setup.statusCode).toBe(200);

    const res = await createCheck(componentId, {
      name: "agent-stored",
      url: "https://example.com/",
      componentInstanceId: instanceId,
      authMode: "BASIC",
      credentialId,
      authConfig: { usernameKey: "u", passwordKey: "p" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).code).toBe("CREDENTIAL_KIND_MISMATCH");
  });

  it("rejects authConfig keys missing from the credential bundle (CREDENTIAL_MISSING_KEY)", async () => {
    const credentialId = await createCredential({ token: "abc" });
    const { componentId, instanceId } = await seedComponent(
      testDb.db,
      "auth-missing-key",
    );
    const res = await createCheck(componentId, {
      name: "missing-key",
      url: "https://example.com/",
      componentInstanceId: instanceId,
      authMode: "BEARER",
      credentialId,
      authConfig: { tokenKey: "notThere" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).code).toBe("CREDENTIAL_MISSING_KEY");
  });

  // --- Hub dispatchProbe header injection ----------------------------------

  async function captureHeaders(
    slug: string,
    credentialId: string,
    authMode: string,
    authConfig: Record<string, unknown>,
  ) {
    const { componentId, instanceId } = await seedComponent(testDb.db, slug);
    const created = await createCheck(componentId, {
      name: `check-${slug}`,
      url: "https://example.com/private",
      componentInstanceId: instanceId,
      authMode,
      credentialId,
      authConfig,
    });
    expect(created.statusCode).toBe(201);
    const checkId = JSON.parse(created.payload).check.id;

    let captured: Record<string, unknown> | null = null;
    await dispatchProbe(checkId, iso(-60_000), {
      fetchImpl: async (_url, init) => {
        captured = Object.fromEntries(
          Object.entries((init as RequestInit).headers as Record<string, string>).map(
            ([k, v]) => [k.toLowerCase(), v],
          ),
        );
        return okResponse(200);
      },
    });
    return { checkId, captured };
  }

  it("sends Authorization: Basic <base64> for a BASIC credential", async () => {
    const credentialId = await createCredential({
      user: "alice",
      pass: "s3cret",
    });
    const { checkId, captured } = await captureHeaders(
      "hub-basic",
      credentialId,
      "BASIC",
      { usernameKey: "user", passwordKey: "pass" },
    );
    const expected = Buffer.from("alice:s3cret").toString("base64");
    expect(captured!["authorization"]).toBe(`Basic ${expected}`);

    const obs = await testDb.db
      .selectFrom("url_check_observations")
      .selectAll()
      .where("urlCheckId", "=", checkId)
      .execute();
    expect(obs[0].outcome).toBe("SUCCESS");
  });

  it("sends Authorization: Bearer <token> for a BEARER credential", async () => {
    const credentialId = await createCredential({ token: "tok-abc-123" });
    const { captured } = await captureHeaders(
      "hub-bearer",
      credentialId,
      "BEARER",
      { tokenKey: "token" },
    );
    expect(captured!["authorization"]).toBe("Bearer tok-abc-123");
  });

  it("sends named headers for a CUSTOM_HEADERS credential", async () => {
    const credentialId = await createCredential({
      apikey: "key-789",
      tenant: "acme",
    });
    const { captured } = await captureHeaders(
      "hub-custom",
      credentialId,
      "CUSTOM_HEADERS",
      {
        headers: [
          { name: "X-Api-Key", key: "apikey" },
          { name: "X-Tenant", key: "tenant" },
        ],
      },
    );
    expect(captured!["x-api-key"]).toBe("key-789");
    expect(captured!["x-tenant"]).toBe("acme");
    expect(captured!["authorization"]).toBeUndefined();
  });
});
