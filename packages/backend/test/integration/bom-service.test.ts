import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import type { DiscoveredBomEntry } from "@componode/core";
import {
  processBomEntries,
  deleteAbsentBomEntries,
} from "../../src/services/bom-service.js";

const now = () => new Date().toISOString();

function makeEntry(partial: Partial<DiscoveredBomEntry> = {}): DiscoveredBomEntry {
  return {
    purl: "pkg:npm/lodash@4.17.21",
    name: "lodash",
    version: "4.17.21",
    scope: "RUNTIME",
    evidenceSource: "REGISTRY_API",
    ...partial,
  };
}

describe("bom-service", () => {
  let testDb: TestDb | null = null;
  let componentId = "";
  let instanceId = "";
  let sourceId = "";
  let sourceBId = "";
  let runId = "";
  let run2Id = "";

  beforeEach(async () => {
    testDb = await startTestDb();
    componentId = uuidv7();
    instanceId = uuidv7();
    sourceId = uuidv7();
    sourceBId = uuidv7();
    runId = uuidv7();
    run2Id = uuidv7();

    await testDb.db.insertInto("components").values({
      id: componentId, name: "app", slug: "app", category: "REPOSITORY",
      provider: "GITHUB", resourceType: "github:repository", lifecycle: "ACTIVE",
      teamOwnerId: null, externalId: "app", details: null, sunsetAt: null,
      lastSeenAt: null, lastSeenInRunId: null,
      createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    await testDb.db.insertInto("component_instances").values({
      id: instanceId, componentId, environment: "PRODUCTION",
      externalId: "inst-1", slug: "inst-1", url: null, region: null,
      status: "RUNNING", version: null, deployedAt: null, rawConfig: null,
      lastSeenAt: null, lastSeenInRunId: null,
      createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    for (const [id, ident] of [[sourceId, "src-a"], [sourceBId, "src-b"]] as const) {
      await testDb.db.insertInto("importer_sources").values({
        id, importerName: "github", externalIdentity: ident, label: null,
        status: "ACTIVE", boundConfigId: null, firstSeenInRunId: null,
        lastSeenInRunId: null, createdAt: now(), updatedAt: now(),
      }).execute();
    }

    for (const id of [runId, run2Id]) {
      await testDb.db.insertInto("import_runs").values({
        id, configId: null, sourceId: null, status: "RUNNING",
        assetsProcessed: 0, assetsCreated: 0, assetsUpdated: 0,
        instancesOrphaned: 0, componentsRetired: 0, createdAt: now(),
      } as never).execute();
    }
  });

  afterEach(async () => {
    if (testDb) await testDb.cleanup();
  });

  async function rows(componentInstanceId?: string | null) {
    let q = testDb!.db
      .selectFrom("bom_entries")
      .selectAll()
      .where("componentId", "=", componentId);
    if (componentInstanceId === undefined) return q.execute();
    return componentInstanceId === null
      ? q.where("componentInstanceId", "is", null).execute()
      : q.where("componentInstanceId", "=", componentInstanceId).execute();
  }

  it("upserts a nested tree, binding children to their parent row", async () => {
    const result = await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId,
        entries: [
          makeEntry({
            purl: "pkg:deb/debian/bash@5.2.15",
            name: "bash",
            version: "5.2.15",
            cdxType: "library",
            children: [
              makeEntry({ purl: "pkg:deb/debian/glibc@2.36", name: "glibc", version: "2.36" }),
              makeEntry({ purl: "pkg:deb/debian/ncurses@6.4", name: "ncurses", version: "6.4" }),
            ],
          }),
        ],
      }),
    );
    expect(result).toEqual({ created: 3, updated: 0, unchanged: 0 });

    const all = await rows();
    expect(all).toHaveLength(3);
    const parent = all.find((r) => r.name === "bash")!;
    const children = all.filter((r) => r.parentBomEntryId === parent.id);
    expect(children.map((c) => c.name).sort()).toEqual(["glibc", "ncurses"]);
    for (const r of all) {
      expect(r.importRunId).toBe(runId);
      expect(r.sourceId).toBe(sourceId);
      expect(r.componentInstanceId).toBeNull();
      expect(r.ecosystem).toBe("deb");
    }
  });

  it("re-reports the same key as unchanged, bumping lastReportedAt but preserving createdAt", async () => {
    await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId,
        entries: [makeEntry()],
      }),
    );
    const first = (await rows())[0];
    await new Promise((r) => setTimeout(r, 20));

    const second = await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId: run2Id,
        entries: [makeEntry()],
      }),
    );
    expect(second).toEqual({ created: 0, updated: 0, unchanged: 1 });

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(first.id);
    expect(new Date(all[0].createdAt).getTime())
      .toBe(new Date(first.createdAt).getTime());
    expect(all[0].importRunId).toBe(run2Id);
    expect(new Date(all[0].lastReportedAt).getTime())
      .toBeGreaterThanOrEqual(new Date(first.lastReportedAt).getTime());
  });

  it("counts a payload change on the same key as updated", async () => {
    await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId,
        entries: [makeEntry({ supplier: null })],
      }),
    );
    const res = await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId: run2Id,
        entries: [makeEntry({ supplier: "Acme" })],
      }),
    );
    expect(res).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect((await rows())[0].supplier).toBe("Acme");
  });

  it("dedupes component-scoped (NULL instance) entries via NULLS NOT DISTINCT", async () => {
    // Two inserts of the same NULL-instance key must not create two rows —
    // the partial unique index treats NULLs as equal.
    await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId,
        entries: [makeEntry()],
      }),
    );
    const res = await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId: run2Id,
        entries: [makeEntry()],
      }),
    );
    expect(res.created).toBe(0);
    expect(await rows(null)).toHaveLength(1);
  });

  it("keeps component scope and instance scope as distinct keys", async () => {
    await testDb!.db.transaction().execute(async (trx) => {
      await processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId,
        entries: [makeEntry()],
      });
      await processBomEntries(trx, {
        componentId, componentInstanceId: instanceId, sourceId, runId,
        entries: [makeEntry()],
      });
    });
    expect(await rows(null)).toHaveLength(1);
    expect(await rows(instanceId)).toHaveLength(1);
  });

  it("deleteAbsentBomEntries removes only keys this run did not re-report", async () => {
    await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId,
        entries: [makeEntry(), makeEntry({ purl: "pkg:npm/react@18.2.0", name: "react", version: "18.2.0" })],
      }),
    );

    // Next run reports only lodash — react becomes absent.
    await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId: run2Id,
        entries: [makeEntry()],
      }),
    );
    const removed = await testDb!.db.transaction().execute((trx) =>
      deleteAbsentBomEntries(
        trx,
        [{ componentId, componentInstanceId: null }],
        sourceId,
        run2Id,
      ),
    );
    expect(removed).toBe(1);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("lodash");
  });

  it("deleteAbsentBomEntries with a scope that reported [] clears that scope", async () => {
    await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId,
        entries: [makeEntry()],
      }),
    );
    // Asset emitted bomEntries: [] — present-but-empty replaces the set.
    const removed = await testDb!.db.transaction().execute((trx) =>
      deleteAbsentBomEntries(
        trx,
        [{ componentId, componentInstanceId: null }],
        sourceId,
        run2Id,
      ),
    );
    expect(removed).toBe(1);
    expect(await rows()).toHaveLength(0);
  });

  it("scopes not reported this run keep their rows (field-absent preserve)", async () => {
    await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId,
        entries: [makeEntry()],
      }),
    );
    // Second run reports a DIFFERENT scope (the instance) but not the
    // component scope — component-scope rows must survive.
    await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: instanceId, sourceId, runId: run2Id,
        entries: [makeEntry({ purl: "pkg:npm/react@18.2.0", name: "react", version: "18.2.0" })],
      }),
    );
    const removed = await testDb!.db.transaction().execute((trx) =>
      deleteAbsentBomEntries(
        trx,
        [{ componentId, componentInstanceId: instanceId }],
        sourceId,
        run2Id,
      ),
    );
    expect(removed).toBe(0);
    expect(await rows(null)).toHaveLength(1);
    expect(await rows(instanceId)).toHaveLength(1);
  });

  it("another source's rows in the same scope are never replaced", async () => {
    await testDb!.db.transaction().execute(async (trx) => {
      await processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId,
        entries: [makeEntry()],
      });
      await processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId: sourceBId, runId,
        entries: [makeEntry({ purl: "pkg:npm/react@18.2.0", name: "react", version: "18.2.0" })],
      });
    });
    const removed = await testDb!.db.transaction().execute((trx) =>
      deleteAbsentBomEntries(
        trx,
        [{ componentId, componentInstanceId: null }],
        sourceId,
        run2Id, // source A's run 2 reported nothing for this scope's delete...
      ),
    );
    // source A's lodash is absent (not stamped run2Id) → removed; source B's
    // react is untouched.
    expect(removed).toBe(1);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].sourceId).toBe(sourceBId);
  });

  it("defaults direct to scope !== TRANSITIVE; explicit direct wins on conflict", async () => {
    await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId,
        entries: [
          makeEntry({ purl: "pkg:npm/a@1.0.0", name: "a", scope: "RUNTIME" }),
          makeEntry({ purl: "pkg:npm/b@1.0.0", name: "b", scope: "TRANSITIVE" }),
          makeEntry({ purl: "pkg:npm/c@1.0.0", name: "c", scope: "TRANSITIVE", direct: true }),
          makeEntry({ purl: "pkg:npm/d@1.0.0", name: "d", scope: "RUNTIME", direct: false }),
        ],
      }),
    );
    const all = await rows();
    const by = Object.fromEntries(all.map((r) => [r.name, r.direct]));
    expect(by.a).toBe(true);      // RUNTIME → direct true
    expect(by.b).toBe(false);     // TRANSITIVE → direct false
    expect(by.c).toBe(true);      // explicit direct wins over TRANSITIVE
    expect(by.d).toBe(false);     // explicit false wins over RUNTIME
  });

  it("stores licenses, evidence detail, cdx fields and details verbatim", async () => {
    await testDb!.db.transaction().execute((trx) =>
      processBomEntries(trx, {
        componentId, componentInstanceId: null, sourceId, runId,
        entries: [
          makeEntry({
            licenses: ["MIT", "Apache-2.0"],
            evidenceDetail: "lockfile:package-lock.json",
            cdxType: "library",
            cdxBomRef: "ref-123",
            details: { checksums: ["sha256:abc"], cpe: "cpe:2.3:a:x:y:*:*:*:*:*:*:*" },
          }),
        ],
      }),
    );
    const r = (await rows())[0];
    expect(r.licenses).toEqual(["MIT", "Apache-2.0"]);
    expect(r.evidenceDetail).toBe("lockfile:package-lock.json");
    expect(r.cdxType).toBe("library");
    expect(r.cdxBomRef).toBe("ref-123");
    expect((r.details as Record<string, unknown>).checksums).toEqual(["sha256:abc"]);
  });
});
