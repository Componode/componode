import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
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

const ajv = new Ajv({ allErrors: true, strict: false });
const cdxSchema = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/schemas/cyclonedx-1.5.schema.json"), "utf8"),
);
const spdxSchema = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/schemas/spdx-2.3.schema.json"), "utf8"),
);
// CycloneDX's schema $refs "spdx.schema.json" and "jsf-0.82.schema.json"
// relative to its $id — register both so no network fetch is needed.
ajv.addSchema(spdxSchema, "http://cyclonedx.org/schema/spdx.schema.json");
ajv.addSchema(
  JSON.parse(
    readFileSync(join(__dirname, "../fixtures/schemas/jsf-0.82.schema.json"), "utf8"),
  ),
);
const validateCdx = ajv.compile(cdxSchema);
const validateSpdx = ajv.compile(spdxSchema);

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

describe("bom export (spec 073 US4)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let viewerSession: string;
  const saved: Record<string, string | undefined> = {};

  let componentId = "";
  let instAId = "";
  let sourceId = "";
  let runId = "";

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
    sourceId = uuidv7();
    runId = uuidv7();

    await testDb.db.insertInto("components").values({
      id: componentId, name: "app", slug: "app", category: "REPOSITORY",
      provider: "GITHUB", resourceType: "github:repository", lifecycle: "ACTIVE",
      teamOwnerId: null, externalId: "app", details: null, sunsetAt: null,
      lastSeenAt: null, lastSeenInRunId: null,
      createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    await testDb.db.insertInto("component_instances").values({
      id: instAId, componentId, environment: "PRODUCTION", externalId: "inst-a",
      slug: "inst-a", url: null, region: null, status: "RUNNING",
      version: null, deployedAt: null, rawConfig: null,
      lastSeenAt: null, lastSeenInRunId: null,
      createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    await testDb.db.insertInto("importer_sources").values({
      id: sourceId, importerName: "github", externalIdentity: "org/repo-a", label: null,
      status: "ACTIVE", boundConfigId: null, firstSeenInRunId: null,
      lastSeenInRunId: null, createdAt: now(), updatedAt: now(),
    }).execute();

    await testDb.db.insertInto("import_runs").values({
      id: runId, configId: null, sourceId: null, status: "COMPLETED",
      assetsProcessed: 0, assetsCreated: 0, assetsUpdated: 0,
      instancesOrphaned: 0, componentsRetired: 0, createdAt: now(),
    } as never).execute();

    const seed = (scope: { componentInstanceId: string | null }, entries: DiscoveredBomEntry[]) =>
      testDb.db.transaction().execute((trx) =>
        processBomEntries(trx, { componentId, runId, sourceId, ...scope, entries }),
      );

    await seed({ componentInstanceId: null }, [
      entry({
        purl: "pkg:npm/express@4.19.2", name: "express", version: "4.19.2",
        supplier: "OpenJS Foundation", licenses: ["MIT"], cdxBomRef: "ref-express",
        details: { checksums: ["SHA-256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"], cpe: "cpe:2.3:a:expressjs:express:4.19.2:*:*:*:*:*:*:*" },
        children: [
          entry({
            purl: "pkg:npm/accepts@1.3.8", name: "accepts", version: "1.3.8",
            scope: "TRANSITIVE", direct: false,
          }),
        ],
      }),
      entry({
        purl: "pkg:npm/vitest@2.0.0", name: "vitest", version: "2.0.0",
        scope: "TEST", licenses: ["MIT", "Apache-2.0"], direct: false,
      }),
      entry({
        purl: "pkg:maven/org.junit/junit@5.0.0", name: "junit", version: "5.0.0",
        scope: "BUILD", ecosystem: undefined,
      }),
    ]);
    await seed({ componentInstanceId: instAId }, [
      entry({ purl: "pkg:deb/bash@5.2", name: "bash", version: "5.2", scope: "SYSTEM" }),
    ]);
  });

  const get = (url: string, session = adminSession) =>
    app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE_NAME]: session } });

  it("exports CycloneDX 1.5 that validates against the vendored schema", async () => {
    const res = await get(`/api/v1/components/${componentId}/bom/export?format=cyclonedx`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("app-bom.cdx.json");
    const doc = res.json();
    expect(doc.bomFormat).toBe("CycloneDX");
    const valid = validateCdx(doc);
    if (!valid) console.log(validateCdx.errors);
    expect(valid).toBe(true);

    // Lossy scope map: TEST/BUILD → excluded; RUNTIME → required.
    const byName = (n: string) =>
      doc.components.find((c: any) => c.name === n);
    expect(byName("express").scope).toBe("required");
    expect(byName("vitest").scope).toBe("excluded");
    expect(byName("junit").scope).toBe("excluded");
    // Nesting → components[].
    expect(byName("express").components[0].name).toBe("accepts");
    expect(byName("express").components[0].scope).toBe("required"); // TRANSITIVE → required
    // Rich fields survive.
    expect(byName("express").supplier.name).toBe("OpenJS Foundation");
    expect(byName("express").hashes[0]).toEqual({ alg: "SHA-256", content: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" });
    expect(byName("express").cpe).toMatch(/^cpe:2\.3/);
    // dependencies[] marks subject-direct entries; the child rides its parent.
    const deps = Object.fromEntries(doc.dependencies.map((d: any) => [d.ref, d.dependsOn ?? []]));
    const subjectRef = doc.metadata.component["bom-ref"];
    expect(deps[subjectRef]).toContain("ref-express");
    expect(deps["ref-express"]).toHaveLength(1);
  });

  it("exports SPDX 2.3 validating against the schema, with CONTAINS + scope relationships", async () => {
    const res = await get(`/api/v1/components/${componentId}/bom/export?format=spdx`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("app-bom.spdx.json");
    const doc = res.json();
    const valid = validateSpdx(doc);
    if (!valid) console.log(validateSpdx.errors?.slice(0, 5));
    expect(valid).toBe(true);

    const byName = (n: string) => doc.packages.find((p: any) => p.name === n);
    const express = byName("express");
    const subject = doc.packages.find((p: any) => doc.documentDescribes.includes(p.SPDXID));
    expect(subject.name).toBe("app");
    expect(express.externalRefs.some((r: any) => r.referenceType === "purl" && r.referenceLocator === "pkg:npm/express@4.19.2")).toBe(true);
    expect(express.licenseConcluded).toBe("MIT");
    expect(byName("vitest").licenseConcluded).toContain("MIT");
    expect(express.supplier).toBe("Organization: OpenJS Foundation");
    expect(express.checksums[0].algorithm).toBe("SHA256");

    const rels = doc.relationships;
    const rel = (from: string, type: string) =>
      rels.find((r: any) => r.spdxElementId === from && r.relationshipType === type);
    expect(rel(express.SPDXID, "RUNTIME_DEPENDENCY_OF").relatedSpdxElement).toBe(subject.SPDXID);
    expect(rel(byName("vitest").SPDXID, "TEST_DEPENDENCY_OF")).toBeTruthy();
    expect(rel(byName("junit").SPDXID, "BUILD_DEPENDENCY_OF")).toBeTruthy();
    const contains = rel(express.SPDXID, "CONTAINS");
    expect(contains).toBeTruthy();
    expect(byName("accepts").SPDXID).toBe(contains.relatedSpdxElement);
  });

  it("exports the Componode JSON tree", async () => {
    const res = await get(`/api/v1/components/${componentId}/bom/export?format=json`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("app-bom.json");
    const doc = res.json();
    expect(doc.component.slug).toBe("app");
    expect(doc.entries).toHaveLength(3);
    const express = doc.entries.find((e: any) => e.name === "express");
    expect(express.children[0].name).toBe("accepts");
    expect(express.scope).toBe("RUNTIME");
  });

  it("scopes exports to one instance and names the file with the instance infix", async () => {
    const res = await get(
      `/api/v1/components/${componentId}/bom/export?format=spdx&instanceId=${instAId}`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("app-inst-a-bom.spdx.json");
    const doc = res.json();
    const names = doc.packages.map((p: any) => p.name);
    expect(names).toContain("bash");
    expect(names).not.toContain("express");
  });

  it("always exports the full BOM — list filters are never applied", async () => {
    const res = await get(`/api/v1/components/${componentId}/bom/export?format=json`);
    const doc = res.json();
    const scopes = doc.entries.map((e: any) => e.scope).sort();
    expect(scopes).toEqual(["BUILD", "RUNTIME", "TEST"]);
  });

  it("lets a Viewer export", async () => {
    const res = await get(`/api/v1/components/${componentId}/bom/export?format=cyclonedx`, viewerSession);
    expect(res.statusCode).toBe(200);
  });

  it("rejects an unknown component and a bad format", async () => {
    const missing = await get(`/api/v1/components/${uuidv7()}/bom/export?format=json`);
    expect(missing.statusCode).toBe(404);
    const bad = await get(`/api/v1/components/${componentId}/bom/export?format=xls`);
    expect(bad.statusCode).toBe(400);
  });
});
