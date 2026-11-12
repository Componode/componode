import { sql, type Kysely } from "kysely";

// Legacy columns being read/dropped aren't in the DB type — migrations
// touching evolving shapes use the untyped handle (repo convention).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyKysely = Kysely<any>;

/**
 * Migration 030 — Multi-group membership + app-level auto groups
 * (spec 070, ADR-129 amendment).
 *
 * Promotes `components.componentGroupId` (single-valued) to the
 * `component_group_members` join table so a component can belong to any
 * number of groups — human, source-auto, and app-auto — simultaneously.
 *
 * Provenance moves onto `component_groups`: `autoSourceId` +
 * `autoGroupKey` replace `importer_sources.componentGroupId` as the
 * source→group link and the auto-managed marker. `autoSourceId IS NOT
 * NULL` is the single auto-managed predicate covering both the source
 * group (`autoGroupKey IS NULL`) and app groups (`compose:{p}` /
 * `stack:{n}`). Partial unique indexes keep one source group and one
 * group per (source, app key) per source.
 *
 * Backfill order matters: join rows and provenance columns are populated
 * from the legacy columns before either is dropped.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const kdb = db as AnyKysely;
  // 1. Membership join table
  await db.schema
    .createTable("component_group_members")
    .addColumn("componentId", "uuid", (col) =>
      col.notNull().references("components.id").onDelete("cascade"),
    )
    .addColumn("groupId", "uuid", (col) =>
      col.notNull().references("component_groups.id").onDelete("cascade"),
    )
    .addColumn("createdAt", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("component_group_members_pkey", [
      "componentId",
      "groupId",
    ])
    .execute();

  await db.schema
    .createIndex("component_group_members_component_idx")
    .on("component_group_members")
    .column("componentId")
    .execute();

  await db.schema
    .createIndex("component_group_members_group_idx")
    .on("component_group_members")
    .column("groupId")
    .execute();

  // 2. Backfill memberships from the single-valued column
  const groupedComponents = await kdb
    .selectFrom("components")
    .select(["id", "componentGroupId"])
    .where("componentGroupId", "is not", null)
    .execute();
  if (groupedComponents.length > 0) {
    await kdb
      .insertInto("component_group_members")
      .values(
        groupedComponents.map((c) => ({
          componentId: c.id,
          groupId: c.componentGroupId!,
        })),
      )
      .execute();
  }

  // 3. Provenance columns on component_groups
  await db.schema
    .alterTable("component_groups")
    .addColumn("autoSourceId", "uuid", (col) =>
      col.references("importer_sources.id").onDelete("set null"),
    )
    .execute();

  await db.schema
    .alterTable("component_groups")
    .addColumn("autoGroupKey", "text")
    .execute();

  // autoGroupKey without autoSourceId would be a human-managed group
  // carrying an app key — invisible to the auto-managed predicate
  // (autoSourceId IS NOT NULL). Enforce the implication in the schema.
  await sql`
    ALTER TABLE component_groups
    ADD CONSTRAINT component_groups_auto_key_requires_source
    CHECK ("autoGroupKey" IS NULL OR "autoSourceId" IS NOT NULL)
  `.execute(db);

  // 4. Backfill: every group linked from importer_sources is that source's
  //    own auto group (autoGroupKey stays NULL).
  const linkedSources = await kdb
    .selectFrom("importer_sources")
    .select(["id", "componentGroupId"])
    .where("componentGroupId", "is not", null)
    .execute();
  for (const source of linkedSources) {
    await kdb
      .updateTable("component_groups")
      .set({ autoSourceId: source.id })
      .where("id", "=", source.componentGroupId!)
      .execute();
  }

  // 5. Uniqueness: one source group per source, one app group per
  //    (source, key). Partial so human groups (autoSourceId NULL) are exempt.
  await db.schema
    .createIndex("component_groups_auto_source_idx")
    .on("component_groups")
    .column("autoSourceId")
    .unique()
    .where("autoSourceId", "is not", null)
    .where(sql.ref("autoGroupKey"), "is", null)
    .execute();

  await db.schema
    .createIndex("component_groups_auto_app_key_idx")
    .on("component_groups")
    .columns(["autoSourceId", "autoGroupKey"])
    .unique()
    .where("autoSourceId", "is not", null)
    .where("autoGroupKey", "is not", null)
    .execute();

  // 6. Drop the legacy single-valued columns
  await db.schema
    .alterTable("components")
    .dropColumn("componentGroupId")
    .execute();

  await db.schema
    .dropIndex("importer_sources_component_group_idx")
    .execute();

  await db.schema
    .alterTable("importer_sources")
    .dropColumn("componentGroupId")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const kdb = db as AnyKysely;
  await db.schema
    .alterTable("importer_sources")
    .addColumn("componentGroupId", "uuid", (col) =>
      col.references("component_groups.id").onDelete("set null"),
    )
    .execute();

  // Restore the source→group link from provenance columns (source groups only)
  const autoSources = await kdb
    .selectFrom("component_groups")
    .select(["id", "autoSourceId"])
    .where("autoSourceId", "is not", null)
    .where("autoGroupKey", "is", null)
    .execute();
  for (const group of autoSources) {
    await kdb
      .updateTable("importer_sources")
      .set({ componentGroupId: group.id })
      .where("id", "=", group.autoSourceId!)
      .execute();
  }

  await db.schema
    .createIndex("importer_sources_component_group_idx")
    .on("importer_sources")
    .column("componentGroupId")
    .execute();

  await db.schema
    .alterTable("components")
    .addColumn("componentGroupId", "uuid", (col) =>
      col.references("component_groups.id").onDelete("set null"),
    )
    .execute();

  // Restore single-valued membership: first membership row wins (PK order
  // is arbitrary; down-migrations are best-effort).
  const memberships = await kdb
    .selectFrom("component_group_members")
    .select(["componentId", "groupId"])
    .execute();
  const seen = new Set<string>();
  for (const m of memberships) {
    if (seen.has(m.componentId)) continue;
    seen.add(m.componentId);
    await kdb
      .updateTable("components")
      .set({ componentGroupId: m.groupId })
      .where("id", "=", m.componentId)
      .execute();
  }

  await sql`
    ALTER TABLE component_groups
    DROP CONSTRAINT IF EXISTS component_groups_auto_key_requires_source
  `.execute(db);

  await db.schema
    .dropIndex("component_groups_auto_app_key_idx")
    .execute();
  await db.schema
    .dropIndex("component_groups_auto_source_idx")
    .execute();

  await db.schema
    .alterTable("component_groups")
    .dropColumn("autoGroupKey")
    .execute();
  await db.schema
    .alterTable("component_groups")
    .dropColumn("autoSourceId")
    .execute();

  await db.schema.dropTable("component_group_members").execute();
}
