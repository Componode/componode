import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  SESSION_COOKIE_NAME,
  createPersonInDb,
  createSessionInDb,
} from "../helpers/api.js";
import { uuidv7 } from "uuidv7";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";

describe("audit feed entity display names (G11)", () => {
  let testDb: TestDb;
  let app: any;
  let adminSession: string;

  const saved: Record<string, string | undefined> = {};
  const ids: Record<string, string> = {};
  const now = () => new Date().toISOString();

  beforeAll(async () => {
    for (const k of ["DATABASE_URL", "NODE_ENV", "BOOTSTRAP_ADMIN_USERNAME", "BOOTSTRAP_ADMIN_PASSWORD"]) {
      saved[k] = process.env[k];
    }
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

    const adminRow = await testDb.db
      .selectFrom("persons")
      .select(["id"])
      .where("username", "=", ADMIN_USERNAME)
      .executeTakeFirstOrThrow();
    adminSession = (await createSessionInDb(testDb.db, adminRow.id)).token;

    // Seed one entity per name-source type.
    ids.product = uuidv7();
    await testDb.db.insertInto("digital_products").values({
      id: ids.product, name: "Payments App", slug: "payments-app",
      description: null, type: "BUSINESS_CAPABILITY", lifecycle: "ACTIVE",
      lobOwnerId: null, teamOwnerId: null, sunsetAt: null,
      createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    ids.component = uuidv7();
    await testDb.db.insertInto("components").values({
      id: ids.component, name: "payments-db", slug: "payments-db",
      category: "DATABASE", provider: "AWS", resourceType: "rds",
      lifecycle: "ACTIVE", teamOwnerId: null, componentGroupId: null,
      externalId: null, details: null, sunsetAt: null,
      lastSeenAt: null, lastSeenInRunId: null,
      createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    ids.instance = uuidv7();
    await testDb.db.insertInto("component_instances").values({
      id: ids.instance, componentId: ids.component, environment: "PRODUCTION",
      externalId: "ext-inst-1", slug: "inst-1", url: null, region: null,
      status: "RUNNING", version: null, deployedAt: null, rawConfig: null,
      lastSeenAt: null, lastSeenInRunId: null,
      createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    ids.group = uuidv7();
    await testDb.db.insertInto("component_groups").values({
      id: ids.group, name: "Data Services", slug: "data-services",
      description: null, lifecycle: "ACTIVE", teamOwnerId: null,
      createdBy: null, updatedBy: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    ids.team = uuidv7();
    await testDb.db.insertInto("teams").values({
      id: ids.team, name: "Platform Eng", slug: "platform-eng",
      description: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    ids.lob = uuidv7();
    await testDb.db.insertInto("line_of_businesses").values({
      id: ids.lob, name: "Payments", slug: "payments",
      description: null, createdAt: now(), updatedAt: now(),
    } as never).execute();

    ids.config = uuidv7();
    await testDb.db.insertInto("importer_configs").values({
      id: ids.config, importerName: "aws", label: "prod-aws",
      scope: {}, secretRefs: null, schedule: null, enabled: true,
      agentId: null, createdBy: null, updatedBy: null,
      createdAt: now(), updatedAt: now(),
    } as never).execute();

    ids.credential = uuidv7();
    await testDb.db.insertInto("credentials").values({
      id: ids.credential, slug: "cred-1", label: "github-token",
      status: "ACTIVE", kind: "STORED", encryptedPayload: { token: "not-real" },
      secretRefMap: null, keyVersion: 1, keyHints: {}, expiresAt: null,
      lastUsedAt: null, createdBy: null, updatedBy: null,
      createdAt: now(), updatedAt: now(),
    } as never).execute();

    ids.agent = uuidv7();
    await testDb.db.insertInto("import_agents").values({
      id: ids.agent, name: "edge-agent-1",
    } as never).execute();

    ids.userNamed = await createPersonInDb(testDb.db, {
      username: "ada", displayName: "Ada Lovelace",
    });
    ids.userPlain = await createPersonInDb(testDb.db, {
      username: "grace", displayName: null,
    });
    ids.deleted = uuidv7(); // referenced by a change but no row exists

    const base = new Date("2026-10-01T10:00:00.000Z").getTime();
    const change = (
      entityType: string,
      entityId: string | null,
      i: number,
    ) => ({
      id: uuidv7(), entityType, entityId, action: "updated",
      changes: { name: "x" }, importRunId: null,
      createdBy: adminRow.id, createdByName: "admin",
      createdAt: new Date(base + i * 1000).toISOString(),
    });

    await testDb.db.insertInto("entity_changes").values([
      change("digital_product", ids.product, 0),
      change("component", ids.component, 1),
      change("component_instance", ids.instance, 2),
      change("component_group", ids.group, 3),
      change("team", ids.team, 4),
      change("line_of_business", ids.lob, 5),
      change("importer_config", ids.config, 6),
      change("credential", ids.credential, 7),
      change("import_agent", ids.agent, 8),
      change("user", ids.userNamed, 9),
      change("user", ids.userPlain, 10),
      change("component", ids.deleted, 11), // deleted entity → null
      change("settings", null, 12),          // non-entity → null
      change("auth", null, 13),              // non-entity → null
    ] as never).execute();

    await testDb.db.insertInto("edge_changes").values({
      id: uuidv7(), edgeType: "DEPENDS_ON_COMPONENT",
      fromEntityType: "digital_product", fromEntityId: ids.product,
      toEntityType: "component", toEntityId: ids.component,
      action: "added", reason: null,
      createdBy: adminRow.id, createdByName: "admin",
      createdAt: new Date(base + 14_000).toISOString(),
    }).execute();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testDb?.cleanup();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function feed(): Promise<any[]> {
    const res = await app.inject({
      method: "GET", url: "/api/v1/audit/activity?limit=200",
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    return res.json().items;
  }

  it("entity rows carry entityName resolved per type", async () => {
    const items = await feed();
    const byType = (t: string, id?: string | null) =>
      items.find((i) => i.kind === "entity" && i.entityType === t && (id === undefined || i.entityId === id));

    expect(byType("digital_product").entityName).toBe("Payments App");
    expect(byType("component", ids.component).entityName).toBe("payments-db");
    expect(byType("component_instance").entityName).toBe("payments-db · PRODUCTION");
    expect(byType("component_group").entityName).toBe("Data Services");
    expect(byType("team").entityName).toBe("Platform Eng");
    expect(byType("line_of_business").entityName).toBe("Payments");
    expect(byType("importer_config").entityName).toBe("prod-aws");
    expect(byType("credential").entityName).toBe("github-token");
    expect(byType("import_agent").entityName).toBe("edge-agent-1");
    expect(byType("user", ids.userNamed).entityName).toBe("Ada Lovelace");
    expect(byType("user", ids.userPlain).entityName).toBe("grace"); // username fallback
  });

  it("unresolvable rows carry null names", async () => {
    const items = await feed();
    const deleted = items.find((i) => i.entityId === ids.deleted);
    expect(deleted.entityName).toBeNull();
    for (const t of ["settings", "auth"]) {
      expect(items.find((i) => i.entityType === t).entityName).toBeNull();
    }
  });

  it("edge rows carry fromEntityName and toEntityName", async () => {
    const items = await feed();
    const edge = items.find((i) => i.kind === "edge");
    expect(edge.fromEntityName).toBe("Payments App");
    expect(edge.toEntityName).toBe("payments-db");
  });

  it("entity history carries entityName", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/audit/entities/component/${ids.component}`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.every((i: any) => i.entityName === "payments-db" || i.entityName === null || i.kind === "edge")).toBe(true);
    // Edge row on history exposes both endpoint names too.
    const edge = items.find((i: any) => i.kind === "edge");
    expect(edge.toEntityName).toBe("payments-db");
  });

  it("run changes carry entityName", async () => {
    const runId = uuidv7();
    await testDb.db.insertInto("import_runs").values({
      id: runId, configId: ids.config, status: "COMPLETED",
      assetsProcessed: 1, assetsCreated: 1, assetsUpdated: 0,
      instancesOrphaned: 0, componentsRetired: 0, createdAt: now(),
    } as never).execute();
    await testDb.db.insertInto("entity_changes").values({
      id: uuidv7(), entityType: "component", entityId: ids.component,
      action: "created", changes: { name: "payments-db" },
      importRunId: runId, createdBy: null, createdByName: "importer:aws",
      createdAt: now(),
    } as never).execute();

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/importer-configs/${ids.config}/runs/${runId}/changes`,
      cookies: { [SESSION_COOKIE_NAME]: adminSession },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().changes[0].entityName).toBe("payments-db");
  });

  it("renames surface the current name", async () => {
    await testDb.db.updateTable("components")
      .set({ name: "payments-db-v2" })
      .where("id", "=", ids.component)
      .execute();
    const items = await feed();
    expect(items.find((i) => i.entityId === ids.component).entityName).toBe("payments-db-v2");
  });
});
