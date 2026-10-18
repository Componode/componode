import { describe, it, expect, afterEach } from "vitest";
import { sql } from "kysely";
import { uuidv7 } from "uuidv7";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";

/**
 * Migration 012 — practical catalog metadata columns (spec 017, T007).
 * Asserts the additive columns, their defaults, the criticality CHECK, and
 * the GIN tag indexes exist.
 */
describe("metadata migration (012)", () => {
  let testDb: TestDb | null = null;

  afterEach(async () => {
    if (testDb) {
      await testDb.cleanup();
      testDb = null;
    }
  });

  it("adds metadata columns with defaults on digital_products and components", async () => {
    testDb = await startTestDb();
    const now = new Date().toISOString();
    const productId = uuidv7();

    await testDb.db
      .insertInto("digital_products")
      .values({
        id: productId,
        name: "Payments",
        slug: "payments",
        type: "BUSINESS_CAPABILITY",
        lifecycle: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    const product = await testDb.db
      .selectFrom("digital_products")
      .select(["links", "tags", "criticality", "sunsetAt"])
      .where("id", "=", productId)
      .executeTakeFirstOrThrow();

    expect(product.links).toEqual([]);
    expect(product.tags).toEqual([]);
    expect(product.criticality).toBeNull();
    expect(product.sunsetAt).toBeNull();

    const componentId = uuidv7();
    await testDb.db
      .insertInto("components")
      .values({
        id: componentId,
        name: "kafka",
        slug: "kafka",
        category: "QUEUE",
        provider: "AWS",
        resourceType: "kafka:cluster",
        lifecycle: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    const component = await testDb.db
      .selectFrom("components")
      .select(["links", "tags", "sunsetAt"])
      .where("id", "=", componentId)
      .executeTakeFirstOrThrow();

    expect(component.links).toEqual([]);
    expect(component.tags).toEqual([]);
    expect(component.sunsetAt).toBeNull();
  });

  it("enforces the criticality CHECK on digital_products", async () => {
    testDb = await startTestDb();
    const now = new Date().toISOString();

    await testDb.db
      .insertInto("digital_products")
      .values({
        id: uuidv7(),
        name: "Checkout",
        slug: "checkout",
        type: "CUSTOMER_FACING",
        lifecycle: "ACTIVE",
        criticality: "CRITICAL",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await expect(
      testDb.db
        .insertInto("digital_products")
        .values({
          id: uuidv7(),
          name: "Bad",
          slug: "bad-crit",
          type: "PLATFORM",
          lifecycle: "ACTIVE",
          criticality: "TIER_1" as never,
          createdAt: now,
          updatedAt: now,
        })
        .execute(),
    ).rejects.toThrow();
  });

  it("creates GIN indexes on both tags columns", async () => {
    testDb = await startTestDb();
    const result =
      await sql`SELECT indexname FROM pg_indexes WHERE indexname IN ('digital_products_tags_gin','components_tags_gin')`.execute(
        testDb.db,
      );
    const names = result.rows.map((r) => r.indexname as string);
    expect(names).toContain("digital_products_tags_gin");
    expect(names).toContain("components_tags_gin");
  });
});
