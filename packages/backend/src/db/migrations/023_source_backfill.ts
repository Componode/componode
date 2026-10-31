import type { Kysely } from "kysely";
import { canonicalizeSourceIdentity } from "@componode/core";
import { uuidv7 } from "uuidv7";
import type { DB } from "../types.js";

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
 * Idempotent: membership inserts use ON CONFLICT DO NOTHING; the Source
 * lookup uses select-then-insert under UNIQUE(importerName, externalIdentity),
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

function deriveIdentity(importerName: string, scope: unknown): string | null {
  const rule = DERIVABLE[importerName];
  if (!rule || typeof scope !== "object" || scope === null) return null;
  const raw = (scope as Record<string, unknown>)[rule.field];
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  return rule.url ? canonicalizeSourceIdentity(raw) : raw.trim();
}

export async function up(db: Kysely<unknown>): Promise<void> {
  const kdb = db as Kysely<DB>;
  const configs = await kdb.selectFrom("importer_configs").selectAll().execute();
  const now = new Date().toISOString();

  for (const config of configs) {
    const identity = deriveIdentity(config.importerName, config.scope);
    if (!identity) continue;

    // Latest STARTED run of this config — Postgres DESC is NULLS FIRST,
    // so without the filter a PENDING run would win the anchor.
    const latestRun = await kdb
      .selectFrom("import_runs")
      .select("id")
      .where("configId", "=", config.id)
      .where("startedAt", "is not", null)
      .orderBy("startedAt", "desc")
      .limit(1)
      .executeTakeFirst();
    if (!latestRun) continue;

    // getOrCreate the Source (UNIQUE(importerName, externalIdentity)).
    let sourceId: string;
    const existing = await kdb
      .selectFrom("importer_sources")
      .select("id")
      .where("importerName", "=", config.importerName)
      .where("externalIdentity", "=", identity)
      .executeTakeFirst();

    if (existing) {
      sourceId = existing.id;
    } else {
      sourceId = uuidv7();
      await kdb
        .insertInto("importer_sources")
        .values({
          id: sourceId,
          importerName: config.importerName,
          externalIdentity: identity,
          label: identity,
          status: "ACTIVE",
          boundConfigId: config.id,
          firstSeenInRunId: latestRun.id,
          lastSeenInRunId: latestRun.id,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }

    // Component memberships for rows last seen by this config's runs.
    // Provenance is per-entity: each row's own lastSeenInRunId is the run
    // that actually saw it, not the config's latest run (migration-rules).
    // Defensible attribution (ADR-120 A2): skip ids that can't belong to
    // the derived identity — `default:` placeholders (unknowable owner)
    // and URL-embedded ids whose canonicalized endpoint isn't this Source
    // (pre-upgrade config repointing).
    const components = await kdb
      .selectFrom("components")
      .select(["id", "lastSeenInRunId", "externalId"])
      .where("lifecycle", "=", "ACTIVE")
      .where(
        "lastSeenInRunId",
        "in",
        kdb
          .selectFrom("import_runs")
          .select("id")
          .where("configId", "=", config.id),
      )
      .execute();
    const attributable = components.filter((c) => {
      const id = c.externalId;
      if (id === null) return true;
      if (id.startsWith("default:")) return false;
      if (!id.includes("://")) return true;
      if (canonicalizeSourceIdentity(id) === identity) return true;
      const i = id.lastIndexOf(":");
      return i !== -1 && canonicalizeSourceIdentity(id.slice(0, i)) === identity;
    });

    for (const component of attributable) {
      await kdb
        .insertInto("source_component_memberships")
        .values({
          id: uuidv7(),
          sourceId,
          componentId: component.id,
          active: true,
          details: null,
          firstSeenInRunId: component.lastSeenInRunId,
          lastSeenInRunId: component.lastSeenInRunId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflict((oc) =>
          oc.columns(["sourceId", "componentId"]).doNothing(),
        )
        .execute();
    }

    // Instance memberships for instances of those components — same
    // provenance rule as components: only rows an importer run actually
    // saw (lastSeenInRunId ∈ config's runs). Manually created instances
    // carry no memberships and are never touched by source reconciliation.
    if (attributable.length === 0) continue;
    const instances = await kdb
      .selectFrom("component_instances")
      .select(["id", "lastSeenInRunId"])
      .where("componentId", "in", attributable.map((c) => c.id))
      .where(
        "lastSeenInRunId",
        "in",
        kdb
          .selectFrom("import_runs")
          .select("id")
          .where("configId", "=", config.id),
      )
      .execute();

    for (const instance of instances) {
      await kdb
        .insertInto("source_instance_memberships")
        .values({
          id: uuidv7(),
          sourceId,
          componentInstanceId: instance.id,
          active: true,
          details: null,
          firstSeenInRunId: instance.lastSeenInRunId,
          lastSeenInRunId: instance.lastSeenInRunId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflict((oc) =>
          oc.columns(["sourceId", "componentInstanceId"]).doNothing(),
        )
        .execute();
    }
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Remove only what this migration could have created AND that no live
  // run has since claimed: memberships and Sources bound to derivable
  // configs whose id appears in no `import_runs.sourceId`. A Source a
  // real run adopted stays (the FK is RESTRICT and the run is real
  // provenance, not migration output). Never touches runs or components.
  const kdb = db as Kysely<DB>;
  const configs = await kdb.selectFrom("importer_configs").selectAll().execute();

  for (const config of configs) {
    const identity = deriveIdentity(config.importerName, config.scope);
    if (!identity) continue;
    const source = await kdb
      .selectFrom("importer_sources")
      .select("id")
      .where("importerName", "=", config.importerName)
      .where("externalIdentity", "=", identity)
      .executeTakeFirst();
    if (!source) continue;

    const referenced = await kdb
      .selectFrom("import_runs")
      .select("id")
      .where("sourceId", "=", source.id)
      .limit(1)
      .executeTakeFirst();
    if (referenced) continue;

    await kdb
      .deleteFrom("source_instance_memberships")
      .where("sourceId", "=", source.id)
      .execute();
    await kdb
      .deleteFrom("source_component_memberships")
      .where("sourceId", "=", source.id)
      .execute();
    await kdb.deleteFrom("importer_sources").where("id", "=", source.id).execute();
  }
}
