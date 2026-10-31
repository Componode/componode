import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { DiscoveredAsset, Importer, ImporterContext } from "@componode/core";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  loginAs,
  createPersonInDb,
  createSessionInDb,
  SESSION_COOKIE_NAME,
  csrfCookie,
  csrfHeader,
} from "../helpers/api.js";
import { hashPassword } from "../../src/utils/argon2.js";
import { uuidv7 } from "uuidv7";

// github configs need a resolvable secret source under save-time coverage
// validation (spec 013); a legacy env ref keeps fixtures working.
process.env.COMPONODE_TEST_GITHUB_TOKEN ??= "test-github-token";

// Mock the importer registry so we can inject a fake importer without
// network calls (same pattern as importers.test.ts).
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

function makeRepoAsset(
  name: string,
  details: Record<string, unknown> | null = null,
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
      },
    ],
    details,
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
      let count = 0;
      await context.reportSourceIdentity({ externalIdentity: "test-source" });
      for (const asset of yields) {
        if (context.signal.aborted) return;
        count++;
        yield asset;
      }
      if (opts.throwAfter !== undefined && count >= opts.throwAfter) {
        throw new Error("boom");
      }
    },
  };
}

/**
 * Spec 022 US2 — the generation engine: signals stage candidates, coverage
 * tombstones, terminal rows never resurrect, triggers fire on import-run
 * completion and catalog writes, rescan is idempotent.
 */
describe("edge suggestion generation", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let adminId: string;
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

    const admin = await testDb.db
      .selectFrom("persons")
      .select("id")
      .where("username", "=", ADMIN_USERNAME)
      .executeTakeFirstOrThrow();
    adminId = admin.id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const authed = () => ({
    cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
    headers: csrfHeader,
  });

  async function mkProduct(slug: string, lifecycle = "ACTIVE") {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      ...authed(),
      payload: { name: slug, slug, type: "BUSINESS_CAPABILITY" },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().product.id as string;
    if (lifecycle !== "ACTIVE") {
      await testDb.db
        .updateTable("digital_products")
        .set({ lifecycle })
        .where("id", "=", id)
        .execute();
    }
    return id;
  }

  async function mkComponent(
    slug: string,
    opts: {
      lifecycle?: string;
      details?: Record<string, unknown> | null;
      componentGroupId?: string | null;
    } = {},
  ) {
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
        lifecycle: opts.lifecycle ?? "ACTIVE",
        details: opts.details ?? null,
        componentGroupId: opts.componentGroupId ?? null,
        externalId: null,
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

  async function mkGroup(slug: string) {
    const id = uuidv7();
    await testDb.db
      .insertInto("component_groups")
      .values({
        id,
        name: slug,
        slug,
        description: null,
        lifecycle: "ACTIVE",
        teamOwnerId: null,
        createdBy: null,
        updatedBy: null,
        createdAt: now(),
        updatedAt: now(),
      } as never)
      .execute();
    return id;
  }

  async function suggestionRow(productId: string, componentId: string) {
    return testDb.db
      .selectFrom("edge_suggestions")
      .selectAll()
      .where("productId", "=", productId)
      .where("componentId", "=", componentId)
      .executeTakeFirst();
  }

  async function rescan() {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/suggestions/rescan",
      ...authed(),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  async function waitFor(
    fn: () => Promise<boolean>,
    tries = 100,
  ): Promise<void> {
    for (let i = 0; i < tries; i++) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("condition not met in time");
  }

  it("stages a candidate on product create when a component name matches", async () => {
    const componentId = await mkComponent("zephyr-widget");
    const productId = await mkProduct("zephyr"); // create triggers the pass

    const row = await suggestionRow(productId, componentId);
    expect(row).toBeDefined();
    expect(row!.status).toBe("PENDING");
    expect(row!.reason).toBe("NAME_MATCH");
    expect(row!.score).toBeGreaterThanOrEqual(50);
  });

  it("product rename restages the product's pairs; pending rows rescore", async () => {
    const componentId = await mkComponent("quill-target");
    const productId = await mkProduct("unrelated-prod");
    expect(await suggestionRow(productId, componentId)).toBeUndefined();

    // Rename into matching tokens — triggers a {productId} pass.
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${productId}`,
      ...authed(),
      payload: { name: "quill target" },
    });
    expect(patch.statusCode).toBe(200);

    const row = await suggestionRow(productId, componentId);
    expect(row).toBeDefined();
    expect(row!.status).toBe("PENDING");

    // Rename away again — the pending row is left alone entirely (D4:
    // a generated candidate is a human's decision to make, not the
    // system's to un-make).
    await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${productId}`,
      ...authed(),
      payload: { name: "zzz-else" },
    });
    const after = await suggestionRow(productId, componentId);
    expect(after!.status).toBe("PENDING");
  });

  it("component tag update triggers a scoped rescan for that component", async () => {
    const productId = await mkProduct("velvet");
    const componentId = await mkComponent("sock-drawer");
    expect(await suggestionRow(productId, componentId)).toBeUndefined();

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${componentId}`,
      ...authed(),
      payload: { tags: ["velvet"] },
    });
    expect(patch.statusCode).toBe(200);

    const row = await suggestionRow(productId, componentId);
    expect(row).toBeDefined();
    expect(row!.status).toBe("PENDING");
    expect(row!.reason).toBe("TOPIC_TAG_MATCH");
  });

  it("a successful import run stages candidates for new components", async () => {
    const productId = await mkProduct("kestrel");
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeImporter([makeRepoAsset("kestrel-worker")]),
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed(),
      payload: {
        importerName: "github",
        label: "imp-a",
        scope: { org: "gen" },
        secretRefs: [{ key: "token", env: "COMPONODE_TEST_GITHUB_TOKEN" }],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const config = createRes.json().config;

    const triggerRes = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      ...authed(),
    });
    expect(triggerRes.statusCode).toBe(202);
    const { runId } = triggerRes.json();

    await waitFor(async () => {
      const run = await testDb.db
        .selectFrom("import_runs")
        .select("status")
        .where("id", "=", runId)
        .executeTakeFirstOrThrow();
      return ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status);
    });

    const run = await testDb.db
      .selectFrom("import_runs")
      .select("status")
      .where("id", "=", runId)
      .executeTakeFirstOrThrow();
    expect(run.status).toBe("COMPLETED");

    // Generation is awaited inside the worker but after the COMPLETED
    // update — poll for the staged row.
    await waitFor(async () => {
      const row = await testDb.db
        .selectFrom("edge_suggestions")
        .selectAll()
        .where("productId", "=", productId)
        .where("status", "=", "PENDING")
        .executeTakeFirst();
      return !!row;
    });
  });

  it("a failed import run stages nothing", async () => {
    const productId = await mkProduct("osprey");
    (getImporter as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeImporter([makeRepoAsset("osprey-worker")], { throwAfter: 1 }),
    );

    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      ...authed(),
      payload: {
        importerName: "github",
        label: "osprey",
        scope: { org: "gen" },
        secretRefs: [{ key: "token", env: "COMPONODE_TEST_GITHUB_TOKEN" }],
      },
    });
    const config = createRes.json().config;
    const triggerRes = await app.inject({
      method: "POST",
      url: `/api/v1/importer-configs/${config.id}/trigger`,
      ...authed(),
    });
    const { runId } = triggerRes.json();

    await waitFor(async () => {
      const run = await testDb.db
        .selectFrom("import_runs")
        .select("status")
        .where("id", "=", runId)
        .executeTakeFirstOrThrow();
      return ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status);
    });
    const run = await testDb.db
      .selectFrom("import_runs")
      .select("status")
      .where("id", "=", runId)
      .executeTakeFirstOrThrow();
    expect(run.status).toBe("FAILED");

    // The component was yielded and exists, but the failed run must not
    // have staged anything for it.
    const before = await testDb.db
      .selectFrom("edge_suggestions")
      .selectAll()
      .where("productId", "=", productId)
      .execute();
    expect(before).toHaveLength(0);

    // Sanity: a real generation pass DOES match the pair — the failed-run
    // guard is what prevented staging, not a signal miss.
    await rescan();
    const after = await testDb.db
      .selectFrom("edge_suggestions")
      .selectAll()
      .where("productId", "=", productId)
      .where("status", "=", "PENDING")
      .execute();
    expect(after.length).toBeGreaterThanOrEqual(1);
  });

  it("manual edge wiring tombstones the pending row → SUPERSEDED", async () => {
    const componentId = await mkComponent("falcon-relay");
    const productId = await mkProduct("falcon");
    expect((await suggestionRow(productId, componentId))!.status).toBe(
      "PENDING",
    );

    const wire = await app.inject({
      method: "POST",
      url: `/api/v1/products/${productId}/depends-on`,
      ...authed(),
      payload: { componentId },
    });
    expect(wire.statusCode).toBe(204);

    const row = await suggestionRow(productId, componentId);
    expect(row!.status).toBe("SUPERSEDED");
    expect(row!.decidedBy).toBe(adminId);
    expect(row!.reason).toBeNull();
    expect(row!.score).toBeNull();
  });

  it("group coverage tombstones member suggestions, including later members", async () => {
    const groupId = await mkGroup("heron");
    const memberA = await mkComponent("heron-a", { componentGroupId: groupId });
    const memberB = await mkComponent("heron-b");
    const productId = await mkProduct("heron");

    // Both components matched by name → two pending rows.
    expect((await suggestionRow(productId, memberA))!.status).toBe("PENDING");
    expect((await suggestionRow(productId, memberB))!.status).toBe("PENDING");

    // Product now depends on the group → memberA's row tombstones.
    const wire = await app.inject({
      method: "POST",
      url: `/api/v1/products/${productId}/depends-on`,
      ...authed(),
      payload: { componentGroupId: groupId },
    });
    expect(wire.statusCode).toBe(204);

    const rowA = await suggestionRow(productId, memberA);
    expect(rowA!.status).toBe("SUPERSEDED");
    // memberB isn't in the group yet — still pending.
    expect((await suggestionRow(productId, memberB))!.status).toBe("PENDING");

    // Move memberB into the group — the updateComponent trigger tombstones it.
    const move = await app.inject({
      method: "PATCH",
      url: `/api/v1/components/${memberB}`,
      ...authed(),
      payload: { componentGroupId: groupId },
    });
    expect(move.statusCode).toBe(200);
    const rowB = await suggestionRow(productId, memberB);
    expect(rowB!.status).toBe("SUPERSEDED");
  });

  it("deleted real edges never regenerate a suggestion", async () => {
    const componentId = await mkComponent("ibis-relay");
    const productId = await mkProduct("ibis");

    const wire = await app.inject({
      method: "POST",
      url: `/api/v1/products/${productId}/depends-on`,
      ...authed(),
      payload: { componentId },
    });
    expect(wire.statusCode).toBe(204);
    const unwire = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${productId}/depends-on/${componentId}?kind=component`,
      ...authed(),
    });
    expect([200, 204]).toContain(unwire.statusCode);

    await rescan();
    const row = await suggestionRow(productId, componentId);
    expect(row).toBeDefined();
    expect(row!.status).toBe("SUPERSEDED"); // tombstone — never PENDING again
  });

  it("removing a pre-feature edge (no tombstone row) still suppresses regen", async () => {
    // Simulates catalog data from before edge_suggestions existed: a real
    // edge row with no suggestion behind it. Removal must write the
    // tombstone, or the next pass would stage it as PENDING.
    const productId = await mkProduct("waxwing");
    const componentId = await mkComponent("waxwing-cache");
    await testDb.db
      .insertInto("product_depends_on_component")
      .values({ productId, componentId } as never)
      .execute();

    const unwire = await app.inject({
      method: "DELETE",
      url: `/api/v1/products/${productId}/depends-on/${componentId}?kind=component`,
      ...authed(),
    });
    expect([200, 204]).toContain(unwire.statusCode);

    await rescan();
    const row = await suggestionRow(productId, componentId);
    expect(row).toBeDefined();
    expect(row!.status).toBe("SUPERSEDED");
  });

  it("decided rows never resurface across passes", async () => {
    const componentId = await mkComponent("raven-box");
    const productId = await mkProduct("raven");
    const row = await suggestionRow(productId, componentId);
    expect(row!.status).toBe("PENDING");

    const dismiss = await app.inject({
      method: "POST",
      url: `/api/v1/suggestions/${row!.id}/dismiss`,
      ...authed(),
      payload: {},
    });
    expect(dismiss.statusCode).toBe(200);

    await rescan();
    const after = await suggestionRow(productId, componentId);
    expect(after!.status).toBe("DISMISSED");
  });

  it("POST /suggestions/rescan returns a report and is idempotent", async () => {
    const componentId = await mkComponent("thrush-nest");
    const productId = await mkProduct("thrush");
    // Wipe the auto-staged row so rescan's staged count is deterministic.
    await testDb.db
      .deleteFrom("edge_suggestions")
      .where("productId", "=", productId)
      .execute();

    const first = await rescan();
    expect(first.productsScanned).toBeGreaterThanOrEqual(1);
    expect(first.componentsScanned).toBeGreaterThanOrEqual(1);
    expect(first.staged).toBeGreaterThanOrEqual(1);
    expect((await suggestionRow(productId, componentId))!.status).toBe(
      "PENDING",
    );

    const second = await rescan();
    // Idempotent: nothing changed since the first pass, so unchanged
    // PENDING rows are skipped by the DO UPDATE guard — staged is 0, and
    // no new rows appear for the same pair (quickstart.md:27).
    const rows = await testDb.db
      .selectFrom("edge_suggestions")
      .selectAll()
      .where("productId", "=", productId)
      .where("componentId", "=", componentId)
      .execute();
    expect(rows).toHaveLength(1);
    expect(second.staged).toBe(0);
  });

  it("RETIRED endpoints are never staged", async () => {
    const retiredC = await mkComponent("swanview-x", { lifecycle: "RETIRED" });
    const retiredP = await mkProduct("otter", "RETIRED");
    const activeC = await mkComponent("otter-mill");

    await rescan();
    expect(await suggestionRow(retiredP, activeC)).toBeUndefined();
    const activeP = await mkProduct("swanview");
    // Retired component must not be staged against the new active product
    // (the create-trigger pass loads ACTIVE components only).
    expect(await suggestionRow(activeP, retiredC)).toBeUndefined();
  });

  it("catalog bootstrap tombstones wired pairs and stages new products", async () => {
    const componentId = await mkComponent("larkspur-core");
    const productId = await mkProduct("larkspur");
    expect((await suggestionRow(productId, componentId))!.status).toBe(
      "PENDING",
    );
    // Will name-match the bootstrap-created product below.
    const merlinComp = await mkComponent("merlin-watch");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/products/bootstrap",
      ...authed(),
      payload: {
        version: 1,
        products: [
          {
            name: "larkspur",
            type: "BUSINESS_CAPABILITY",
            dependsOn: ["larkspur-core"],
          },
          { name: "merlin", type: "BUSINESS_CAPABILITY" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    // The bootstrap-wired pair tombstones without waiting for a rescan.
    const wired = await suggestionRow(productId, componentId);
    expect(wired!.status).toBe("SUPERSEDED");
    expect(wired!.reason).toBeNull();
    expect(wired!.score).toBeNull();

    // The bootstrap-created product staged its matching component.
    const created = await testDb.db
      .selectFrom("digital_products")
      .select("id")
      .where("slug", "=", "merlin")
      .executeTakeFirstOrThrow();
    const staged = await suggestionRow(created.id, merlinComp);
    expect(staged).toBeDefined();
    expect(staged!.status).toBe("PENDING");
  });

  it("platform promotion tombstones its edge and stages the new product", async () => {
    const shared = await mkComponent("oriole-shared");
    const p1 = await mkProduct("oriole-alpha");
    const p2 = await mkProduct("oriole-beta");
    for (const pid of [p1, p2]) {
      const wire = await app.inject({
        method: "POST",
        url: `/api/v1/products/${pid}/depends-on`,
        ...authed(),
        payload: { componentId: shared },
      });
      expect(wire.statusCode).toBe(204);
    }
    // Will name-match the promoted platform product.
    const matchComp = await mkComponent("oriole-platform-lib");

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/components/${shared}/promote-to-platform`,
      ...authed(),
      payload: { name: "oriole platform" },
    });
    expect(res.statusCode).toBe(201);
    const platformId = res.json().product.id as string;

    // The platform's directly-inserted edge produced a tombstone.
    const tombstone = await suggestionRow(platformId, shared);
    expect(tombstone).toBeDefined();
    expect(tombstone!.status).toBe("SUPERSEDED");

    // The new product's candidate pass ran — a matching component staged.
    const staged = await suggestionRow(platformId, matchComp);
    expect(staged).toBeDefined();
    expect(staged!.status).toBe("PENDING");
  });

  it("rescan requires edge-write permission", async () => {
    const viewerId = await createPersonInDb(testDb.db, {
      username: "gen-viewer",
      passwordHash: await hashPassword("ViewerPassword123!"),
      role: "VIEWER",
    });
    const viewerSession = (await createSessionInDb(testDb.db, viewerId)).token;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/suggestions/rescan",
      cookies: { [SESSION_COOKIE_NAME]: viewerSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});
