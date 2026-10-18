import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { csrfCookie, csrfHeader, loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";
import type { DiscoveredAsset, Importer, ImporterContext } from "@componode/core";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

process.env.COMPONODE_TEST_GITHUB_TOKEN ??= "test-github-token";

vi.mock("../../src/services/importer-registry.js", async () => {
  const actual = await vi.importActual("../../src/services/importer-registry.js");
  return {
    ...actual,
    getImporter: vi.fn(),
  };
});

import { getImporter } from "../../src/services/importer-registry.js";

function makeRepoAsset(name: string, details: Record<string, unknown> | null = null): DiscoveredAsset {
  return {
    category: "REPOSITORY",
    provider: "GITHUB",
    resourceType: "github:repository",
    name,
    externalId: name,
    slug: name.toLowerCase().replace(/\//g, "-"),
    instances: [
      { environment: "PRODUCTION", externalId: "main", url: `https://github.com/${name}`, status: "RUNNING" },
    ],
    details,
  };
}

function makeImporter(yields: DiscoveredAsset[]): Importer {
  return {
    name: "github",
    version: "1.0.0",
    async *run(
      _config: Record<string, unknown>,
      _secrets: Record<string, string>,
      context: ImporterContext,
    ) {
      for (const asset of yields) {
        if (context.signal.aborted) return;
        yield asset;
      }
    },
  };
}

/** spec 017 FR-015 — importer reconciliation must never clobber curated metadata. */
describe("metadata importer safety (FR-015)", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"]) {
      saved[k] = process.env[k];
    }
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
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
  });

  afterEach(async () => {
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  });

  const authed = () => ({
    cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
    headers: csrfHeader,
  });

  async function waitForRun(configId: string, runId: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/importer-configs/${configId}/runs/${runId}`,
        cookies: { [SESSION_COOKIE_NAME]: adminSession },
      });
      const status = JSON.parse(res.payload).run.status;
      if (["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(status)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Run did not reach terminal state in time");
  }

  it("curated links/tags/sunsetAt survive an importer reconcile upsert", async () => {
    // Run 2 returns the same asset with different importer-owned `details` so
    // we can prove the upsert actually executed.
    (getImporter as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeImporter([makeRepoAsset("testorg/repo-x", { v: 1 })]))
      .mockResolvedValueOnce(makeImporter([makeRepoAsset("testorg/repo-x", { v: 2 })]));

    const configRes = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed(),
      payload: {
        importerName: "github",
        label: "GitHub",
        scope: { org: "testorg" },
        secretRefs: [{ key: "token", env: "COMPONODE_TEST_GITHUB_TOKEN" }],
      },
    });
    const config = JSON.parse(configRes.payload).config;

    const run1 = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      ...authed(),
    });
    await waitForRun(config.id, JSON.parse(run1.payload).runId);

    const created = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("externalId", "=", "testorg/repo-x")
      .executeTakeFirstOrThrow();

    const links = [{ title: "Runbook", url: "https://wiki.example/repo-x" }];
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${created.id}`,
      ...authed(),
      payload: { links, tags: ["pci", "critical-path"], sunsetAt: "2027-06-30T00:00:00.000Z" },
    });
    expect(patch.statusCode).toBe(200);

    const run2 = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      ...authed(),
    });
    await waitForRun(config.id, JSON.parse(run2.payload).runId);

    const after = await testDb!.db
      .selectFrom("components")
      .selectAll()
      .where("id", "=", created.id)
      .executeTakeFirstOrThrow();

    // Curated fields untouched.
    expect(after.links).toEqual(links);
    expect(after.tags).toEqual(["pci", "critical-path"]);
    expect(after.sunsetAt).toBeTruthy();

    // Importer-owned field did reconcile — the upsert ran.
    expect(after.details).toEqual({ v: 2 });
  });
});
