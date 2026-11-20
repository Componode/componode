import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { csrfCookie, csrfHeader, loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";
import type {
  DiscoveredAsset,
  DiscoveredBomEntry,
  Importer,
  ImporterContext,
} from "@componode/core";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

process.env.COMPONODE_TEST_GITHUB_TOKEN ??= "test-github-token";

vi.mock("../../src/services/importer-registry.js", async () => {
  const actual = await vi.importActual("../../src/services/importer-registry.js");
  return { ...actual, getImporter: vi.fn() };
});

import { getImporter } from "../../src/services/importer-registry.js";

function pkg(name: string, extra: Partial<DiscoveredBomEntry> = {}): DiscoveredBomEntry {
  return {
    purl: `pkg:npm/${name}@1.0.0`,
    name,
    version: "1.0.0",
    scope: "RUNTIME",
    evidenceSource: "REGISTRY_API",
    ...extra,
  };
}

function makeAsset(
  name: string,
  bomEntries?: DiscoveredBomEntry[],
  instanceBom?: DiscoveredBomEntry[],
): DiscoveredAsset {
  return {
    category: "REPOSITORY",
    provider: "GITHUB",
    resourceType: "github:repository",
    name,
    externalId: name,
    slug: name.toLowerCase().replace(/\//g, "-"),
    instances: [
      {
        environment: "PRODUCTION",
        externalId: "main",
        url: `https://github.com/${name}`,
        status: "RUNNING",
        ...(instanceBom !== undefined ? { bomEntries: instanceBom } : {}),
      },
    ],
    details: null,
    ...(bomEntries !== undefined ? { bomEntries } : {}),
  };
}

function makeImporter(
  yields: DiscoveredAsset[],
  opts: { throwAfter?: number } = {},
): Importer {
  return {
    name: "github",
    version: "1.0.0",
    async *run(
      _config: Record<string, unknown>,
      _secrets: Record<string, string>,
      context: ImporterContext,
    ) {
      await context.reportSourceIdentity({ externalIdentity: "test-source" });
      let i = 0;
      for (const asset of yields) {
        if (context.signal.aborted) return;
        if (opts.throwAfter !== undefined && i++ >= opts.throwAfter) {
          throw new Error("importer exploded mid-run");
        }
        yield asset;
      }
    },
  };
}

describe("import-run BOM ingest", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  const env: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"]) {
      env[k] = process.env[k];
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
    for (const [k, v] of Object.entries(env)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
    vi.resetModules();
  });

  async function waitForRun(configId: string, runId: string): Promise<Record<string, any>> {
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

  async function createConfig(): Promise<{ id: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        importerName: "github",
        label: "GitHub",
        scope: { org: "testorg" },
        secretRefs: [{ key: "token", env: "COMPONODE_TEST_GITHUB_TOKEN" }],
      },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.payload).config;
  }

  async function trigger(configId: string): Promise<Record<string, any>> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${configId}/trigger`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    });
    expect(res.statusCode).toBe(202);
    return waitForRun(configId, JSON.parse(res.payload).runId);
  }

  async function bomRows() {
    return testDb!.db.selectFrom("bom_entries").selectAll().execute();
  }

  it("stores asset-level bomEntries under the component scope", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter([makeAsset("testorg/repo-a", [pkg("lodash"), pkg("react")])]),
    );
    const config = await createConfig();
    const run = await trigger(config.id);
    expect(run.status).toBe("COMPLETED");
    expect(run.packagesCreated).toBe(2);

    const rows = await bomRows();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.componentInstanceId === null)).toBe(true);
    expect(rows.map((r) => r.name).sort()).toEqual(["lodash", "react"]);
  });

  it("stores instance bomEntries under that instance's scope", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter([makeAsset("testorg/repo-a", undefined, [pkg("express")])]),
    );
    const config = await createConfig();
    const run = await trigger(config.id);
    expect(run.status).toBe("COMPLETED");

    const rows = await bomRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].componentInstanceId).not.toBeNull();
    const inst = await testDb!.db
      .selectFrom("component_instances")
      .select("id")
      .where("id", "=", rows[0].componentInstanceId!)
      .executeTakeFirst();
    expect(inst).toBeTruthy();
  });

  it("replaces absent keys on a completed run — diff, not delete-all", async () => {
    (getImporter as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeImporter([makeAsset("testorg/repo-a", [pkg("lodash"), pkg("react"), pkg("axios")])]))
      .mockResolvedValueOnce(makeImporter([makeAsset("testorg/repo-a", [pkg("lodash"), pkg("react", { supplier: "Meta" })])]));

    const config = await createConfig();
    await trigger(config.id);
    const run2 = await trigger(config.id);
    expect(run2.status).toBe("COMPLETED");
    expect(run2.packagesRemoved).toBe(1); // axios absent
    expect(run2.packagesUpdated).toBe(1); // react supplier changed, same key
    expect(run2.packagesUnchanged).toBe(1); // lodash identical

    const rows = await bomRows();
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(["lodash", "react"]);
  });

  it("a FAILED run leaves prior BOM rows untouched", async () => {
    (getImporter as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeImporter([makeAsset("testorg/repo-a", [pkg("lodash")])]))
      .mockResolvedValueOnce(makeImporter([makeAsset("testorg/repo-b", [pkg("evil")]), makeAsset("testorg/repo-c")], { throwAfter: 1 }));

    const config = await createConfig();
    await trigger(config.id);
    const run2 = await trigger(config.id);
    expect(run2.status).toBe("FAILED");

    const rows = await bomRows();
    // lodash from run 1 survives; whatever the failed run staged is either
    // present-tentative or rolled back, but run-1 truth is never deleted
    // by an uncompleted run.
    expect(rows.some((r) => r.name === "lodash")).toBe(true);
  });

  it("field-absent assets preserve the source's prior set for that scope", async () => {
    (getImporter as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeImporter([makeAsset("testorg/repo-a", [pkg("lodash")])]))
      // Second run: same asset, no bomEntries field at all.
      .mockResolvedValueOnce(makeImporter([makeAsset("testorg/repo-a")]));

    const config = await createConfig();
    await trigger(config.id);
    const run2 = await trigger(config.id);
    expect(run2.status).toBe("COMPLETED");
    expect(run2.packagesRemoved ?? 0).toBe(0);

    const rows = await bomRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("lodash");
  });
});
