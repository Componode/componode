import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Migration 013 — product DEPENDS_ON may target a ComponentGroup (ADR-110).
 *
 * New junction `product_depends_on_component_group`, mirroring
 * `product_depends_on_component` (ADR-048): composite PK, cascade FKs.
 * The edge is persisted as product→group and expanded at read time — group
 * membership changes propagate automatically. The cascade FKs are a safety
 * net; `deleteComponentGroup` gains a service-level guard (409 REFERENCED)
 * so depended-on groups are not silently dropped (spec 019, FR-009).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("product_depends_on_component_group")
    .addColumn("productId", "uuid", (col) =>
      col.notNull().references("digital_products.id").onDelete("cascade"),
    )
    .addColumn("componentGroupId", "uuid", (col) =>
      col.notNull().references("component_groups.id").onDelete("cascade"),
    )
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("product_depends_on_component_group_pkey", [
      "productId",
      "componentGroupId",
    ])
    .execute();

  await db.schema
    .createIndex("product_depends_on_component_group_group_idx")
    .on("product_depends_on_component_group")
    .column("componentGroupId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("product_depends_on_component_group").execute();
}
