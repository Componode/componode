import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { csrfCookie, csrfHeader, loginAs, SESSION_COOKIE_NAME } from "../helpers/api.js";
import type {
  DiscoveredAsset,
  DiscoveredAssetRelationship,
  Importer,
  ImporterContext,
} from "@componode/core";

// Spec 076 T010/T011 — importer-declared edges end to end through the
// in-process run worker: opt-in gating, same-run resolution, suppression,
// curated preservation, source-scoped retire, terminal-status scoping.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

process.env.COMPONODE_TEST_GITHUB_TOKEN ??= "test-github-token";

vi.mock("../../src/services/importer-registry.js", async () => {
  const actual = await vi.importActual("../../src/services/importer-registry.js");
  return { ...actual, getImporter: vi.fn() };
});

import { getImporter } from "../../src/services/importer-registry.js";

function repoAsset(
  externalId: string,
  relationships?: DiscoveredAssetRelationship[],
): DiscoveredAsset {
  return {
    category: "REPOSITORY",
    provider: "GITHUB",
    resourceType: "github:repository",
    name: externalId,
    externalId,
    slug: externalId.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    instances: [],
    details: null,
    ...(relationships ? { relationships } : {}),
  };
}

function libraryAsset(
  purlIdentity: string,
  relationships?: DiscoveredAssetRelationship[],
): DiscoveredAsset {
  const name = purlIdentity.split("/").pop()!;
  return {
    category: "LIBRARY",
    provider: "NPM",
    resourceType: "npm",
    name,
    externalId: purlIdentity,
    slug: `pkg-npm-${name}`,
    instances: [],
    details: null,
    ...(relationships ? { relationships } : {}),
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

const DEP = (targetExternalId: string): DiscoveredAssetRelationship => ({
  type: "DEPENDS_ON",
  targetExternalId,
});

describe("import-run declared edges", () => {
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

  async function createConfig(optIn = true): Promise<{ id: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        importerName: "github",
        label: "GitHub",
        scope: {
          org: "testorg",
          includeDependencyGraph: true,
          ...(optIn ? { importDeclaredEdges: true } : {}),
        },
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

  async function componentId(externalId: string): Promise<string> {
    const row = await testDb!.db
      .selectFrom("components")
      .select("id")
      .where("externalId", "=", externalId)
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function junctionRows() {
    return testDb!.db
      .selectFrom("component_depends_on_component")
      .selectAll()
      .execute();
  }

  // The edge pass runs after the terminal COMPLETED write (like the
  // suggestion passes) — poll until the junction state settles.
  async function waitForJunctionCount(expected: number, tries = 50) {
    let rows = await junctionRows();
    while (rows.length !== expected && tries-- > 0) {
      await new Promise((r) => setTimeout(r, 100));
      rows = await junctionRows();
    }
    return rows;
  }

  async function edgeBetween(fromExternal: string, toExternal: string) {
    const from = await componentId(fromExternal);
    const to = await componentId(toExternal);
    const rows = await testDb!.db
      .selectFrom("component_depends_on_component")
      .selectAll()
      .where("parentId", "=", from)
      .where("childId", "=", to)
      .execute();
    return rows[0] ?? null;
  }

  it("writes IMPORTER edges with source+run provenance on an opted-in completed run", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter([
        repoAsset("repo-a", [DEP("pkg:npm/lodash")]),
        libraryAsset("pkg:npm/lodash"),
        libraryAsset("pkg:npm/react", [DEP("pkg:npm/lodash")]),
      ]),
    );
    const config = await createConfig();
    const run = await trigger(config.id);
    expect(run.status).toBe("COMPLETED");

    const rows = await waitForJunctionCount(2);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.provenance).toBe("IMPORTER");
      expect(row.importerSourceId).not.toBeNull();
      expect(row.importRunId).toBe(run.id);
    }
    expect(await edgeBetween("repo-a", "pkg:npm/lodash")).not.toBeNull();
    expect(await edgeBetween("pkg:npm/react", "pkg:npm/lodash")).not.toBeNull();
  });

  it("ignores yielded relationships when the config did not opt in", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter([
        repoAsset("repo-a", [DEP("pkg:npm/lodash")]),
        libraryAsset("pkg:npm/lodash"),
      ]),
    );
    const config = await createConfig(false);
    const run = await trigger(config.id);
    expect(run.status).toBe("COMPLETED");
    expect(await junctionRows()).toHaveLength(0);
  });

  it("drops cross-run/unresolvable and self-edge targets silently", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter([
        repoAsset("repo-a", [
          DEP("pkg:npm/ghost"), // no same-run asset
          DEP("repo-a"), // self edge
          DEP("pkg:npm/lodash"),
        ]),
        libraryAsset("pkg:npm/lodash"),
      ]),
    );
    const config = await createConfig();
    const run = await trigger(config.id);
    expect(run.status).toBe("COMPLETED");
    const rows = await waitForJunctionCount(1);
    expect(rows).toHaveLength(1);
    expect(await edgeBetween("repo-a", "pkg:npm/lodash")).not.toBeNull();
  });

  it("preserves a curated edge on the same pair and never retires it", async () => {
    // First run declares repo-a → lodash.
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter([
        repoAsset("repo-a", [DEP("pkg:npm/lodash")]),
        libraryAsset("pkg:npm/lodash"),
      ]),
    );
    const config = await createConfig();
    await trigger(config.id);
    await waitForJunctionCount(1);
    const importerRow = await edgeBetween("repo-a", "pkg:npm/lodash");
    expect(importerRow!.provenance).toBe("IMPORTER");

    // A curated edge on a different pair (repo-a → curated-target).
    const repoId = await componentId("repo-a");
    const curated = uuidv7();
    const now = new Date().toISOString();
    await testDb!.db
      .insertInto("components")
      .values({
        id: curated,
        name: "curated-target",
        slug: "curated-target",
        category: "LIBRARY",
        provider: "NPM",
        resourceType: "npm",
        lifecycle: "ACTIVE",
        teamOwnerId: null,
        externalId: "pkg:npm/curated",
        details: null,
        sunsetAt: null,
        lastSeenAt: null,
        lastSeenInRunId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      } as never)
      .execute();
    await testDb!.db
      .insertInto("component_depends_on_component")
      .values({ parentId: repoId, childId: curated, createdAt: now })
      .execute();

    // Second run declares nothing — curated edge survives; the importer
    // edge on lodash is retired.
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter([repoAsset("repo-a")]),
    );
    const run2 = await trigger(config.id);
    expect(run2.status).toBe("COMPLETED");

    const rows = await waitForJunctionCount(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].childId).toBe(curated);
    expect(rows[0].provenance).toBe("CURATED");
  });

  it("never recreates a suppressed pair on a later run", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter([
        repoAsset("repo-a", [DEP("pkg:npm/lodash")]),
        libraryAsset("pkg:npm/lodash"),
      ]),
    );
    const config = await createConfig();
    await trigger(config.id);
    await waitForJunctionCount(1);

    // Hide the edge — suppression row + junction delete (what the route does).
    const repoId = await componentId("repo-a");
    const libId = await componentId("pkg:npm/lodash");
    await testDb!.db
      .insertInto("component_edge_suppressions")
      .values({
        id: uuidv7(),
        edgeKind: "DEPENDS_ON",
        fromComponentId: repoId,
        toComponentId: libId,
        suppressedBy: null,
        createdAt: new Date().toISOString(),
      })
      .execute();
    await testDb!.db
      .deleteFrom("component_depends_on_component")
      .where("parentId", "=", repoId)
      .where("childId", "=", libId)
      .execute();

    // Re-import declares the edge again — suppression vetoes it.
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter([
        repoAsset("repo-a", [DEP("pkg:npm/lodash")]),
        libraryAsset("pkg:npm/lodash"),
      ]),
    );
    const run2 = await trigger(config.id);
    expect(run2.status).toBe("COMPLETED");
    // Give the pass a beat to veto, then assert it stayed suppressed.
    await new Promise((r) => setTimeout(r, 500));
    expect(await junctionRows()).toHaveLength(0);
    expect(await edgeBetween("repo-a", "pkg:npm/lodash")).toBeNull();
  });

  it("writes no edges on a FAILED run", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter(
        [
          repoAsset("repo-a", [DEP("pkg:npm/lodash")]),
          libraryAsset("pkg:npm/lodash"),
        ],
        { throwAfter: 1 },
      ),
    );
    const config = await createConfig();
    const run = await trigger(config.id);
    expect(run.status).toBe("FAILED");
    expect(await junctionRows()).toHaveLength(0);
  });

  it("idempotent on re-run — no duplicate rows", async () => {
    const yields = () => [
      repoAsset("repo-a", [DEP("pkg:npm/lodash")]),
      libraryAsset("pkg:npm/lodash"),
    ];
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter(yields()),
    );
    const config = await createConfig();
    await trigger(config.id);
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter(yields()),
    );
    const run2 = await trigger(config.id);
    expect(run2.status).toBe("COMPLETED");
    expect(await waitForJunctionCount(1)).toHaveLength(1);
  });

  // T017 / US2 — the relationships read carries edge provenance +
  // source/run/config links for importer edges, CURATED default otherwise.
  it("exposes edge provenance on the relationships read", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter([
        repoAsset("repo-a", [DEP("pkg:npm/lodash")]),
        libraryAsset("pkg:npm/lodash"),
      ]),
    );
    const config = await createConfig();
    const run = await trigger(config.id);
    await waitForJunctionCount(1);

    const libId = await componentId("pkg:npm/lodash");
    const repoComponentId = await componentId("repo-a");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/components/${libId}/relationships`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const rel = JSON.parse(res.payload).relationships;
    const repoRow = rel.dependedOnBy.find(
      (r: { id: string }) => r.id === repoComponentId,
    );
    expect(repoRow).toBeDefined();
    expect(repoRow.edgeProvenance).toBe("IMPORTER");
    expect(repoRow.edgeImportRunId).toBe(run.id);
    expect(repoRow.edgeImporterSourceId).not.toBeNull();
    expect(repoRow.edgeImporterConfigId).toBe(config.id);
  });

  // T011 remote parity — the remote-run store's applyDeclaredEdges runs the
  // same pass after a completed remote run (same source/run scope).
  it("materializes declared edges on the remote-run path", async () => {
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeImporter([
        repoAsset("repo-a"),
        libraryAsset("pkg:npm/lodash"),
      ]),
    );
    const config = await createConfig();
    const run = await trigger(config.id);
    expect(run.status).toBe("COMPLETED");
    expect(await junctionRows()).toHaveLength(0);

    const source = await testDb!.db
      .selectFrom("importer_sources")
      .select("id")
      .executeTakeFirstOrThrow();
    const repoId = await componentId("repo-a");
    const libId = await componentId("pkg:npm/lodash");

    const { createDbRemoteRunStore } = await import(
      "../../src/services/remote-run-service.js"
    );
    const store = createDbRemoteRunStore();
    await store.applyDeclaredEdges({
      job: { sourceId: source.id, runId: run.id, importerName: "github" },
      declaredEdges: [
        {
          fromComponentId: repoId,
          type: "DEPENDS_ON",
          targetExternalId: "pkg:npm/lodash",
        },
      ],
      externalIdToComponentId: new Map([
        ["repo-a", repoId],
        ["pkg:npm/lodash", libId],
      ]),
    } as never);

    const edge = await edgeBetween("repo-a", "pkg:npm/lodash");
    expect(edge).not.toBeNull();
    expect(edge!.provenance).toBe("IMPORTER");
    expect(edge!.importerSourceId).toBe(source.id);
    expect(edge!.importRunId).toBe(run.id);
  });
});
