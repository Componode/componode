import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { csrfCookie, csrfHeader, loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";
import { GithubImporter } from "@componode/importer-github/importer";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

vi.mock("../../src/services/importer-registry.js", async () => {
  const actual = await vi.importActual("../../src/services/importer-registry.js");
  return {
    ...actual,
    getImporter: vi.fn(),
  };
});

import { getImporter } from "../../src/services/importer-registry.js";

function makeRepo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 123,
    full_name: "testorg/repo",
    name: "repo",
    owner: { login: "testorg" },
    html_url: "https://github.com/testorg/repo",
    fork: false,
    archived: false,
    language: "TypeScript",
    topics: ["tag"],
    visibility: "public",
    default_branch: "main",
    updated_at: "2024-01-01T00:00:00Z",
    pushed_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeOrg() {
  return {
    id: 42,
    login: "testorg",
    name: "Test Org",
    html_url: "https://github.com/testorg",
    plan: { name: "team", seats: 10, filled_seats: 7 },
  };
}

describe("importer-github end-to-end", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let originalDbUrl: string | undefined;
  let originalNodeEnv: string | undefined;
  let originalGithubToken: string | undefined;
  let originalBootstrapUsername: string | undefined;
  let originalBootstrapPassword: string | undefined;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    originalDbUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    originalGithubToken = process.env.GITHUB_TOKEN;
    originalBootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
    originalBootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.GITHUB_TOKEN = "fake-token";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    vi.resetModules();
    vi.clearAllMocks();

    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();

    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);

    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      switch (url.pathname) {
        case "/orgs/testorg":
          return json(makeOrg());
        case "/orgs/testorg/teams":
          return json([]);
        case "/orgs/testorg/repos":
          return json([makeRepo()]);
        case "/repos/testorg/repo/branches":
          return json([{ name: "main" }]);
        case "/repos/testorg/repo/branches/main":
          return json({
            name: "main",
            commit: { commit: { committer: { date: "2024-07-01T00:00:00Z" } } },
          });
        default:
          return new Response("Not Found", { status: 404 });
      }
    });

    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(new GithubImporter());
  });

  afterEach(async () => {
    fetchSpy?.mockRestore();
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    else delete process.env.DATABASE_URL;
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalGithubToken !== undefined) process.env.GITHUB_TOKEN = originalGithubToken;
    else delete process.env.GITHUB_TOKEN;
    if (originalBootstrapUsername !== undefined) process.env.BOOTSTRAP_ADMIN_USERNAME = originalBootstrapUsername;
    else delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    if (originalBootstrapPassword !== undefined) process.env.BOOTSTRAP_ADMIN_PASSWORD = originalBootstrapPassword;
    else delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    vi.resetModules();
  });

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

  it("imports a GitHub repository through the real GitHub importer and upserts a component", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        importerName: "github",
        label: "GitHub",
        scope: {
          org: "testorg",
          includeBilling: false,
          environmentMapping: { main: "PRODUCTION" },
        },
        secretRefs: [{ key: "token", env: "GITHUB_TOKEN" }],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const config = JSON.parse(createRes.payload).config;

    const triggerRes = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(triggerRes.statusCode).toBe(202);
    const { runId } = JSON.parse(triggerRes.payload);

    const run = await waitForRun(config.id, runId);
    expect(run.status).toBe("COMPLETED");
    expect(run.assetsProcessed).toBe(2);

    const orgComponent = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("provider", "=", "GITHUB")
      .where("externalId", "=", "42")
      .executeTakeFirst();

    expect(orgComponent).toBeDefined();
    expect(orgComponent?.category).toBe("ACCOUNT");

    const component = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("provider", "=", "GITHUB")
      .where("externalId", "=", "123")
      .executeTakeFirst();

    expect(component).toBeDefined();
    expect(component?.category).toBe("REPOSITORY");
    expect(component?.lifecycle).toBe("ACTIVE");

    const instance = await testDb!.db
      .selectFrom("component_instances")
      .selectAll()
      .where("componentId", "=", component!.id)
      .executeTakeFirst();

    expect(instance).toBeDefined();
    expect(instance?.externalId).toBe("branch:main");
    expect(instance?.environment).toBe("PRODUCTION");
    expect(instance?.status).toBe("RUNNING");

    expect(fetchSpy).toHaveBeenCalled();
  });
});
