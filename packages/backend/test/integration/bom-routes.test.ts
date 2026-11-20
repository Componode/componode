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

describe("bom read routes", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let viewerSession: string;
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
    viewerSession = (await createSessionInDb(testDb.db as any, viewerId)).token;
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
      [instAId, "PRODUCTION", "inst-a"],
      [instBId, "STAGING", "inst-b"],
    ] as const) {
      await testDb.db.insertInto("component_instances").values({
        id, componentId, environment: env, externalId: nm,
        slug: nm, url: null, region: null, status: "RUNNING",
        version: null, deployedAt: null, rawConfig: null,
        lastSeenAt: null, lastSeenInRunId: null,
        createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
      } as never).execute();
    }

    for (const [id, ident, importer] of [
      [sourceAId, "org/repo-a", "github"],
      [sourceBId, "img:app@sha256:ff", "docker"],
    ] as const) {
      await testDb.db.insertInto("importer_sources").values({
        id, importerName: importer, externalIdentity: ident, label: null,
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

    const seed = (opts: {
      componentInstanceId: string | null;
      sourceId: string;
      entries: DiscoveredBomEntry[];
    }) =>
      testDb.db.transaction().execute((trx) =>
        processBomEntries(trx, { componentId, runId, ...opts }),
      );

    // Component scope — source A (github lockfile view)
    await seed({
      componentInstanceId: null,
      sourceId: sourceAId,
      entries: [
        entry({
          licenses: ["MIT"],
          children: [
            entry({
              purl: "pkg:npm/lodash.merge@4.6.2",
              name: "lodash.merge",
              version: "4.6.2",
              scope: "TRANSITIVE",
            }),
          ],
        }),
        entry({ purl: "pkg:npm/react@18.2.0", name: "react", version: "18.2.0" }),
        entry({ purl: "pkg:npm/jest@29.0.0", name: "jest", version: "29.0.0", scope: "DEV", licenses: ["MIT"] }),
      ],
    });
    // Component scope — source B (image view; shares lodash key as own row)
    await seed({
      componentInstanceId: null,
      sourceId: sourceBId,
      entries: [
        entry({ evidenceSource: "IMAGE_LAYER", evidenceDetail: "sha256:ff" }),
        entry({
          purl: "pkg:deb/debian/bash@5.2.15", name: "bash", version: "5.2.15",
          scope: "SYSTEM", evidenceSource: "IMAGE_LAYER", evidenceDetail: "sha256:ff",
        }),
      ],
    });
    // Instance scope — inst-a only
    await seed({
      componentInstanceId: instAId,
      sourceId: sourceBId,
      entries: [
        entry({
          purl: "pkg:apk/alpine/openssl@3.1.4", name: "openssl", version: "3.1.4",
          evidenceSource: "IMAGE_LAYER", evidenceDetail: "k8s:pod-spec:image:app@sha256:ff",
        }),
      ],
    });
  });

  const get = (url: string, session: string = adminSession) =>
    app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE_NAME]: session } });

  it("requires auth and 404s on an unknown component", async () => {
    const anon = await app.inject({ method: "GET", url: `/api/v1/components/${componentId}/bom` });
    expect(anon.statusCode).toBe(401);
    const missing = await get(`/api/v1/components/${uuidv7()}/bom`);
    expect(missing.statusCode).toBe(404);
    const body = missing.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("rejects unknown query params (strict schema)", async () => {
    const res = await get(`/api/v1/components/${componentId}/bom?bogus=1`);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("returns the merged view in the {data, pagination} envelope", async () => {
    const res = await get(`/api/v1/components/${componentId}/bom?pageSize=50`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pagination).toBeDefined();
    // component scope: lodash (dup across sources merges), lodash.merge,
    // react, jest, bash → 5 keys; + inst-a openssl → 6 merged rows
    expect(body.data).toHaveLength(6);
    const openssl = body.data.find((r: any) => r.name === "openssl");
    expect(openssl.instanceCount).toBe(1);
    expect(openssl.instanceTotal).toBe(1); // only inst-a bears a BOM
    const lodash = body.data.find((r: any) => r.name === "lodash");
    expect(lodash.instanceCount).toBe(0); // component-scope only
    expect(lodash.source).toBeTruthy();
  });

  it("scopes to instanceId exactly", async () => {
    const res = await get(`/api/v1/components/${componentId}/bom?instanceId=${instAId}`);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("openssl");
    const empty = await get(`/api/v1/components/${componentId}/bom?instanceId=${instBId}`);
    expect(empty.json().data).toHaveLength(0);
  });

  it("searches name, purl and licence text case-insensitively", async () => {
    const byName = await get(`/api/v1/components/${componentId}/bom?search=LODA`);
    expect(byName.json().data.length).toBeGreaterThanOrEqual(2);
    const byPurl = await get(`/api/v1/components/${componentId}/bom?search=apk`);
    expect(byPurl.json().data.map((r: any) => r.name)).toEqual(["openssl"]);
    const byLicense = await get(`/api/v1/components/${componentId}/bom?search=mit`);
    const names = byLicense.json().data.map((r: any) => r.name).sort();
    // Source B's later report of the same (purl,version,scope) key replaced
    // source A's row (spec "same package, multiple Sources: the row remains
    // single") — B's payload carries no licences, so only jest matches MIT.
    expect(names).toEqual(["jest"]);
  });

  it("applies CSV OR filters for scope, ecosystem and found", async () => {
    const scopes = await get(`/api/v1/components/${componentId}/bom?scope=DEV,SYSTEM`);
    expect(scopes.json().data.map((r: any) => r.name).sort()).toEqual(["bash", "jest"]);
    const ecos = await get(`/api/v1/components/${componentId}/bom?ecosystem=deb,apk`);
    expect(ecos.json().data.map((r: any) => r.name).sort()).toEqual(["bash", "openssl"]);
    const found = await get(`/api/v1/components/${componentId}/bom?found=IMAGE_LAYER`);
    const names = found.json().data.map((r: any) => r.name).sort();
    // lodash's surviving row is source B's image-layer report — it matches.
    expect(names).toEqual(["bash", "lodash", "openssl"]);
  });

  it("filters direct flag and rejects an invalid sort", async () => {
    const direct = await get(`/api/v1/components/${componentId}/bom?direct=true`);
    const names = direct.json().data.map((r: any) => r.name).sort();
    expect(names).toEqual(["bash", "jest", "lodash", "openssl", "react"]);
    const transitive = await get(`/api/v1/components/${componentId}/bom?direct=false`);
    expect(transitive.json().data.map((r: any) => r.name)).toEqual(["lodash.merge"]);
    const bad = await get(`/api/v1/components/${componentId}/bom?sort=evil`);
    expect(bad.statusCode).toBe(400);
  });

  it("view=tree returns only top-level rows with hasChildren/childCount", async () => {
    const res = await get(`/api/v1/components/${componentId}/bom?view=tree`);
    const body = res.json();
    expect(body.data.find((r: any) => r.name === "lodash.merge")).toBeUndefined();
    const lodash = body.data.find((r: any) => r.name === "lodash" && r.hasChildren);
    expect(lodash).toBeDefined();
    expect(lodash.childCount).toBe(1);
  });

  it("parentId returns that entry's direct children", async () => {
    const tree = await get(`/api/v1/components/${componentId}/bom?view=tree`);
    const parent = tree.json().data.find((r: any) => r.name === "lodash" && r.hasChildren);
    const res = await get(`/api/v1/components/${componentId}/bom?parentId=${parent.id}`);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("lodash.merge");
    expect(body.data[0].parentId).toBe(parent.id);
  });

  it("viewer role may read (read-only surface)", async () => {
    const res = await get(`/api/v1/components/${componentId}/bom`, viewerSession);
    expect(res.statusCode).toBe(200);
  });

  it("GET /component-instances/:id/bom returns exactly that instance's entries", async () => {
    const res = await get(`/api/v1/component-instances/${instAId}/bom`);
    const body = res.json();
    expect(body.data.map((r: any) => r.name)).toEqual(["openssl"]);
    const missing = await get(`/api/v1/component-instances/${uuidv7()}/bom`);
    expect(missing.statusCode).toBe(404);
  });
});
