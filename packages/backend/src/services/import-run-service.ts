import { uuidv7 } from "uuidv7";
import PQueue from "p-queue";
import {
  NOOP_TRACER,
  canonicalizeSourceIdentity,
  unqualifyExternalId,
  validateDiscoveredAssetDetailed,
  type DiscoveredAsset,
  type ImportRun,
  type Logger,
} from "@componode/core";
import { db } from "../db/connection.js";
import { logger as appLogger } from "../plugins/logging.js";
import { getImporter, getManifest } from "./importer-registry.js";
import {
  assertRequiredSecrets,
  resolveImportSecrets,
  type CredentialRecord,
} from "../utils/secret-resolver.js";
import { loadKeyring } from "../utils/credential-crypto.js";
import { generateUniqueSlug, generateComponentSlug, generateInstanceSlug } from "../utils/slug.js";
import { metrics } from "../plugins/metrics.js";
import { traceDbQuery } from "../plugins/tracing.js";
import { sql, type Kysely } from "kysely";
import type { DB } from "../db/types.js";
import { writeEntityChange, type Actor } from "./audit-service.js";
import { runSuggestionPass } from "./edge-suggestion-service.js";
import {
  hasEffectiveActiveComponentMembership,
  markOrphanedInstancesGone,
  recordRunSourceIdentity,
} from "./importer-source-service.js";

const maxConcurrency = parseInt(process.env.IMPORTER_MAX_CONCURRENCY ?? "3", 10);
if (isNaN(maxConcurrency) || maxConcurrency < 1) {
  throw new Error("Invalid IMPORTER_MAX_CONCURRENCY");
}

const queue = new PQueue({ concurrency: maxConcurrency });
const runningControllers = new Map<string, AbortController>();

// Remote dispatch seam (spec 027): app.ts installs the RemoteRunService so
// this module never imports it — that would create an import cycle since
// the remote service reuses this module's shared run internals.
export interface RemoteRunDispatcher {
  enqueue(runId: string): Promise<void>;
  cancelRemoteRun(runId: string): Promise<void>;
}

let remoteDispatcher: RemoteRunDispatcher | null = null;

export function setRemoteRunDispatcher(d: RemoteRunDispatcher | null): void {
  remoteDispatcher = d;
}

// Shared run internals — reused by remote-run-service so remote runs get
// identical upsert, reconciliation, and bookkeeping behavior (ADR-116).
export function runActor(importerName: string): Actor {
  return { id: null, name: `importer:${importerName}` };
}

export function createRunLogger(runId: string): Logger {
  const child = appLogger.child({ runId });
  return {
    debug: (msg, data) => child.debug(data ?? {}, msg),
    info: (msg, data) => child.info(data ?? {}, msg),
    warn: (msg, data) => child.warn(data ?? {}, msg),
    error: (msg, data) => child.error(data ?? {}, msg),
    child: (bindings) => createRunLogger(`${runId}:${JSON.stringify(bindings)}`),
  };
}

export function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  if (err instanceof Error && err.message === "AbortError") return true;
  if (typeof err === "object" && err !== null && "name" in err && (err as { name: string }).name === "AbortError") {
    return true;
  }
  return false;
}

export async function updateRun(
  runId: string,
  updates: Partial<ImportRun> & Record<string, unknown>,
): Promise<void> {
  await db.updateTable("import_runs").set(updates).where("id", "=", runId).execute();
}

export async function insertRunError(
  runId: string,
  assetExternalId: string | null,
  errorType: string,
  errorMessage: string,
  errorStack?: string | null,
): Promise<void> {
  await db
    .insertInto("import_run_errors")
    .values({
      id: uuidv7(),
      runId,
      assetExternalId,
      errorType,
      errorMessage,
      errorStack: errorStack ?? null,
      createdAt: new Date().toISOString(),
    })
    .execute();
}

async function ensureUniqueComponentSlug(
  trx: Kysely<DB>,
  base: string,
): Promise<string> {
  return generateUniqueSlug(base, async (slug) => {
    const existing = await trx
      .selectFrom("components")
      .select("components.id")
      .where("components.slug", "=", slug)
      .executeTakeFirst();
    return existing !== undefined;
  });
}

async function ensureUniqueInstanceSlug(
  trx: Kysely<DB>,
  base: string,
  componentId: string,
): Promise<string> {
  return generateUniqueSlug(base, async (slug) => {
    const existing = await trx
      .selectFrom("component_instances")
      .select("component_instances.id")
      .where("component_instances.componentId", "=", componentId)
      .where("component_instances.slug", "=", slug)
      .executeTakeFirst();
    return existing !== undefined;
  });
}

/** Source attribution for a run — null pair = legacy config-scoped run. */
export interface RunSource {
  sourceId: string | null;
  sourceIdentity: string | null;
}

function isUrlLike(id: string): boolean {
  if (!/^https?:\/\//i.test(id)) return false;
  try {
    new URL(id);
    return true;
  } catch {
    return false;
  }
}

export async function processAsset(
  trx: Kysely<DB>,
  runId: string,
  importerName: string,
  asset: DiscoveredAsset,
  triggeredBy: string | null,
  source: RunSource = { sourceId: null, sourceIdentity: null },
): Promise<{ componentId: string; created: boolean; instancesOrphaned: number }> {
  const { sourceId, sourceIdentity } = source;
  const now = new Date().toISOString();
  const actor = runActor(importerName);

  let component = await trx
    .selectFrom("components")
    .selectAll()
    .where("category", "=", asset.category)
    .where("provider", "=", asset.provider)
    .where("externalId", "=", asset.externalId)
    .executeTakeFirst();

  // Adopt-on-report (ADR-120): an adopting run emitting a source-qualified
  // externalId that misses falls back to the pre-migration legacy form and
  // adopts that row — rewriting its externalId to the qualified form —
  // unless another Source already holds an active membership on it. Rows
  // never re-reported keep their legacy externalId and provenance.
  if (!component && sourceId && sourceIdentity) {
    const legacyId = unqualifyExternalId(asset.externalId, sourceIdentity);
    // Adoption is provenance-scoped (ADR-120 A2 §6): only rows last seen
    // by runs of THIS config may adopt — a provider-wide match could
    // steal another system's row on an id collision (e.g. GHES repo #42
    // adopting a github.com row). No config provenance → no adoption.
    const runConfigId =
      (
        await trx
          .selectFrom("import_runs")
          .select("configId")
          .where("id", "=", runId)
          .executeTakeFirst()
      )?.configId ?? null;
    const configRunIds = trx
      .selectFrom("import_runs")
      .select("id")
      .where("configId", "=", runConfigId);
    let legacy;
    if (legacyId !== null && runConfigId !== null) {
      legacy = await trx
        .selectFrom("components")
        .selectAll()
        .where("category", "=", asset.category)
        .where("provider", "=", asset.provider)
        .where("externalId", "=", legacyId)
        .where("lastSeenInRunId", "in", configRunIds)
        .executeTakeFirst();
    }
    // Canonical fallback (ADR-120): pre-migration rows may hold a raw URL
    // spelling (userinfo/auth params/trailing-slash drift) that canonical
    // emits no longer equal. Two bounded cases:
    //  (a) bare-URL emits (legacyId null) → compare canonicalized stored id;
    //  (b) qualified emits whose localId embeds an endpoint (legacyId
    //      contains "://") → canonicalize the stored id's URL-ish prefix.
    if (!legacy && runConfigId !== null) {
      const target =
        legacyId === null && isUrlLike(asset.externalId)
          ? asset.externalId
          : legacyId !== null && legacyId.includes("://")
            ? legacyId
            : null;
      if (target) {
        const candidates = await trx
          .selectFrom("components")
          .selectAll()
          .where("category", "=", asset.category)
          .where("provider", "=", asset.provider)
          .where("lastSeenInRunId", "in", configRunIds)
          .execute();
        legacy = candidates.find((c) => {
          if (typeof c.externalId !== "string") return false;
          if (canonicalizeSourceIdentity(c.externalId) === target) return true;
          const i = c.externalId.lastIndexOf(":");
          if (i === -1) return false;
          const prefix = c.externalId.slice(0, i);
          const canonPrefix = canonicalizeSourceIdentity(prefix);
          return (
            canonPrefix !== prefix &&
            `${canonPrefix}${c.externalId.slice(i)}` === target
          );
        });
      }
    }
    if (legacy) {
        // Effective-active union (ADR-119 A1): a foreign membership only
        // blocks adoption while its Source is ACTIVE or UNMONITORED — a
        // RETIRED source's membership no longer defends the row.
        const foreignActive = await trx
          .selectFrom("source_component_memberships")
          .leftJoin(
            "importer_sources",
            "importer_sources.id",
            "source_component_memberships.sourceId",
          )
          .select("source_component_memberships.id")
          .where("source_component_memberships.componentId", "=", legacy.id)
          .where("source_component_memberships.sourceId", "!=", sourceId)
          .where("source_component_memberships.active", "=", true)
          .where("importer_sources.status", "in", ["ACTIVE", "UNMONITORED"])
          .executeTakeFirst();
        if (!foreignActive) {
          await trx
            .updateTable("components")
            .set({ externalId: asset.externalId, updatedAt: now })
            .where("id", "=", legacy.id)
            .execute();
          await writeEntityChange(
            {
              entityType: "component",
              entityId: legacy.id,
              action: "update",
              changes: {
                externalId: asset.externalId,
                previousExternalId: legacy.externalId,
                reason: "adopt-on-report",
              },
              importRunId: runId,
              actor,
            },
            trx,
          );
          component = legacy;
        }
    }
  }

  let componentId: string;
  let componentSlug: string;
  let created: boolean;

  if (component) {
    componentId = component.id;
    componentSlug = component.slug;
    created = false;
    const reactivating = component.lifecycle === "RETIRED";
    await trx
      .updateTable("components")
      .set({
        name: asset.name,
        resourceType: asset.resourceType,
        details: asset.details ?? null,
        lifecycle: "ACTIVE",
        lastSeenAt: now,
        lastSeenInRunId: runId,
        updatedAt: now,
      })
      .where("id", "=", componentId)
      .execute();

    if (reactivating) {
      await writeEntityChange(
        {
          entityType: "component",
          entityId: componentId,
          action: "lifecycle",
          changes: { lifecycle: "ACTIVE", previousLifecycle: component.lifecycle },
          importRunId: runId,
          actor,
        },
        trx,
      );
    }
  } else {
    componentId = uuidv7();
    const baseSlug = asset.slug ?? generateComponentSlug(asset.name, asset.externalId);
    componentSlug = await ensureUniqueComponentSlug(trx, baseSlug);
    await trx
      .insertInto("components")
      .values({
        id: componentId,
        name: asset.name,
        slug: componentSlug,
        category: asset.category,
        provider: asset.provider,
        resourceType: asset.resourceType,
        lifecycle: "ACTIVE",
        externalId: asset.externalId,
        details: asset.details ?? null,
        lastSeenAt: now,
        lastSeenInRunId: runId,
        createdBy: triggeredBy,
        updatedBy: triggeredBy,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    created = true;

    await writeEntityChange(
      {
        entityType: "component",
        entityId: componentId,
        action: "discovered",
        changes: {
          name: asset.name,
          category: asset.category,
          provider: asset.provider,
          resourceType: asset.resourceType,
          externalId: asset.externalId,
        },
        importRunId: runId,
        actor,
      },
      trx,
    );
  }

  // Source membership upsert (ADR-119 #4): adopting runs stamp the durable
  // Source→Component membership; legacy runs (sourceId null) skip it.
  if (sourceId) {
    await upsertComponentMembership(trx, sourceId, componentId, runId, now, asset.sourceDetails ?? null);
  }

  const yieldedInstanceIds = new Set<string>();
  // Instance id → yielded instance, for per-instance sourceDetails on the
  // membership upsert below.
  const yieldedInstanceAssets = new Map<string, DiscoveredAsset["instances"][number]>();

  for (const instance of asset.instances) {
    const baseInstanceSlug = generateInstanceSlug(componentSlug, instance.environment, instance.externalId);
    const instanceSlug = await ensureUniqueInstanceSlug(trx, baseInstanceSlug, componentId);

    let existingInstance = await trx
      .selectFrom("component_instances")
      .selectAll()
      .where("componentId", "=", componentId)
      .where("externalId", "=", instance.externalId)
      .executeTakeFirst();

    // Canonical-URL adoption (ADR-120): pre-migration instances stored a
    // raw URL spelling; canonical emits miss. Match by canonicalized
    // stored id within this component and rekey to the canonical form.
    if (!existingInstance && isUrlLike(instance.externalId)) {
      const siblings = await trx
        .selectFrom("component_instances")
        .selectAll()
        .where("componentId", "=", componentId)
        .execute();
      existingInstance = siblings.find(
        (s) => canonicalizeSourceIdentity(s.externalId) === instance.externalId,
      );
      if (existingInstance) {
        await trx
          .updateTable("component_instances")
          .set({ externalId: instance.externalId, updatedAt: now })
          .where("id", "=", existingInstance.id)
          .execute();
        await writeEntityChange(
          {
            entityType: "component_instance",
            entityId: existingInstance.id,
            action: "update",
            changes: {
              externalId: instance.externalId,
              previousExternalId: existingInstance.externalId,
              reason: "adopt-on-report",
            },
            importRunId: runId,
            actor,
          },
          trx,
        );
      }
    }

    const instanceValues = {
      environment: instance.environment,
      url: instance.url ?? null,
      region: instance.region ?? null,
      status: instance.status ?? "RUNNING",
      version: instance.version ?? null,
      deployedAt: instance.deployedAt ?? null,
      rawConfig: instance.rawConfig ?? null,
      slug: instanceSlug,
      lastSeenAt: now,
      lastSeenInRunId: runId,
      updatedAt: now,
    };

    if (existingInstance) {
      yieldedInstanceIds.add(existingInstance.id);
      yieldedInstanceAssets.set(existingInstance.id, instance);
      const statusChanged = existingInstance.status !== (instance.status ?? "RUNNING");
      await trx
        .updateTable("component_instances")
        .set(instanceValues)
        .where("id", "=", existingInstance.id)
        .execute();

      if (statusChanged) {
        await writeEntityChange(
          {
            entityType: "component_instance",
            entityId: existingInstance.id,
            action: "status_change",
            changes: {
              previousStatus: existingInstance.status,
              status: instance.status ?? "RUNNING",
              environment: instance.environment,
            },
            importRunId: runId,
            actor,
          },
          trx,
        );
      }
    } else {
      const instanceId = uuidv7();
      yieldedInstanceIds.add(instanceId);
      yieldedInstanceAssets.set(instanceId, instance);
      await trx
        .insertInto("component_instances")
        .values({
          id: instanceId,
          componentId,
          externalId: instance.externalId,
          ...instanceValues,
          createdBy: triggeredBy,
          createdAt: now,
        })
        .execute();

      await writeEntityChange(
        {
          entityType: "component_instance",
          entityId: instanceId,
          action: "discovered",
          changes: {
            environment: instance.environment,
            status: instance.status ?? "RUNNING",
            componentId,
          },
          importRunId: runId,
          actor,
        },
        trx,
      );
    }
  }

  // Phase 1 reconciliation.
  let instancesOrphaned: number;
  if (sourceId) {
    // Source-scoped (ADR-036 A1): deactivate this Source's instance
    // memberships it did not refresh on this component, then recompute
    // GONE over the effective-active union (active membership on a
    // non-RETIRED source). Manually-created instances carry no
    // memberships and are never touched.
    for (const instanceId of yieldedInstanceIds) {
      await upsertInstanceMembership(trx, sourceId, instanceId, runId, now, yieldedInstanceAssets.get(instanceId)?.sourceDetails ?? null);
    }

    const staleMemberships = await trx
      .updateTable("source_instance_memberships")
      .set({ active: false, updatedAt: now })
      .where("sourceId", "=", sourceId)
      .where("active", "=", true)
      .where("lastSeenInRunId", "!=", runId)
      .where(
        "componentInstanceId",
        "in",
        trx
          .selectFrom("component_instances")
          .select("id")
          .where("componentId", "=", componentId),
      )
      .returning("componentInstanceId")
      .execute();

    instancesOrphaned = await markOrphanedInstancesGone(
      trx,
      staleMemberships.map((m) => m.componentInstanceId),
      now,
    );
  } else {
    // Legacy path (non-adopting importers — byte-identical behavior):
    // orphan instances for this component not seen this run.
    const orphanResult = await trx
      .updateTable("component_instances")
      .set({ status: "GONE", updatedAt: now })
      .where("componentId", "=", componentId)
      .where("lastSeenInRunId", "!=", runId)
      .executeTakeFirst();
    instancesOrphaned = Number(orphanResult.numUpdatedRows ?? 0);
  }

  return { componentId, created, instancesOrphaned };
}

/** Upsert the durable Source→Component membership for an adopting run.
 *  `details` carries the asset's per-source facts (ADR-120, spec 045
 *  FR-005) — refreshed on every report, null when the asset supplies
 *  none. */
async function upsertComponentMembership(
  trx: Kysely<DB>,
  sourceId: string,
  componentId: string,
  runId: string,
  now: string,
  details: Record<string, unknown> | null = null,
): Promise<void> {
  await trx
    .insertInto("source_component_memberships")
    .values({
      id: uuidv7(),
      sourceId,
      componentId,
      active: true,
      details,
      firstSeenInRunId: runId,
      lastSeenInRunId: runId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflict((oc) =>
      oc.columns(["sourceId", "componentId"]).doUpdateSet({
        active: true,
        details,
        lastSeenInRunId: runId,
        updatedAt: now,
      }),
    )
    .execute();
}

/** Upsert the durable Source→ComponentInstance membership. */
async function upsertInstanceMembership(
  trx: Kysely<DB>,
  sourceId: string,
  componentInstanceId: string,
  runId: string,
  now: string,
  details: Record<string, unknown> | null = null,
): Promise<void> {
  await trx
    .insertInto("source_instance_memberships")
    .values({
      id: uuidv7(),
      sourceId,
      componentInstanceId,
      active: true,
      details,
      firstSeenInRunId: runId,
      lastSeenInRunId: runId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflict((oc) =>
      oc.columns(["sourceId", "componentInstanceId"]).doUpdateSet({
        active: true,
        details,
        lastSeenInRunId: runId,
        updatedAt: now,
      }),
    )
    .execute();
}


export async function reconcileRetiredComponents(
  runId: string,
  importerName: string,
  configId: string,
  yieldedComponentIds: Set<string>,
  sourceId: string | null = null,
): Promise<number> {
  const now = new Date().toISOString();
  const actor = runActor(importerName);

  // Source-scoped reconciliation (ADR-036 A1, spec 044): the reporting
  // Source's durable memberships are the reconciliation unit. Runs still
  // carry LEGACY_UNATTRIBUTED provenance (sourceId null) keep the
  // config-scoped path byte-identical.
  if (sourceId) {
    return db.transaction().execute(async (trx) => {
      // Deactivate this Source's memberships it did not refresh this run —
      // including an empty inventory, which deactivates all of them.
      const staleComponentMemberships = await trx
        .updateTable("source_component_memberships")
        .set({ active: false, updatedAt: now })
        .where("sourceId", "=", sourceId)
        .where("active", "=", true)
        .where("lastSeenInRunId", "!=", runId)
        .returning("componentId")
        .execute();

      const staleInstanceMemberships = await trx
        .updateTable("source_instance_memberships")
        .set({ active: false, updatedAt: now })
        .where("sourceId", "=", sourceId)
        .where("active", "=", true)
        .where("lastSeenInRunId", "!=", runId)
        .returning("componentInstanceId")
        .execute();

      // GONE applies only when no effective-active membership remains.
      const orphaned = await markOrphanedInstancesGone(
        trx,
        staleInstanceMemberships.map((m) => m.componentInstanceId),
        now,
      );
      if (orphaned > 0) {
        await trx
          .updateTable("import_runs")
          .set((eb) => ({ instancesOrphaned: eb("instancesOrphaned", "+", orphaned) }))
          .where("id", "=", runId)
          .execute();
      }

      // RETIRED applies only when no effective-active membership remains —
      // entities nobody ever reported have no memberships and are never
      // reconciled by a source run.
      let retired = 0;
      for (const stale of staleComponentMemberships) {
        const stillReported = await hasEffectiveActiveComponentMembership(
          trx,
          stale.componentId,
        );
        if (stillReported) continue;

        const updated = await trx
          .updateTable("components")
          .set({ lifecycle: "RETIRED", updatedAt: now })
          .where("id", "=", stale.componentId)
          .where("lifecycle", "=", "ACTIVE")
          .returning(["id", "name", "slug"])
          .executeTakeFirst();
        if (!updated) continue;
        retired++;

        await trx
          .updateTable("component_instances")
          .set({ status: "GONE", updatedAt: now })
          .where("componentId", "=", updated.id)
          .where("status", "!=", "GONE")
          .execute();

        await writeEntityChange(
          {
            entityType: "component",
            entityId: updated.id,
            action: "retired",
            changes: { lifecycle: "RETIRED", name: updated.name, slug: updated.slug },
            importRunId: runId,
            actor,
          },
          trx,
        );
      }

      return retired;
    });
  }

  // Legacy path — unchanged for non-adopting importers (FR-013).
  if (yieldedComponentIds.size === 0) {
    return 0;
  }

  return db.transaction().execute(async (trx) => {
    const toRetire = await trx
      .selectFrom("components")
      .select(["id", "name", "slug"])
      .where("lifecycle", "=", "ACTIVE")
      .where(
        "lastSeenInRunId",
        "in",
        (eb) => eb.selectFrom("import_runs").select("id").where("configId", "=", configId),
      )
      .where("id", "not in", Array.from(yieldedComponentIds))
      .execute();

    if (toRetire.length === 0) {
      return 0;
    }

    const ids = toRetire.map((c) => c.id);
    await trx
      .updateTable("components")
      .set({ lifecycle: "RETIRED", updatedAt: now })
      .where("id", "in", ids)
      .execute();

    await trx
      .updateTable("component_instances")
      .set({ status: "GONE", updatedAt: now })
      .where("status", "!=", "GONE")
      .where("componentId", "in", ids)
      .execute();

    for (const component of toRetire) {
      await writeEntityChange(
        {
          entityType: "component",
          entityId: component.id,
          action: "retired",
          changes: { lifecycle: "RETIRED", name: component.name, slug: component.slug },
          importRunId: runId,
          actor,
        },
        trx,
      );
    }

    return toRetire.length;
  });
}

async function worker(runId: string): Promise<void> {
  const controller = new AbortController();
  runningControllers.set(runId, controller);

  let terminalStatus: "COMPLETED" | "FAILED" | "CANCELLED" = "FAILED";
  let importerName: string | undefined;
  let startTime = Date.now();

  try {
    const run = await db
      .selectFrom("import_runs")
      .selectAll()
      .where("id", "=", runId)
      .executeTakeFirst();

    if (!run) {
      return;
    }

    if (run.status !== "PENDING") {
      return;
    }

    if (run.cancelRequestedAt) {
      terminalStatus = "CANCELLED";
      await updateRun(runId, {
        status: terminalStatus,
        completedAt: new Date().toISOString(),
        currentPhase: "Cancelled before start",
      });
      return;
    }

    const config = await db
      .selectFrom("importer_configs")
      .selectAll()
      .where("id", "=", run.configId)
      .executeTakeFirst();

    if (!config) {
      throw Object.assign(new Error("Importer config not found"), {
        code: "CONFIG_NOT_FOUND",
      });
    }

    importerName = config.importerName;
    if (!importerName) {
      throw Object.assign(new Error("Importer name missing from config"), {
        code: "CONFIG_NOT_FOUND",
      });
    }
    startTime = Date.now();

    const now = new Date().toISOString();
    await updateRun(runId, {
      status: "RUNNING",
      startedAt: now,
      currentPhase: "Initializing",
    });

    // Resolve the config's secrets: stored credentials (junction-linked)
    // merged with any legacy env/file refs (deprecation window). Collisions,
    // revoked/missing credentials, and uncovered required keys fail fast —
    // before the importer starts (spec 013 FR-007/008/009/010).
    const runLogger = createRunLogger(runId);
    const junctionRows = await db
      .selectFrom("importer_config_credentials")
      .select("credentialId")
      .where("configId", "=", config.id)
      .execute();
    const keyring = await loadKeyring();
    const resolution = await resolveImportSecrets(
      { secretRefs: config.secretRefs, credentialIds: junctionRows.map((r) => r.credentialId) },
      {
        keyring,
        loadCredential: async (credentialId): Promise<CredentialRecord | null> => {
          const row = await db
            .selectFrom("credentials")
            .select(["id", "label", "status", "kind", "encryptedPayload", "keyVersion", "expiresAt"])
            .where("id", "=", credentialId)
            .executeTakeFirst();
          return row ?? null;
        },
      },
    );

    const manifest = await getManifest(config.importerName);
    assertRequiredSecrets(resolution.secrets, manifest.secrets ?? [], resolution.credentialLabels);

    const secrets = resolution.secrets;
    if (resolution.credentialIds.length > 0) {
      await updateRun(runId, {
        credentialIds: JSON.stringify(resolution.credentialIds) as unknown as string[],
      });
      await db
        .updateTable("credentials")
        .set({ lastUsedAt: new Date().toISOString() })
        .where("id", "in", resolution.credentialIds)
        .execute();
    }
    for (const warning of resolution.warnings) {
      runLogger.warn(warning);
    }
    if (resolution.legacyRefsUsed) {
      runLogger.warn("Importer config uses deprecated env/file secret refs — migrate to stored credentials");
    }

    const importer = await getImporter(config.importerName);

    const reportPhase = async (name: string) => {
      if (controller.signal.aborted) return;
      await updateRun(runId, { currentPhase: name });
    };

    let reportedSourceId: string | null = null;
    // Canonical identity as registered — drives adopt-on-report legacy
    // matching in processAsset (ADR-120).
    let reportedSourceIdentity: string | null = null;
    // Stored so an importer that forgets to await its report still has the
    // registration complete before the ordering check (unawaited-report race).
    let sourceReportPromise: Promise<void> | null = null;

    const context = {
      runId,
      logger: runLogger,
      signal: controller.signal,
      reportPhase,
      tracer: NOOP_TRACER,
      reportSourceIdentity: (identity: { externalIdentity: string; label?: string }) => {
        // Non-adopting manifests stay on the legacy config-scoped path
        // (FR-013) — a stray report must not flip the run's reconciliation.
        if (manifest.reportsSourceIdentity !== true) {
          runLogger.warn("source identity report from a non-adopting importer — ignoring");
          return;
        }
        if (reportedSourceId || sourceReportPromise) {
          runLogger.warn("source identity already reported for this run — ignoring subsequent report");
          return sourceReportPromise ?? undefined;
        }
        sourceReportPromise = (async () => {
          reportedSourceId = await recordRunSourceIdentity(
            importerName!,
            identity,
            runId,
            config.id,
            runActor(importerName!),
          );
          reportedSourceIdentity = canonicalizeSourceIdentity(identity.externalIdentity);
        })();
        // Keep the rejection observable if the run aborts before the
        // ordering checks get a chance to await it.
        sourceReportPromise.catch((err) =>
          runLogger.warn(`source identity registration failed: ${err}`),
        );
        return sourceReportPromise;
      },
      // Target profiles resolve only on Import Agents (ADR-116 A5) —
      // in-process runs get the failing stub.
      resolveTarget: (): unknown => {
        throw new Error("resolveTarget is only available on Import Agents");
      },
    };

    const yieldedComponentIds = new Set<string>();
    let assetsProcessed = 0;
    let assetsCreated = 0;
    let assetsUpdated = 0;
    let instancesOrphaned = 0;
    let componentsRetired = 0;

    for await (const asset of importer.run(config.scope as Record<string, unknown>, secrets, context)) {
      if (controller.signal.aborted) {
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });
      }

      // Adopting importers must report source identity before the first
      // yield (ADR-056 A1/A2) — an asset arriving first is a contract
      // violation, not a partial import. Await an in-flight report so an
      // importer that forgot `await` isn't falsely flagged.
      if (sourceReportPromise) await sourceReportPromise;
      if (manifest.reportsSourceIdentity && !reportedSourceId) {
        throw Object.assign(
          new Error("Importer yielded an asset before reporting its source identity"),
          { code: "CONTRACT_VIOLATION" },
        );
      }

      const validation = validateDiscoveredAssetDetailed(asset);
      if (!validation.valid) {
        await insertRunError(runId, asset.externalId, "VALIDATION_FAILED", validation.errors?.join("; ") ?? "Validation failed");
        metrics.importRunErrorsTotal.inc({ importer: importerName, errorType: "VALIDATION_FAILED" });
        assetsProcessed++;
        await updateRun(runId, { assetsProcessed });
        continue;
      }

      const result = await traceDbQuery("processAsset", () =>
        db.transaction().execute(async (trx) => processAsset(trx, runId, importerName!, asset, run.triggeredBy, { sourceId: reportedSourceId, sourceIdentity: reportedSourceIdentity })),
      );

      yieldedComponentIds.add(result.componentId);
      assetsProcessed++;
      assetsCreated += result.created ? 1 : 0;
      assetsUpdated += result.created ? 0 : 1;
      instancesOrphaned += result.instancesOrphaned;

      metrics.importRunAssetsYieldedTotal.inc({ importer: importerName });

      await updateRun(runId, {
        assetsProcessed,
        assetsCreated,
        assetsUpdated,
        instancesOrphaned,
      });
    }

    const cancelCheck = await db
      .selectFrom("import_runs")
      .select("cancelRequestedAt")
      .where("id", "=", runId)
      .executeTakeFirst();

    if (controller.signal.aborted || cancelCheck?.cancelRequestedAt) {
      terminalStatus = "CANCELLED";
      await updateRun(runId, {
        status: terminalStatus,
        completedAt: new Date().toISOString(),
        currentPhase: "Cancelled",
      });
      return;
    }

    // An adopting importer that finished without ever reporting identity
    // fails the run — "reachable but empty" must still register the Source.
    if (sourceReportPromise) await sourceReportPromise;
    if (manifest.reportsSourceIdentity && !reportedSourceId) {
      throw Object.assign(
        new Error("Importer completed without reporting its source identity"),
        { code: "CONTRACT_VIOLATION" },
      );
    }

    const now2 = new Date().toISOString();
    componentsRetired = await reconcileRetiredComponents(runId, importerName!, config.id, yieldedComponentIds, reportedSourceId);

    terminalStatus = "COMPLETED";
    await updateRun(runId, {
      status: terminalStatus,
      completedAt: now2,
      currentPhase: "Completed",
      assetsProcessed,
      assetsCreated,
      assetsUpdated,
      instancesOrphaned,
      componentsRetired,
    });

    // ADR-113: stage edge suggestions for the components this run touched.
    // Failure-isolated — a suggestion bug must never flip a completed run.
    const suggestionReport = await runSuggestionPass(
      { componentIds: [...yieldedComponentIds] },
      { runId },
    );
    if (suggestionReport) {
      appLogger.info(
        { runId, ...suggestionReport },
        "edge suggestions staged after import run",
      );
    }
  } catch (err) {
    if (isAbortError(err)) {
      terminalStatus = "CANCELLED";
      await updateRun(runId, {
        status: terminalStatus,
        completedAt: new Date().toISOString(),
        currentPhase: "Cancelled",
      });
      return;
    }

    const error = err instanceof Error ? err : new Error(String(err));
    const debug = process.env.DEBUG_ERROR_DETAILS === "true";
    terminalStatus = "FAILED";
    const errorType = (error as { code?: string }).code ?? "RUNTIME_ERROR";
    await updateRun(runId, {
      status: terminalStatus,
      completedAt: new Date().toISOString(),
      currentPhase: "Failed",
      errorMessage: error.message,
      errorType,
      errorStack: debug ? error.stack ?? null : null,
    });

    if (importerName) {
      metrics.importRunErrorsTotal.inc({ importer: importerName, errorType });
    }
  } finally {
    runningControllers.delete(runId);

    if (importerName) {
      const durationSeconds = (Date.now() - startTime) / 1000;
      metrics.importRunDurationSeconds.observe({ importer: importerName }, durationSeconds);
      metrics.importRunsTotal.inc({ importer: importerName, status: terminalStatus });
    }
  }
}

export async function startRun(
  configId: string,
  triggeredBy: string | null,
): Promise<{ runId: string }> {
  const runId = uuidv7();
  const now = new Date().toISOString();

  const config = await db
    .selectFrom("importer_configs")
    .select(["id", "agentId"])
    .where("id", "=", configId)
    .executeTakeFirst();
  const agentId = config?.agentId ?? null;

  await db
    .transaction()
    .execute(async (trx) => {
      const existing = await trx
        .selectFrom("import_runs")
        .select("id")
        .where("configId", "=", configId)
        .where("status", "in", ["PENDING", "RUNNING"])
        .forUpdate()
        .executeTakeFirst();

      if (existing) {
        throw Object.assign(new Error("An import run is already in progress for this config"), {
          statusCode: 409,
          code: "RUN_IN_PROGRESS",
        });
      }

      await trx
        .insertInto("import_runs")
        .values({
          id: runId,
          configId,
          agentId,
          status: "PENDING",
          triggeredBy,
          assetsProcessed: 0,
          assetsCreated: 0,
          assetsUpdated: 0,
          instancesOrphaned: 0,
          componentsRetired: 0,
          createdAt: now,
        })
        .execute();
    });

  // Agent-bound configs dispatch over the agent stream; everything else
  // keeps the in-process worker path unchanged. Fail closed when the
  // dispatcher isn't wired — a bound run must never execute in-process
  // (AGENT_MANAGED refs can't resolve hub-side).
  if (agentId) {
    if (!remoteDispatcher) {
      // Finalize the committed row — a PENDING orphan would block every
      // future run for the config and can never resolve on its own.
      await updateRun(runId, {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        currentPhase: "Failed",
        errorType: "AGENT_UNAVAILABLE",
        errorMessage: "Remote run dispatcher is not available",
      });
      throw Object.assign(new Error("Remote run dispatcher is not available"), {
        statusCode: 503,
        code: "AGENT_UNAVAILABLE",
      });
    }
    await remoteDispatcher.enqueue(runId);
  } else {
    queue.add(() => worker(runId));
  }

  return { runId };
}

export async function cancelRun(runId: string): Promise<void> {
  const now = new Date().toISOString();

  await db
    .updateTable("import_runs")
    .set({ cancelRequestedAt: now })
    .where("id", "=", runId)
    .execute();

  const run = await db
    .selectFrom("import_runs")
    .select("agentId")
    .where("id", "=", runId)
    .executeTakeFirst();

  if (run?.agentId && remoteDispatcher) {
    await remoteDispatcher.cancelRemoteRun(runId);
    return;
  }

  const controller = runningControllers.get(runId);
  if (controller) {
    controller.abort();
  }
}

// Run payloads carry the executing agent's display name (spec 027 US5).
// Left join tolerates a deleted agent row — history outlives the agent.
export async function getRun(runId: string) {
  return db
    .selectFrom("import_runs")
    .leftJoin("import_agents", "import_agents.id", "import_runs.agentId")
    .selectAll("import_runs")
    .select("import_agents.name as agentName")
    .where("import_runs.id", "=", runId)
    .executeTakeFirst();
}

export async function listRunsForConfig(configId: string) {
  return db
    .selectFrom("import_runs")
    .leftJoin("import_agents", "import_agents.id", "import_runs.agentId")
    .selectAll("import_runs")
    .select("import_agents.name as agentName")
    .where("import_runs.configId", "=", configId)
    .orderBy("import_runs.createdAt", "desc")
    .execute();
}

/**
 * Per-day run aggregates for one importer config over a bounded window
 * (spec 031, gap G1). Buckets by UTC day of createdAt via a parameterized
 * sql-template expression — never sql.raw/fragment (ADR-084). Cost is
 * O(days), not O(run rows); the sparse group-by result is zero-filled so
 * every day in the window appears, ascending.
 */
export async function listRunDayAggregates(configId: string, days: number) {
  const cutoff = new Date(Date.now() - days * 86400000)
    .toISOString()
    .slice(0, 10);

  const rows = await db
    .selectFrom("import_runs")
    .select((eb) => [
      sql<string>`to_char("createdAt", 'YYYY-MM-DD')`.as("day"),
      eb.fn.countAll<number>().as("runs"),
      eb.fn.sum("assetsCreated").as("created"),
      eb.fn.sum("assetsUpdated").as("updated"),
      eb.fn
        .countAll<number>()
        .filterWhere("status", "=", "FAILED")
        .as("failed"),
    ])
    .where("configId", "=", configId)
    .where("createdAt", ">=", cutoff)
    .groupBy(sql`to_char("createdAt", 'YYYY-MM-DD')`)
    .orderBy("day")
    .execute();

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const start = Date.now() - (days - 1) * 86400000;
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(start + i * 86400000).toISOString().slice(0, 10);
    const r = byDay.get(day);
    return {
      day,
      runs: r ? Number(r.runs) : 0,
      created: r ? Number(r.created ?? 0) : 0,
      updated: r ? Number(r.updated ?? 0) : 0,
      failed: r ? Number(r.failed) : 0,
    };
  });
}

export async function listRunErrors(runId: string) {
  return db
    .selectFrom("import_run_errors")
    .selectAll()
    .where("runId", "=", runId)
    .orderBy("createdAt", "desc")
    .execute();
}
