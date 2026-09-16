import { describe, it, expect, afterEach } from "vitest";
import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";

describe("migrations", () => {
  let testDb: TestDb | null = null;

  afterEach(async () => {
    if (testDb) {
      await testDb.cleanup();
      testDb = null;
    }
  });

  it("creates all 22 domain tables", async () => {
    testDb = await startTestDb();
    const result = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`.execute(
      testDb.db,
    );
    const tableNames = result.rows.map((r) => r.table_name);
    const expectedTables = [
      "component_depends_on_component",
      "component_exposes",
      "component_groups",
      "component_instances",
      "component_sources_from",
      "components",
      "digital_products",
      "edge_changes",
      "entity_changes",
      "import_run_errors",
      "import_runs",
      "importer_configs",
      "line_of_businesses",
      "oidc_config",
      "password_reset_tokens",
      "persons",
      "product_composes",
      "product_consumes_from",
      "product_depends_on_component",
      "sessions",
      "teams",
      "app_settings",
    ];
    for (const table of expectedTables) {
      expect(tableNames).toContain(table);
    }
    expect(tableNames.length).toBeGreaterThanOrEqual(22);
  });

  it("enforces CHECK constraints on persons.role", async () => {
    testDb = await startTestDb();
    await expect(
      testDb.db
        .insertInto("persons")
        .values({
          id: uuidv7(),
          username: "testuser",
          passwordHash: "hash",
          role: "INVALID_ROLE",
          slug: "testuser",
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .execute(),
    ).rejects.toThrow();
  });

  it("accepts ACCOUNT as a component category", async () => {
    testDb = await startTestDb();
    const now = new Date().toISOString();

    await testDb.db
      .insertInto("components")
      .values({
        id: uuidv7(),
        name: "GitHub Org",
        slug: "github-org",
        category: "ACCOUNT",
        provider: "GITHUB",
        resourceType: "github:organization",
        lifecycle: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await expect(
      testDb.db
        .insertInto("components")
        .values({
          id: uuidv7(),
          name: "Bad",
          slug: "bad",
          category: "NOT_A_CATEGORY" as never,
          provider: "GITHUB",
          resourceType: "github:organization",
          lifecycle: "ACTIVE",
          createdAt: now,
          updatedAt: now,
        })
        .execute(),
    ).rejects.toThrow();
  });

  it("enforces append-only on entity_changes", async () => {
    testDb = await startTestDb();
    // Insert a row
    await testDb.db
      .insertInto("entity_changes")
      .values({
        id: uuidv7(),
        entityType: "Component",
        entityId: uuidv7(),
        action: "CREATE",
        createdAt: new Date().toISOString(),
      })
      .execute();
    // Attempt to update — should fail
    await expect(
      testDb.db
        .updateTable("entity_changes")
        .set({ action: "UPDATE" })
        .where("entityType", "=", "Component")
        .execute(),
    ).rejects.toThrow();
  });

  it("enforces NOT NULL on component_instances.externalId", async () => {
    testDb = await startTestDb();
    const componentId = uuidv7();
    const now = new Date().toISOString();

    await testDb.db
      .insertInto("components")
      .values({
        id: componentId,
        name: "Test Component",
        slug: "test-component",
        category: "COMPUTE",
        provider: "AWS",
        resourceType: "ec2:instance",
        lifecycle: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await expect(
      sql`INSERT INTO component_instances (id, componentId, environment, status, slug, createdAt, updatedAt)
          VALUES (${uuidv7()}, ${componentId}, 'DEV', 'RUNNING', 'test-instance', ${now}, ${now})`.execute(
        testDb.db,
      ),
    ).rejects.toThrow();
  });

  it("enforces unique (componentId, externalId) on component_instances", async () => {
    testDb = await startTestDb();
    const componentId = uuidv7();
    const now = new Date().toISOString();

    await testDb.db
      .insertInto("components")
      .values({
        id: componentId,
        name: "Test Component",
        slug: "test-component",
        category: "COMPUTE",
        provider: "AWS",
        resourceType: "ec2:instance",
        lifecycle: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await testDb.db
      .insertInto("component_instances")
      .values({
        id: uuidv7(),
        componentId,
        environment: "DEV",
        status: "RUNNING",
        externalId: "same-instance",
        slug: "same-instance-dev",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await expect(
      testDb.db
        .insertInto("component_instances")
        .values({
          id: uuidv7(),
          componentId,
          environment: "PRODUCTION",
          status: "RUNNING",
          externalId: "same-instance",
          slug: "same-instance-prod",
          createdAt: now,
          updatedAt: now,
        })
        .execute(),
    ).rejects.toThrow();
  });
});
