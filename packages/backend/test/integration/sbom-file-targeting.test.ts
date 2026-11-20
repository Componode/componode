import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { DiscoveredAsset, Importer, ImporterContext } from "@componode/core";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
} from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

// Spec 073 US3 (FR-017) — sbom-file targets an existing component: the slug
// is validated at save and resolved to the dedup triple at dispatch; a slug
// that goes missing/retired between save and run fails the run before the
// importer starts and never creates a component or BOM rows.

vi.mock("../../src/services/importer-registry.js", async () => {
  const actual = await vi.importActual(
    "../../src/services/importer-registry.js",
  );
  return { ...actual, getImporter: vi.fn() };
});

import { getImporter } from "../../src/services/importer-registry.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

function now() {
  return new Date().toISOString();
}

function makeImporter(
  onRun?: (scope: Record<string, unknown>) => DiscoveredAsset[] | undefined,
): Importer {
  return {
    name: "sbom-file",
    version: "1.0.0",
    async *run(
      config: Record<string, unknown>,
      _secrets: Record<string, string>,
      context: ImporterContext,
    ) {
      await context.reportSourceIdentity({ externalIdentity: "sbom-file:test" });
      for (const asset of onRun?.(config) ?? []) yield asset;
    },
  };
}

describe("sbom-file component targeting (spec 073)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of [
      "DATABASE_URL",
      "NODE_ENV",
      "BOOTSTRAP_ADMIN_USERNAME",
      "BOOTSTRAP_ADMIN_PASSWORD",
    ]) {
      saved[k] = process.env[k];
    }
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;

    const { bootstrapAdmin } = await import(
      "../../src/services/bootstrap-service.js"
    );
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function authed() {
    return {
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
    };
  }

  async function mkComponent(slug: string, externalId: string | null) {
    const id = uuidv7();
    await testDb.db
      .insertInto("components")
      .values({
        id,
        name: slug,
        slug,
        category: "REPOSITORY",
        provider: "GITHUB",
        resourceType: "repo",
        lifecycle: "ACTIVE",
        details: null,
        externalId,
        lastSeenAt: null,
        lastSeenInRunId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function waitForTerminal(runId: string) {
    for (let i = 0; i < 100; i++) {
      const run = await testDb.db
        .selectFrom("import_runs")
        .select(["status", "errorType", "errorMessage"])
        .where("id", "=", runId)
        .executeTakeFirstOrThrow();
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) return run;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("run never reached a terminal status");
  }

  const scopeFor = (slug: string) => ({
    sbomUrl: "https://sbom.example.com/doc.json",
    componentSlug: slug,
  });

  it("rejects a missing componentSlug and an unresolvable slug at save", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed(),
      payload: {
        importerName: "sbom-file",
        label: "sbom-missing-slug",
        scope: { sbomUrl: "https://sbom.example.com/doc.json" },
      },
    });
    expect(missing.statusCode).toBe(400);

    const absent = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed(),
      payload: {
        importerName: "sbom-file",
        label: "sbom-absent-slug",
        scope: scopeFor("no-such-component"),
      },
    });
    expect(absent.statusCode).toBe(400);
    expect(absent.json().message).toMatch(/does not resolve/);
  });

  it("rejects a RETIRED or externalId-less component at save", async () => {
    const retired = await mkComponent("sbom-retired-target", "octo/retired");
    await testDb.db
      .updateTable("components")
      .set({ lifecycle: "RETIRED" })
      .where("id", "=", retired)
      .execute();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed(),
      payload: {
        importerName: "sbom-file",
        label: "sbom-retired",
        scope: scopeFor("sbom-retired-target"),
      },
    });
    expect(res.statusCode).toBe(400);

    await mkComponent("sbom-manual-target", null);
    const manual = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed(),
      payload: {
        importerName: "sbom-file",
        label: "sbom-manual",
        scope: scopeFor("sbom-manual-target"),
      },
    });
    expect(manual.statusCode).toBe(400);
  });

  it("resolves the slug into the dedup triple in the run scope", async () => {
    const componentId = await mkComponent("sbom-live-target", "octo/live");
    let captured: Record<string, unknown> | undefined;
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeImporter((scope) => {
        captured = scope;
        return [
          {
            category: "REPOSITORY",
            provider: "GITHUB",
            resourceType: "sbom:document",
            name: "sbom-live-target",
            externalId: "octo/live",
            slug: "sbom-live-target",
            instances: [],
            bomEntries: [
              { purl: "pkg:npm/lodash@4.17.21", name: "lodash", evidenceSource: "SBOM_DOCUMENT" },
            ],
          },
        ];
      }),
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed(),
      payload: {
        importerName: "sbom-file",
        label: "sbom-live",
        scope: scopeFor("sbom-live-target"),
      },
    });
    expect(createRes.statusCode).toBe(201);

    const trigger = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${createRes.json().config.id}/trigger`,
      ...authed(),
    });
    expect(trigger.statusCode).toBe(202);
    const run = await waitForTerminal(trigger.json().runId);
    expect(run.status).toBe("COMPLETED");

    expect(captured).toBeDefined();
    const resolved = captured!.resolvedComponent as Record<string, unknown>;
    expect(resolved).toMatchObject({
      category: "REPOSITORY",
      provider: "GITHUB",
      externalId: "octo/live",
      name: "sbom-live-target",
      slug: "sbom-live-target",
    });

    // The yielded asset lands on the existing component + its BOM rows.
    const rows = await testDb.db
      .selectFrom("bom_entries")
      .selectAll()
      .where("componentId", "=", componentId)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("lodash");
  });

  it("fails the run before the importer starts when the slug retires after save", async () => {
    const componentId = await mkComponent("sbom-vanished-target", "octo/vanished");
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed(),
      payload: {
        importerName: "sbom-file",
        label: "sbom-vanished",
        scope: scopeFor("sbom-vanished-target"),
      },
    });
    expect(createRes.statusCode).toBe(201);

    // Retire between save and dispatch — resolution must now fail.
    await testDb.db
      .updateTable("components")
      .set({ lifecycle: "RETIRED" })
      .where("id", "=", componentId)
      .execute();

    let ran = false;
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeImporter(() => {
        ran = true;
        return [];
      }),
    );

    const trigger = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${createRes.json().config.id}/trigger`,
      ...authed(),
    });
    expect(trigger.statusCode).toBe(202);
    const run = await waitForTerminal(trigger.json().runId);
    expect(run.status).toBe("FAILED");
    expect(run.errorType).toBe("TARGET_RESOLUTION_FAILED");
    expect(run.errorMessage).toMatch(/does not resolve to an active component/);
    expect(ran).toBe(false);

    // No bom_entries created for anything by this run.
    const rows = await testDb.db
      .selectFrom("bom_entries")
      .selectAll()
      .where("componentId", "=", componentId)
      .execute();
    expect(rows).toHaveLength(0);
  });
});
