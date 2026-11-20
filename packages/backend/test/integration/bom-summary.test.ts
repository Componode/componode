import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import type { DiscoveredBomEntry } from "@componode/core";
import {
  loginAs,
  createPersonInDb,
  createSessionInDb,
  SESSION_COOKIE_NAME,
  truncateImportTables,
} from "../helpers/api.js";
import type { processBomEntries as processBomEntriesT } from "../../src/services/bom-service.js";

let processBomEntries: typeof processBomEntriesT;

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const now = () => new Date().toISOString();

function entry(partial: Partial<DiscoveredBomEntry> = {}): DiscoveredBomEntry {
  return {
    purl: "pkg:npm/lodash@4.17.21",
    name: "lodash",
    version: "4.17.21",
    scope: "RUNTIME",
    evidenceSource: "REGISTRY_API",
    ...partial,
  };
}

describe("bom summary endpoint", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  const saved: Record<string, string | undefined> = {};

  let componentId = "";
  let instAId = "";
  let instBId = "";
  let sourceAId = "";
  let sourceBId = "";

  beforeAll(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"])
      saved[k] = process.env[k];
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
    const viewerId = await createPersonInDb(testDb.db as any, {
      username: "viewer", passwordHash: null, role: "VIEWER",
    });
    await createSessionInDb(testDb.db as any, viewerId);
    ({ processBomEntries } = await import("../../src/services/bom-service.js"));
  });

  afterAll(async () => {
    if (app) await app.close();
    await testDb.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  beforeEach(async () => {
    await truncateImportTables(testDb.db);
    componentId = uuidv7();
    instAId = uuidv7();
    instBId = uuidv7();
    sourceAId = uuidv7();
    sourceBId = uuidv7();

    await testDb.db.insertInto("components").values({
      id: componentId, name: "app", slug: "app", category: "REPOSITORY",
      provider: "GITHUB", resourceType: "github:repository", lifecycle: "ACTIVE",
      teamOwnerId: null, externalId: "app", details: null, sunsetAt: null,
      lastSeenAt: null, lastSeenInRunId: null,
      createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    for (const [id, env, nm] of [
      [instAId, "PRODUCTION", "prod"],
      [instBId, "STAGING", "stg"],
    ] as const) {
      await testDb.db.insertInto("component_instances").values({
        id, componentId, environment: env, externalId: nm, slug: nm,
        url: null, region: null, status: "RUNNING", version: null,
        deployedAt: null, rawConfig: null, lastSeenAt: null,
        lastSeenInRunId: null, createdBy: null, updatedBy: null,
        createdAt: now(), updatedAt: now(),
      } as never).execute();
    }

    for (const [id, ident, importer, label] of [
      [sourceAId, "org/repo-a", "github", "Repo A"],
      [sourceBId, "img:app@sha256:ff", "docker", null],
    ] as const) {
      await testDb.db.insertInto("importer_sources").values({
        id, importerName: importer, externalIdentity: ident, label,
        status: "ACTIVE", boundConfigId: null, firstSeenInRunId: null,
        lastSeenInRunId: null, createdAt: now(), updatedAt: now(),
      }).execute();
    }

    const runId = uuidv7();
    await testDb.db.insertInto("import_runs").values({
      id: runId, configId: null, sourceId: null, status: "COMPLETED",
      assetsProcessed: 0, assetsCreated: 0, assetsUpdated: 0,
      instancesOrphaned: 0, componentsRetired: 0, createdAt: now(),
    } as never).execute();

    const seed = (o: {
      componentInstanceId: string | null;
      sourceId: string;
      entries: DiscoveredBomEntry[];
    }) =>
      testDb.db.transaction().execute((trx) =>
        processBomEntries(trx, { componentId, runId, ...o }),
      );

    await seed({
      componentInstanceId: null,
      sourceId: sourceAId,
      entries: [
        entry({
          licenses: ["MIT"],
          children: [entry({ purl: "pkg:npm/x@1", name: "x", version: "1", scope: "TRANSITIVE" })],
        }),
        entry({ purl: "pkg:npm/jest@29", name: "jest", version: "29", scope: "DEV", licenses: ["MIT", "Apache-2.0"] }),
        entry({ purl: "pkg:deb/debian/bash@5", name: "bash", version: "5", scope: "SYSTEM" }),
      ],
    });
    await seed({
      componentInstanceId: instAId,
      sourceId: sourceBId,
      entries: [
        entry({ purl: "pkg:apk/alpine/openssl@3", name: "openssl", version: "3", evidenceSource: "IMAGE_LAYER" }),
      ],
    });
  });

  const get = (url: string) =>
    app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE_NAME]: adminSession } });

  it("returns totals, staleness config, per-source and per-instance rows", async () => {
    const res = await get(`/api/v1/components/${componentId}/bom/summary`);
    expect(res.statusCode).toBe(200);
    const s = res.json();
    // 4 component-scope (incl. child) + 1 instance-scope
    expect(s.total).toBe(5);
    expect(s.direct).toBe(4); // x is TRANSITIVE → direct false
    expect(s.ecosystems.sort()).toEqual(["apk", "deb", "npm"]);
    expect(s.licenseCount).toBe(2); // distinct: MIT, Apache-2.0
    expect(s.hasNesting).toBe(true);
    expect(s.lastReportedAt).toBeTruthy();
    expect(typeof s.staleThresholdDays).toBe("number");

    const byKind = Object.fromEntries(s.sources.map((r: any) => [r.importerKind, r]));
    expect(Object.keys(byKind).sort()).toEqual(["docker", "github"]);
    expect(byKind.github.name).toBe("Repo A");
    expect(byKind.docker.name).toBe("img:app@sha256:ff");
    for (const r of s.sources) expect(r.lastReportedAt).toBeTruthy();

    expect(s.instances).toHaveLength(1); // inst-b has no entries
    expect(s.instances[0].id).toBe(instAId);
    expect(s.instances[0].entryCount).toBe(1);
    expect(s.instances[0].environment).toBe("PRODUCTION");
  });

  it("scopes the summary to one instance", async () => {
    const res = await get(`/api/v1/components/${componentId}/bom/summary?instanceId=${instAId}`);
    const s = res.json();
    expect(s.total).toBe(1);
    expect(s.ecosystems).toEqual(["apk"]);
    expect(s.hasNesting).toBe(false);
    // sources still list every reporter (freshness is component-level)
    expect(s.sources.length).toBe(2);
  });

  it("reports an empty summary for a component with no BOM", async () => {
    const bareId = uuidv7();
    await testDb.db.insertInto("components").values({
      id: bareId, name: "bare", slug: "bare", category: "REPOSITORY",
      provider: "GITHUB", resourceType: "github:repository", lifecycle: "ACTIVE",
      teamOwnerId: null, externalId: "bare", details: null, sunsetAt: null,
      lastSeenAt: null, lastSeenInRunId: null,
      createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();
    const res = await get(`/api/v1/components/${bareId}/bom/summary`);
    const s = res.json();
    expect(s.total).toBe(0);
    expect(s.hasNesting).toBe(false);
    expect(s.lastReportedAt).toBeNull();
    expect(s.sources).toEqual([]);
    expect(s.instances).toEqual([]);
    expect(typeof s.staleThresholdDays).toBe("number");
  });
});
