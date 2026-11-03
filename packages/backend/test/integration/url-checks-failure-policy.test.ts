import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { uuidv7 } from "uuidv7";
import { randomBytes } from "node:crypto";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { SESSION_COOKIE_NAME, csrfCookie, csrfHeader } from "../helpers/api.js";

// Spec 056 — repeated-failure policy (ADR-124 Amendment 3): a check keeps
// probing at cadence with exactly one observation per slot, and auto-
// disables after its effective consecutive-failure threshold. FAILURE and
// MISSED advance the streak; SUCCESS resets it; re-enable is manual.

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const TEST_KEY = randomBytes(32).toString("base64");
const THRESHOLD_ENV = "URL_CHECK_AUTO_DISABLE_AFTER";

function iso(offsetMs: number, from = Date.now()): string {
  return new Date(from + offsetMs).toISOString();
}

const okResponse = (status: number) =>
  ({
    status,
    body: { cancel: async () => {} },
  }) as unknown as Response;

async function seedComponent(db: TestDb["db"], slug: string) {
  const componentId = uuidv7();
  await db
    .insertInto("components")
    .values({
      id: componentId,
      name: `Comp ${slug}`,
      slug,
      category: "API",
      provider: "GITHUB",
      resourceType: "github:repository",
      lifecycle: "ACTIVE",
      componentGroupId: null,
      externalId: null,
      details: null,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: iso(0),
      updatedAt: iso(0),
    } as any)
    .execute();
  const instanceId = uuidv7();
  await db
    .insertInto("component_instances")
    .values({
      id: instanceId,
      componentId,
      environment: "PRODUCTION",
      url: null,
      region: null,
      status: "RUNNING",
      version: null,
      deployedAt: null,
      rawConfig: null,
      externalId: `${slug}-prod`,
      slug: `${slug}-prod`,
      lastSeenAt: null,
      lastSeenInRunId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: iso(0),
      updatedAt: iso(0),
    } as any)
    .execute();
  return { componentId, instanceId };
}

async function seedCheck(
  db: TestDb["db"],
  input: {
    slug: string;
    enabled?: boolean;
    cadenceSeconds?: number;
    nextProbeAt?: string | null;
    vantage?: string;
    agentId?: string | null;
    autoDisableAfter?: number | null;
  },
) {
  const { componentId, instanceId } = await seedComponent(db, input.slug);
  const setupId = uuidv7();
  await db
    .insertInto("component_monitoring_setups")
    .values({
      id: setupId,
      componentId,
      cadenceSeconds: input.cadenceSeconds ?? 60,
      vantage: input.vantage ?? "HUB",
      agentId: input.agentId ?? null,
    })
    .execute();
  const checkId = uuidv7();
  await db
    .insertInto("url_checks")
    .values({
      id: checkId,
      setupId,
      componentInstanceId: instanceId,
      credentialId: null,
      name: `check-${input.slug}`,
      url: "https://example.com/health",
      method: "GET",
      enabled: input.enabled ?? true,
      cadenceSeconds: null,
      successPolicy: { codes: [], ranges: [{ min: 200, max: 299 }] },
      authMode: "NONE",
      authConfig: null,
      availabilityTarget: null,
      targetWindow: null,
      autoDisableAfter: input.autoDisableAfter ?? null,
      nextProbeAt: input.nextProbeAt === undefined ? iso(0) : input.nextProbeAt,
      createdBy: null,
      updatedBy: null,
      createdAt: iso(0),
      updatedAt: iso(0),
    } as any)
    .execute();
  return { componentId, instanceId, setupId, checkId };
}

async function seedManagedCheck(
  db: TestDb["db"],
  input: { slug: string; configEnabled?: boolean; autoDisabledAt?: string | null; consecutiveFailures?: number },
) {
  const { componentId, instanceId, setupId, checkId } = await seedCheck(db, {
    slug: input.slug,
  });
  await db
    .updateTable("url_checks")
    .set({
      managedKey: `chk-${input.slug}`,
      autoDisabledAt: input.autoDisabledAt ?? null,
      consecutiveFailures: input.consecutiveFailures ?? 0,
    })
    .where("id", "=", checkId)
    .execute();
  const configId = uuidv7();
  await db
    .insertInto("importer_configs")
    .values({
      id: configId,
      importerName: "web-url",
      label: `cfg-${input.slug}`,
      scope: JSON.stringify({ sourceKey: uuidv7(), components: [] }),
      enabled: input.configEnabled ?? true,
      createdAt: iso(0),
      updatedAt: iso(0),
    } as never)
    .execute();
  const sourceId = uuidv7();
  await db
    .insertInto("importer_sources")
    .values({
      id: sourceId,
      importerName: "web-url",
      externalIdentity: `collection:${input.slug}`,
      label: `src-${input.slug}`,
      status: "ACTIVE",
      boundConfigId: configId,
      createdAt: iso(0),
      updatedAt: iso(0),
    } as never)
    .execute();
  await db
    .insertInto("source_url_check_memberships")
    .values({
      id: uuidv7(),
      sourceId,
      urlCheckId: checkId,
      checkKey: `chk-${input.slug}`,
      active: true,
      configuredEnabled: true,
      createdAt: iso(0),
      updatedAt: iso(0),
    } as never)
    .execute();
  return { componentId, instanceId, setupId, checkId, configId, sourceId };
}

const getCheck = (db: TestDb["db"], checkId: string) =>
  db
    .selectFrom("url_checks")
    .selectAll()
    .where("id", "=", checkId)
    .executeTakeFirstOrThrow();

const getObservations = (db: TestDb["db"], checkId: string) =>
  db
    .selectFrom("url_check_observations")
    .selectAll()
    .where("urlCheckId", "=", checkId)
    .orderBy("scheduledAt", "asc")
    .execute();

const getChanges = (db: TestDb["db"], checkId: string) =>
  db
    .selectFrom("entity_changes")
    .selectAll()
    .where("entityType", "=", "url_check")
    .where("entityId", "=", checkId)
    .orderBy("createdAt", "asc")
    .execute();

describe("url check repeated-failure policy (spec 056)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;
  let dispatchProbe: typeof import("../../src/services/probe-dispatcher.js").dispatchProbe;
  let setUrlCheckAgentDispatch: typeof import("../../src/services/probe-dispatcher.js").setUrlCheckAgentDispatch;
  let sweepOnce: typeof import("../../src/services/url-check-scheduler.js").sweepOnce;
  const savedThreshold = process.env[THRESHOLD_ENV];

  const setThreshold = (v: number | undefined) => {
    if (v === undefined) delete process.env[THRESHOLD_ENV];
    else process.env[THRESHOLD_ENV] = String(v);
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.COMPONODE_SECRETS_KEY = TEST_KEY;
    vi.resetModules();

    const { resetKeyringCache } =
      await import("../../src/utils/credential-crypto.js");
    resetKeyringCache();
    const { bootstrapAdmin } =
      await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();
    ({ dispatchProbe, setUrlCheckAgentDispatch } =
      await import("../../src/services/probe-dispatcher.js"));
    ({ sweepOnce } = await import("../../src/services/url-check-scheduler.js"));
    const { loginAs } = await import("../helpers/api.js");
    adminSession = (await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD))!;
  }, 120000);

  afterAll(async () => {
    setUrlCheckAgentDispatch(null);
    if (savedThreshold === undefined) delete process.env[THRESHOLD_ENV];
    else process.env[THRESHOLD_ENV] = savedThreshold;
    await app?.close();
    await testDb?.cleanup();
    delete process.env.COMPONODE_SECRETS_KEY;
  });

  const authed = (session: string) => ({
    cookies: { [SESSION_COOKIE_NAME]: session, ...csrfCookie },
    headers: csrfHeader,
  });

  const fail = (checkId: string, scheduledAt: string) =>
    dispatchProbe(checkId, scheduledAt, {
      fetchImpl: async () => okResponse(500),
    });

  it("increments the streak on FAILURE and resets it on SUCCESS", async () => {
    setThreshold(10);
    const { checkId } = await seedCheck(testDb.db, { slug: "streak" });
    await fail(checkId, iso(0));
    await fail(checkId, iso(1000));
    let check = await getCheck(testDb.db, checkId);
    expect(check.consecutiveFailures).toBe(2);

    await dispatchProbe(checkId, iso(2000), {
      fetchImpl: async () => okResponse(200),
    });
    check = await getCheck(testDb.db, checkId);
    expect(check.consecutiveFailures).toBe(0);
    expect(check.enabled).toBe(true);
    expect(check.autoDisabledAt).toBeNull();
  });

  it("auto-disables at the global threshold, audits it, and accrues nothing after", async () => {
    setThreshold(3);
    const { checkId } = await seedCheck(testDb.db, { slug: "auto-off" });
    await fail(checkId, iso(0));
    await fail(checkId, iso(1000));
    let check = await getCheck(testDb.db, checkId);
    expect(check.enabled).toBe(true);

    await fail(checkId, iso(2000));
    check = await getCheck(testDb.db, checkId);
    expect(check.enabled).toBe(false);
    expect(check.consecutiveFailures).toBe(3);
    expect(check.autoDisabledAt).not.toBeNull();
    expect(check.nextProbeAt).toBeNull();

    const changes = await getChanges(testDb.db, checkId);
    const autoDisable = changes.find(
      (c) =>
        c.action === "disabled" &&
        (c.changes as { reason?: string } | null)?.reason === "auto_disable",
    );
    expect(autoDisable).toBeDefined();
    expect(autoDisable!.createdBy).toBeNull();
    expect(
      (autoDisable!.changes as { consecutiveFailures?: number })
        ?.consecutiveFailures,
    ).toBe(3);

    // The disabled check is never selected again — no post-disable rows.
    await sweepOnce();
    expect(await getObservations(testDb.db, checkId)).toHaveLength(3);
  });

  it("per-check autoDisableAfter overrides the global default", async () => {
    setThreshold(5);
    const { checkId } = await seedCheck(testDb.db, {
      slug: "override",
      autoDisableAfter: 2,
    });
    await fail(checkId, iso(0));
    await fail(checkId, iso(1000));
    const check = await getCheck(testDb.db, checkId);
    expect(check.enabled).toBe(false);
    expect(check.autoDisabledAt).not.toBeNull();
  });

  it("autoDisableAfter=0 on a check never auto-disables", async () => {
    setThreshold(2);
    const { checkId } = await seedCheck(testDb.db, {
      slug: "never",
      autoDisableAfter: 0,
    });
    await fail(checkId, iso(0));
    await fail(checkId, iso(1000));
    await fail(checkId, iso(2000));
    const check = await getCheck(testDb.db, checkId);
    expect(check.enabled).toBe(true);
    expect(check.consecutiveFailures).toBe(3);
    expect(check.autoDisabledAt).toBeNull();
  });

  it("URL_CHECK_AUTO_DISABLE_AFTER=0 disables the policy fleet-wide", async () => {
    setThreshold(0);
    const { checkId } = await seedCheck(testDb.db, { slug: "env-off" });
    await fail(checkId, iso(0));
    await fail(checkId, iso(1000));
    await fail(checkId, iso(2000));
    const check = await getCheck(testDb.db, checkId);
    expect(check.enabled).toBe(true);
    expect(check.consecutiveFailures).toBe(3);
  });

  it("dispatch-time MISSED outcomes count toward the streak", async () => {
    setThreshold(2);
    const agentId = uuidv7();
    await testDb.db
      .insertInto("import_agents")
      .values({ id: agentId, name: "offline-agent", createdBy: null } as any)
      .execute();
    const { checkId } = await seedCheck(testDb.db, {
      slug: "agent-missed",
      vantage: "AGENT",
      agentId,
    });
    await fail(checkId, iso(0));
    let check = await getCheck(testDb.db, checkId);
    expect(check.consecutiveFailures).toBe(1);
    expect(check.enabled).toBe(true);

    await fail(checkId, iso(1000));
    check = await getCheck(testDb.db, checkId);
    expect(check.enabled).toBe(false);
    const obs = await getObservations(testDb.db, checkId);
    expect(obs.map((o) => o.outcome)).toEqual(["MISSED", "MISSED"]);
  });

  it("backlog MISSED slots advance the streak and disable mid-sweep", async () => {
    setThreshold(3);
    const { checkId } = await seedCheck(testDb.db, {
      slug: "backlog",
      cadenceSeconds: 60,
      // Exactly 4 slots due: 3 backlog MISSED + 1 live — the disable
      // fires after the backlog lands and the live slot never dispatches.
      // The 30s headroom keeps a fifth slot from falling due mid-test.
      nextProbeAt: iso(-3 * 60_000 - 30_000),
    });
    await sweepOnce();

    const check = await getCheck(testDb.db, checkId);
    expect(check.enabled).toBe(false);
    expect(check.autoDisabledAt).not.toBeNull();
    expect(check.consecutiveFailures).toBe(3);
    const obs = await getObservations(testDb.db, checkId);
    expect(obs).toHaveLength(3);
    expect(obs.every((o) => o.outcome === "MISSED")).toBe(true);

    await sweepOnce();
    expect(await getObservations(testDb.db, checkId)).toHaveLength(3);
  });

  it("owner resume restores scheduling and preserves the streak; auto-disable is sticky", async () => {
    // Spec 058: managed checks have no manual write path -- the owner
    // ImporterConfig's enabled flag drives scheduling via recompute.
    // Resuming restores enabled/nextProbeAt but never rewrites the streak.
    const { recomputeManagedCheckEnabled } = await import(
      "../../src/services/url-check-service.js"
    );
    const { checkId, configId } = await seedManagedCheck(testDb.db, {
      slug: "resume",
      configEnabled: false,
      consecutiveFailures: 2,
    });
    await recomputeManagedCheckEnabled(testDb.db as never, checkId);
    let check = await getCheck(testDb.db, checkId);
    expect(check.enabled).toBe(false);
    expect(check.nextProbeAt).toBeNull();

    await testDb.db
      .updateTable("importer_configs")
      .set({ enabled: true })
      .where("id", "=", configId)
      .execute();
    await recomputeManagedCheckEnabled(testDb.db as never, checkId);
    check = await getCheck(testDb.db, checkId);
    expect(check.enabled).toBe(true);
    expect(check.nextProbeAt).not.toBeNull();
    // The streak survives the pause/resume cycle -- a fresh failure
    // advances it rather than restarting.
    expect(check.consecutiveFailures).toBe(2);

    // Sticky auto-disable: autoDisabledAt keeps the check off even with
    // an enabled owner.
    const { checkId: stickyId } = await seedManagedCheck(testDb.db, {
      slug: "sticky",
      autoDisabledAt: iso(0),
    });
    await recomputeManagedCheckEnabled(testDb.db as never, stickyId);
    const sticky = await getCheck(testDb.db, stickyId);
    expect(sticky.enabled).toBe(false);
    expect(sticky.nextProbeAt).toBeNull();
  });

  it("exposes autoDisableAfter, consecutiveFailures and autoDisabledAt over the API", async () => {
    setThreshold(undefined);
    const { componentId, checkId } = await seedCheck(testDb.db, {
      slug: "fields",
      autoDisableAfter: 5,
    });
    const single = await app.inject({
      method: "GET",
      url: `/api/v1/url-checks/${checkId}`,
      ...authed(adminSession),
    });
    expect(single.statusCode).toBe(200);
    const check = single.json().check;
    expect(check.autoDisableAfter).toBe(5);
    expect(check.consecutiveFailures).toBe(0);
    expect(check.autoDisabledAt).toBeNull();

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/components/${componentId}/url-checks`,
      ...authed(adminSession),
    });
    expect(list.statusCode).toBe(200);
    const item = list
      .json()
      .checks.find((c: { id: string }) => c.id === checkId);
    expect(item.autoDisableAfter).toBe(5);
    expect(item.consecutiveFailures).toBe(0);
  });

  it("rejects out-of-range autoDisableAfter values in a managed check def", async () => {
    // Spec 058: bounds moved from the retired PATCH route to the
    // collection scope schema at ImporterConfig create.
    const scopeWith = (autoDisableAfter: unknown) => ({
      sourceKey: uuidv7(),
      components: [
        {
          componentKey: uuidv7(),
          name: "Bounds",
          instances: [
            {
              instanceKey: uuidv7(),
              environment: "PRODUCTION",
              url: "https://example.com/",
              check: {
                checkKey: uuidv7(),
                name: "check",
                method: "GET",
                enabled: true,
                successPolicy: { codes: [], ranges: [{ min: 200, max: 299 }] },
                authMode: "NONE",
                autoDisableAfter,
              },
            },
          ],
        },
      ],
    });
    for (const autoDisableAfter of [-1, 1001, 2.5, "ten"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/importer-configs",
        cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
        headers: csrfHeader,
        payload: {
          importerName: "web-url",
          label: "bounds",
          scope: scopeWith(autoDisableAfter),
          secretRefs: [],
        },
      });
      expect(res.statusCode).toBe(400);
    }
    // null clears the field -- the scope validates cleanly.
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/importer-configs",
      cookies: { [SESSION_COOKIE_NAME]: adminSession, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        importerName: "web-url",
        label: "bounds-ok",
        scope: scopeWith(null),
        secretRefs: [],
      },
    });
    expect(ok.statusCode).toBe(201);
  });
});
