import type { Kysely } from "kysely";
import { canonicalizeSourceIdentity } from "@componode/core";
import { uuidv7 } from "uuidv7";

/**
 * Migration 023 — ImporterSource backfill for migrated importers
 * (spec 045, ADR-120).
 *
 * Creates ImporterSource rows and Source→Component/ComponentInstance
 * memberships ONLY where the source identity is derivable from the live
 * config's scope alone — the defensible case. GitHub (org id needs an
 * API call), Alibaba Cloud (account id needs an STS call), AWS
 * (sourceKey is new in this spec), and scope-less configs are skipped:
 * their rows keep LEGACY_UNATTRIBUTED provenance and adopt on next
 * report instead.
 *
 * Explicit non-actions (ADR-120 preservation invariants):
 * - `import_runs.sourceId` is never backfilled — historical runs never
 *   reported identity; NULL is factually correct.
 * - `components.externalId` is never batch-rewritten — adoption rekeys
 *   only on live report.
 * - No lifecycle/status changes; nothing is split, merged, or rekeyed.
 *
 * Idempotent: source and membership inserts use ON CONFLICT DO NOTHING,
 * so a partially-repeated migration is safe.
 */

interface DerivationRule {
  /** Scope key carrying the identity value. */
  field: string;
  /** Canonicalize as URL identity (strip userinfo/auth params/fragment). */
  url: boolean;
}

const DERIVABLE: Record<string, DerivationRule> = {
  azure: { field: "subscriptionId", url: false },
  kubernetes: { field: "endpoint", url: true },
  "api-url": { field: "url", url: true },
  "web-url": { field: "url", url: true },
  "mcp-server": { field: "endpoint", url: true },
};

interface ConfigRow {
  id: string;
  importerName: string;
  scope: unknown;
}

function deriveIdentity(
  importerName: string,
  scope: unknown,
): string | null {
  const rule = DERIVABLE[importerName];
  if (!rule || typeof scope !== "object" || scope === null) return null;
  const raw = (scope as Record<string, unknown>)[rule.field];
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  return rule.url ? canonicalizeSourceIdentity(raw) : raw.trim();
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const configs = (await db
    .selectFrom("importer_configs" as never)
    .selectAll()
    .execute()) as ConfigRow[];

  const now = new Date().toISOString();

  for (const config of configs) {
    const identity = deriveIdentity(config.importerName, config.scope);
    if (!identity) continue;

    // Latest run of this config — the membership's lastSeen anchor.
    const latestRun = (await db
      .selectFrom("import_runs" as never)
      .select("id")
      .where("configId" as never, "=", config.id)
      .orderBy("startedAt" as never, "desc")
      .limit(1)
      .executeTakeFirst()) as { id: string } | undefined;
    if (!latestRun) continue;

    // getOrCreate the Source (UNIQUE(importerName, externalIdentity)).
    let source = (await db
      .selectFrom("importer_sources" as never)
      .select("id")
      .where("importerName" as never, "=", config.importerName)
      .where("externalIdentity" as never, "=", identity)
      .executeTakeFirst()) as { id: string } | undefined;

    if (!source) {
      const id = uuidv7();
      await db
        .insertInto("importer_sources" as never)
        .values({
          id,
          importerName: config.importerName,
          externalIdentity: identity,
          label: identity,
          status: "ACTIVE",
          boundConfigId: config.id,
          firstSeenInRunId: latestRun.id,
          lastSeenInRunId: latestRun.id,
          createdAt: now,
          updatedAt: now,
        } as never)
        .execute();
      source = { id };
    }

    // Component memberships for rows last seen by this config's runs.
    const components = (await db
      .selectFrom("components" as never)
      .select("id")
      .where(
        "lastSeenInRunId" as never,
        "in",
        db
          .selectFrom("import_runs" as never)
          .select("id")
          .where("configId" as never, "=", config.id),
      )
      .execute()) as { id: string }[];

    for (const component of components) {
      await db
        .insertInto("source_component_memberships" as never)
        .values({
          id: uuidv7(),
          sourceId: source.id,
          componentId: component.id,
          active: true,
          details: null,
          firstSeenInRunId: latestRun.id,
          lastSeenInRunId: latestRun.id,
          createdAt: now,
          updatedAt: now,
        } as never)
        .onConflict((oc) =>
          oc.columns(["sourceId", "componentId"] as never).doNothing(),
        )
        .execute();
    }

    // Instance memberships for instances of those components.
    if (components.length > 0) {
      const instances = (await db
        .selectFrom("component_instances" as never)
        .select("id")
        .where(
          "componentId" as never,
          "in",
          components.map((c) => c.id),
        )
        .execute()) as { id: string }[];

      for (const instance of instances) {
        await db
          .insertInto("source_instance_memberships" as never)
          .values({
            id: uuidv7(),
            sourceId: source.id,
            componentInstanceId: instance.id,
            active: true,
            details: null,
            firstSeenInRunId: latestRun.id,
            lastSeenInRunId: latestRun.id,
            createdAt: now,
            updatedAt: now,
          } as never)
          .onConflict((oc) =>
            oc.columns(["sourceId", "componentInstanceId"] as never).doNothing(),
          )
          .execute();
      }
    }
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Remove only what this migration could have created: memberships and
  // Sources bound to derivable configs. Never touches runs, components,
  // or externally-created Sources (matched by identity, not provenance).
  const configs = (await db
    .selectFrom("importer_configs" as never)
    .selectAll()
    .execute()) as ConfigRow[];

  for (const config of configs) {
    const identity = deriveIdentity(config.importerName, config.scope);
    if (!identity) continue;
    const source = (await db
      .selectFrom("importer_sources" as never)
      .select("id")
      .where("importerName" as never, "=", config.importerName)
      .where("externalIdentity" as never, "=", identity)
      .executeTakeFirst()) as { id: string } | undefined;
    if (!source) continue;

    await db
      .deleteFrom("source_instance_memberships" as never)
      .where("sourceId" as never, "=", source.id)
      .execute();
    await db
      .deleteFrom("source_component_memberships" as never)
      .where("sourceId" as never, "=", source.id)
      .execute();
    await db
      .deleteFrom("importer_sources" as never)
      .where("id" as never, "=", source.id)
      .execute();
  }
}
