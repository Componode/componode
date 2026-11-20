import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  parseSpdxDocument,
  parseCycloneDxDocument,
  type SpdxDocument,
} from "@componode/core";
import { truncateImportTables } from "../helpers/api.js";
import type { processBomEntries as processBomEntriesT } from "../../src/services/bom-service.js";
import type { buildCycloneDx as buildCycloneDxT } from "../../src/services/bom-export.js";

let processBomEntries: typeof processBomEntriesT;
let buildCycloneDx: typeof buildCycloneDxT;

const now = () => new Date().toISOString();

// Spec 073 SC-003 — ingesting an SPDX doc, exporting CycloneDX, and re-
// ingesting the export must produce zero duplicate BOM rows: the dedupe
// identity is purl-anchored, so a faithful round-trip is all `unchanged`.
describe("sbom ingest → export → re-ingest round-trip (spec 073 US4)", () => {
  let testDb: TestDb;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV"]) saved[k] = process.env[k];
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    ({ processBomEntries } = await import("../../src/services/bom-service.js"));
    ({ buildCycloneDx } = await import("../../src/services/bom-export.js"));
    await truncateImportTables(testDb.db);
  });

  afterAll(async () => {
    await testDb.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it("SPDX in → CycloneDX out → in again = zero duplicates", async () => {
    const componentId = uuidv7();
    const sourceId = uuidv7();
    const runId = uuidv7();
    await testDb.db.insertInto("components").values({
      id: componentId, name: "app", slug: "app", category: "REPOSITORY",
      provider: "GITHUB", resourceType: "github:repository", lifecycle: "ACTIVE",
      teamOwnerId: null, externalId: "app", details: null, sunsetAt: null,
      lastSeenAt: null, lastSeenInRunId: null,
      createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();
    await testDb.db.insertInto("importer_sources").values({
      id: sourceId, importerName: "sbom-file", externalIdentity: "sbom-file:test",
      label: null, status: "ACTIVE", boundConfigId: null,
      firstSeenInRunId: null, lastSeenInRunId: null,
      createdAt: now(), updatedAt: now(),
    }).execute();
    await testDb.db.insertInto("import_runs").values({
      id: runId, configId: null, sourceId: null, status: "COMPLETED",
      assetsProcessed: 0, assetsCreated: 0, assetsUpdated: 0,
      instancesOrphaned: 0, componentsRetired: 0, createdAt: now(),
    } as never).execute();

    const spdxDoc: SpdxDocument = {
      spdxVersion: "SPDX-2.3",
      SPDXID: "SPDXRef-DOCUMENT",
      name: "app-sbom",
      documentDescribes: ["SPDXRef-subject"],
      packages: [
        {
          SPDXID: "SPDXRef-subject", name: "app",
          externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:generic/app" }],
        },
        {
          SPDXID: "SPDXRef-express", name: "express", versionInfo: "4.19.2",
          licenseConcluded: "MIT", supplier: "Organization: OpenJS Foundation",
          externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:npm/express@4.19.2" }],
        },
        {
          SPDXID: "SPDXRef-vitest", name: "vitest", versionInfo: "2.0.0",
          externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:npm/vitest@2.0.0" }],
        },
      ],
      relationships: [
        { spdxElementId: "SPDXRef-express", relationshipType: "RUNTIME_DEPENDENCY_OF", relatedSpdxElement: "SPDXRef-subject" },
        { spdxElementId: "SPDXRef-vitest", relationshipType: "TEST_DEPENDENCY_OF", relatedSpdxElement: "SPDXRef-subject" },
      ],
    };

    const seed = (entries: ReturnType<typeof parseSpdxDocument>["entries"]) =>
      testDb.db.transaction().execute((trx) =>
        processBomEntries(trx, {
          componentId, runId, sourceId, componentInstanceId: null, entries,
        }),
      );

    const first = parseSpdxDocument(spdxDoc);
    const r1 = await seed(first.entries);
    expect(r1.created).toBe(2);

    // Export the stored rows to CycloneDX, re-parse, re-ingest.
    const rows = await testDb.db
      .selectFrom("bom_entries")
      .selectAll()
      .where("componentId", "=", componentId)
      .execute();
    const cdx = buildCycloneDx(rows, { slug: "app", name: "app" });
    const second = parseCycloneDxDocument(cdx);
    const r2 = await seed(second.entries);

    // SC-003: no duplicates — every re-ingested entry matched its row.
    expect(r2.created).toBe(0);
    const count = await testDb.db
      .selectFrom("bom_entries")
      .selectAll()
      .where("componentId", "=", componentId)
      .execute();
    expect(count).toHaveLength(2);
  });
});
