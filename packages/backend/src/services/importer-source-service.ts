import { uuidv7 } from "uuidv7";
import type { Kysely, Selectable, Transaction } from "kysely";
import type {
  ImporterSourceListItem,
  ImporterSourceListQuery,
  Paginated,
  SourceIdentityInput,
} from "@componode/core";
import { canonicalizeSourceIdentity } from "@componode/core";
import type { DB, ImporterSourceRow } from "../db/types.js";
import { db } from "../db/connection.js";
import { paginateQuery, sortTarget, type OrderTarget } from "../utils/pagination.js";

type ImporterSourceSortKey = NonNullable<ImporterSourceListQuery["sort"]>;

/** Sort whitelist mirrors the source list query schema — `name` sorts by
 *  `externalIdentity`; the count/recency keys order by select aliases
 *  (spec 069 / B.3). */
const IMPORTER_SOURCE_SORT_COLUMNS: Record<ImporterSourceSortKey, OrderTarget> = {
  name: "importer_sources.externalIdentity",
  importerName: "importer_sources.importerName",
  status: "importer_sources.status",
  boundConfig: "boundConfigLabel",
  components: "activeComponentMemberships",
  instances: "activeInstanceMemberships",
  lastCompletedRunAt: "lastCompletedRunAt",
  createdAt: "importer_sources.createdAt",
};
import { writeEntityChange, type Actor } from "./audit-service.js";
import { runAutoGroupPass } from "./source-group-service.js";

type DbOrTrx = Kysely<DB> | Transaction<DB>;

/**
 * Registers-or-matches an ImporterSource by `(importerName,
 * externalIdentity)` and binds the reporting config (ADR-119,
 * rebind-on-report). Reactivates UNMONITORED/RETIRED sources — a returning
 * provider identity means the Source is monitored again. Returns the
 * source row.
 */
export async function registerOrMatchSource(
  importerName: string,
  identity: SourceIdentityInput,
  runId: string,
  configId: string | null,
  actor: Actor,
  trx: DbOrTrx = db,
): Promise<Selectable<ImporterSourceRow>> {
  const externalIdentity = canonicalizeSourceIdentity(
    identity.externalIdentity,
  );
  // Same bounds the wire schema enforces — an invalid report is a
  // contract violation on the adopting importer, not a stored record.
  if (
    externalIdentity.length === 0 ||
    externalIdentity.length > 512 ||
    (identity.label !== undefined && identity.label.length > 200)
  ) {
    throw Object.assign(
      new Error("source identity violates the reported-identity bounds"),
      { code: "CONTRACT_VIOLATION" },
    );
  }
  const now = new Date().toISOString();

  // T047: the config may have been deleted between job load and this
  // identity report — a stale id must not fail the run on the FK.
  const configRow = await trx
    .selectFrom("importer_configs")
    .select("id")
    .where("id", "=", configId)
    .executeTakeFirst();
  const boundConfigId = configRow ? configId : null;

  // T044: insert-or-select under the UNIQUE(importerName, externalIdentity)
  // key — a concurrent report must merge onto the same row, not collide.
  const candidateId = uuidv7();
  await trx
    .insertInto("importer_sources")
    .values({
      id: candidateId,
      importerName,
      externalIdentity,
      label: identity.label ?? null,
      status: boundConfigId ? "ACTIVE" : "UNMONITORED",
      boundConfigId,
      firstSeenInRunId: runId,
      lastSeenInRunId: runId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflict((oc) =>
      oc.columns(["importerName", "externalIdentity"]).doNothing(),
    )
    .execute();

  const row = await trx
    .selectFrom("importer_sources")
    .selectAll()
    .where("importerName", "=", importerName)
    .where("externalIdentity", "=", externalIdentity)
    .executeTakeFirstOrThrow();

  if (row.id === candidateId) {
    // Fresh registration — audit `created`.
    await writeEntityChange(
      {
        entityType: "importer_source",
        entityId: row.id,
        action: "created",
        changes: {
          importerName,
          externalIdentity,
          label: identity.label ?? null,
          boundConfigId,
        },
        importRunId: runId,
        actor,
      },
      trx,
    );
  }

  // Re-match (ADR-119): refresh identity + bind + reactivate. Status
  // follows the binding — a Source reported by a just-deleted config is
  // UNMONITORED, not ACTIVE. Each guarded UPDATE returns rows only on a
  // real transition, so concurrent reports can't double-emit audit events.
  const nextStatus = boundConfigId ? "ACTIVE" : "UNMONITORED";
  const boundRows = await trx
    .updateTable("importer_sources")
    .set({ boundConfigId })
    .where("id", "=", row.id)
    .where((eb) =>
      boundConfigId === null
        ? eb("boundConfigId", "is not", null)
        : eb.or([
            eb("boundConfigId", "is", null),
            eb("boundConfigId", "!=", boundConfigId),
          ]),
    )
    .returning("id")
    .execute();
  const boundChanged = boundRows.length > 0;

  const statusRows = await trx
    .updateTable("importer_sources")
    .set({ status: nextStatus })
    .where("id", "=", row.id)
    .where("status", "!=", nextStatus)
    .returning("id")
    .execute();
  const statusChanged = statusRows.length > 0;
  const reactivated = statusChanged && nextStatus === "ACTIVE";

  const updates: Record<string, unknown> = {
    lastSeenInRunId: runId,
    updatedAt: now,
  };
  if (identity.label && identity.label !== row.label) {
    updates.label = identity.label;
  }
  await trx
    .updateTable("importer_sources")
    .set(updates)
    .where("id", "=", row.id)
    .execute();

  // A config reports exactly one identity — re-pointing it at a
  // different system must unbind the previously bound Source
  // (ADR-119 #3): it goes UNMONITORED and loses the binding, or two
  // Sources would appear bound to one config.
  if (boundConfigId !== null) {
    const stale = await trx
      .selectFrom("importer_sources")
      .select(["id", "status"])
      .where("boundConfigId", "=", boundConfigId)
      .where("id", "!=", row.id)
      .execute();
    for (const staleSource of stale) {
      // Always clear the binding — a config reports exactly one identity,
      // so a stale bound pointer is wrong regardless of status. Only a
      // non-RETIRED Source flips to UNMONITORED; a retired one stays.
      await trx
        .updateTable("importer_sources")
        .set({
          boundConfigId: null,
          ...(staleSource.status === "RETIRED" ? {} : { status: "UNMONITORED" }),
          updatedAt: now,
        })
        .where("id", "=", staleSource.id)
        .execute();
      await writeEntityChange(
        {
          entityType: "importer_source",
          entityId: staleSource.id,
          action: "unbound",
          changes: {
            configId: boundConfigId,
            reason: "config rebound to a different source identity",
          },
          importRunId: runId,
          actor,
        },
        trx,
      );
    }
  }

  if (boundChanged && boundConfigId !== null) {
    await writeEntityChange(
      {
        entityType: "importer_source",
        entityId: row.id,
        action: "bound",
        changes: { boundConfigId, previousBoundConfigId: row.boundConfigId },
        importRunId: runId,
        actor,
      },
      trx,
    );
  }
  if (statusChanged) {
    await writeEntityChange(
      {
        entityType: "importer_source",
        entityId: row.id,
        action: reactivated ? "reactivated" : "unmonitored",
        changes: { status: nextStatus, previousStatus: row.status, via: "report" },
        importRunId: runId,
        actor,
      },
      trx,
    );
  }
  return trx
    .selectFrom("importer_sources")
    .selectAll()
    .where("id", "=", row.id)
    .executeTakeFirstOrThrow();
}

/** Stamps durable source attribution on the run row (ADR-119 #5). */
export async function stampRunSource(
  runId: string,
  sourceId: string,
  trx: DbOrTrx = db,
): Promise<void> {
  await trx
    .updateTable("import_runs")
    .set({ sourceId })
    .where("id", "=", runId)
    .execute();
}

/**
 * The shared identity-report write used by both run paths (in-process
 * worker + remote store): register-or-match the Source, bind the config,
 * and stamp `import_runs.sourceId` in one transaction.
 */
export async function recordRunSourceIdentity(
  importerName: string,
  identity: SourceIdentityInput,
  runId: string,
  configId: string,
  actor: Actor,
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const source = await registerOrMatchSource(
      importerName,
      identity,
      runId,
      configId,
      actor,
      trx,
    );
    await stampRunSource(runId, source.id, trx);
    return source.id;
  });
}

/**
 * Config deletion transition: the Source goes UNMONITORED — never deleted,
 * never retired (ADR-047 A1). Call inside the deleting transaction BEFORE
 * the config row is removed (boundConfigId is SET NULL by the FK).
 */
export async function unmonitorSourcesForConfig(
  configId: string,
  actor: Actor,
  trx: DbOrTrx = db,
): Promise<void> {
  const bound = await trx
    .selectFrom("importer_sources")
    .select(["id", "status"])
    .where("boundConfigId", "=", configId)
    .execute();
  if (bound.length === 0) return;

  const now = new Date().toISOString();
  for (const source of bound) {
    if (source.status === "RETIRED") continue;
    await trx
      .updateTable("importer_sources")
      .set({ status: "UNMONITORED", updatedAt: now })
      .where("id", "=", source.id)
      .execute();
    await writeEntityChange(
      {
        entityType: "importer_source",
        entityId: source.id,
        action: "unmonitored",
        changes: { configId },
        actor,
      },
      trx,
    );
  }
}

// ---------------------------------------------------------------------------
// Read surface + lifecycle operations (spec 044 US3, contracts/source-api.md)
// ---------------------------------------------------------------------------



/**
 * List Sources with bound-config summary + activity rollups (spec 068 /
 * ADR-130): page/pageSize/sort/order/search + status/importerName filters.
 * `name` sorts by the provider-native `externalIdentity`; `lastCompletedRunAt`
 * is the max `completedAt` over the Source's COMPLETED runs, computed as a
 * correlated subquery so the same expression serves display and sorting.
 * Membership counts are scoped to the page's ids.
 */
export async function listSources(
  query: ImporterSourceListQuery,
): Promise<Paginated<ImporterSourceListItem>> {
  let q = db
    .selectFrom("importer_sources")
    .leftJoin(
      "importer_configs",
      "importer_configs.id",
      "importer_sources.boundConfigId",
    )
    .selectAll("importer_sources")
    .select([
      "importer_configs.id as boundConfigIdJoined",
      "importer_configs.label as boundConfigLabel",
    ])
    .select((eb) => [
      eb
        .selectFrom("import_runs")
        .select((eb2) => eb2.fn.max("completedAt").as("m"))
        .whereRef("import_runs.sourceId", "=", "importer_sources.id")
        .where("import_runs.status", "=", "COMPLETED")
        .as("lastCompletedRunAt"),
      // FR-005: the active-membership counts are the same correlated
      // subqueries the row exposes — they can drive the `components` /
      // `instances` sorts instead of the page-scoped grouped reads.
      eb
        .selectFrom("source_component_memberships")
        .select((eb2) => eb2.fn.countAll().as("c"))
        .whereRef("source_component_memberships.sourceId", "=", "importer_sources.id")
        .where("active", "=", true)
        .as("activeComponentMemberships"),
      eb
        .selectFrom("source_instance_memberships")
        .select((eb2) => eb2.fn.countAll().as("c"))
        .whereRef("source_instance_memberships.sourceId", "=", "importer_sources.id")
        .where("active", "=", true)
        .as("activeInstanceMemberships"),
      // Spec 070: the source's OWN auto group (autoGroupKey IS NULL) —
      // app groups surface through /component-groups instead.
      eb
        .selectFrom("component_groups")
        .select("component_groups.id")
        .whereRef("component_groups.autoSourceId", "=", "importer_sources.id")
        .where("component_groups.autoGroupKey", "is", null)
        .limit(1)
        .as("componentGroupId"),
    ]);

  if (query.status) {
    q = q.where("importer_sources.status", "=", query.status);
  }
  if (query.importerName) {
    q = q.where("importer_sources.importerName", "=", query.importerName);
  }
  if (query.search) {
    const term = `%${query.search}%`;
    q = q.where((eb) =>
      eb.or([
        eb("importer_sources.externalIdentity", "ilike", term),
        eb("importer_sources.label", "ilike", term),
      ]),
    );
  }

  const { data: rows, pagination } = await paginateQuery(
    q,
    { page: query.page, pageSize: query.pageSize },
    {
      orderBy: (qb) =>
        // Deterministic tie-break (ADR-130).
        qb.orderBy(
          sortTarget(IMPORTER_SOURCE_SORT_COLUMNS, query.sort, IMPORTER_SOURCE_SORT_COLUMNS.name),
          query.order,
        ).orderBy("importer_sources.id", query.order),
    },
  );

  return {
    data: rows.map((r) => ({
      id: r.id,
      importerName: r.importerName,
      externalIdentity: r.externalIdentity,
      label: r.label,
      status: r.status as ImporterSourceListItem["status"],
      boundConfigId: r.boundConfigId,
      componentGroupId: r.componentGroupId,
      firstSeenInRunId: r.firstSeenInRunId,
      lastSeenInRunId: r.lastSeenInRunId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      boundConfig: r.boundConfigIdJoined
        ? { id: r.boundConfigIdJoined, label: r.boundConfigLabel! }
        : null,
      lastCompletedRunAt: r.lastCompletedRunAt ?? null,
      activeComponentMemberships: Number(r.activeComponentMemberships ?? 0),
      activeInstanceMemberships: Number(r.activeInstanceMemberships ?? 0),
    })),
    pagination,
  };
}

export async function getSource(id: string) {
  const r = await db
    .selectFrom("importer_sources")
    .leftJoin(
      "importer_configs",
      "importer_configs.id",
      "importer_sources.boundConfigId",
    )
    .selectAll("importer_sources")
    .select(["importer_configs.label as boundConfigLabel"])
    .select((eb) =>
      eb
        .selectFrom("component_groups")
        .select("component_groups.id")
        .whereRef("component_groups.autoSourceId", "=", "importer_sources.id")
        .where("component_groups.autoGroupKey", "is", null)
        .limit(1)
        .as("componentGroupId"),
    )
    .where("importer_sources.id", "=", id)
    .executeTakeFirst();
  if (!r) return null;

  const lastRun = await db
    .selectFrom("import_runs")
    .select((eb) => eb.fn.max("completedAt").as("lastCompletedRunAt"))
    .where("sourceId", "=", id)
    .where("status", "=", "COMPLETED")
    .executeTakeFirst();
  const compCount = await db
    .selectFrom("source_component_memberships")
    .select((eb) => eb.fn.countAll().as("n"))
    .where("sourceId", "=", id)
    .where("active", "=", true)
    .executeTakeFirst();
  const instCount = await db
    .selectFrom("source_instance_memberships")
    .select((eb) => eb.fn.countAll().as("n"))
    .where("sourceId", "=", id)
    .where("active", "=", true)
    .executeTakeFirst();

  const { boundConfigLabel, ...row } = r;
  return {
    ...row,
    boundConfig: r.boundConfigId
      ? { id: r.boundConfigId, label: boundConfigLabel! }
      : null,
    lastCompletedRunAt: lastRun?.lastCompletedRunAt ?? null,
    activeComponentMemberships: Number(compCount?.n ?? 0),
    activeInstanceMemberships: Number(instCount?.n ?? 0),
  };
}

/**
 * Source→Component and Source→ComponentInstance memberships with their
 * per-source `details` (spec 045 US3 — what each source reported).
 */
export async function listSourceMemberships(sourceId: string) {
  const components = await db
    .selectFrom("source_component_memberships")
    .leftJoin(
      "components",
      "components.id",
      "source_component_memberships.componentId",
    )
    .selectAll("source_component_memberships")
    .select([
      "components.name as componentName",
      "components.externalId as componentExternalId",
    ])
    .where("sourceId", "=", sourceId)
    .orderBy("source_component_memberships.createdAt", "asc")
    .orderBy("source_component_memberships.id", "asc")
    .limit(201)
    .execute();

  const instances = await db
    .selectFrom("source_instance_memberships")
    .leftJoin(
      "component_instances",
      "component_instances.id",
      "source_instance_memberships.componentInstanceId",
    )
    .selectAll("source_instance_memberships")
    .select([
      "component_instances.externalId as instanceExternalId",
      "component_instances.componentId as componentId",
    ])
    .where("sourceId", "=", sourceId)
    .orderBy("source_instance_memberships.createdAt", "asc")
    .orderBy("source_instance_memberships.id", "asc")
    .limit(201)
    .execute();

  return {
    components: components.slice(0, 200),
    instances: instances.slice(0, 200),
    truncated: components.length > 200 || instances.length > 200,
  };
}

/** Run history for the Source — survives config deletion (configId null). */
export async function listSourceRuns(sourceId: string) {
  return db
    .selectFrom("import_runs")
    .selectAll()
    .where("sourceId", "=", sourceId)
    .orderBy("createdAt", "desc")
    .limit(200)
    .execute();
}

function notFound(): never {
  throw Object.assign(new Error("Importer source not found"), {
    statusCode: 404,
    code: "SOURCE_NOT_FOUND",
  });
}

function stateConflict(message: string): never {
  throw Object.assign(new Error(message), {
    statusCode: 409,
    code: "SOURCE_STATE_CONFLICT",
  });
}

/**
 * Explicit reversible retirement (ADR-119 #2): the Source's memberships
 * leave the effective-active union (rows persist), then entities with no
 * remaining effective reporter retire/GONE — the same evaluation a
 * completed run applies.
 */
export async function retireSource(id: string, actor: Actor) {
  const result = await db.transaction().execute(async (trx) => {
    const source = await trx
      .selectFrom("importer_sources")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!source) notFound();
    if (source.status === "RETIRED") {
      stateConflict("Source is already retired");
    }

    const now = new Date().toISOString();
    await trx
      .updateTable("importer_sources")
      .set({ status: "RETIRED", updatedAt: now })
      .where("id", "=", id)
      .execute();

    // Retire-side entity evaluation over the effective-active union.
    const componentIds = await trx
      .selectFrom("source_component_memberships")
      .select("componentId")
      .where("sourceId", "=", id)
      .where("active", "=", true)
      .execute();
    const instanceIds = await trx
      .selectFrom("source_instance_memberships")
      .select("componentInstanceId")
      .where("sourceId", "=", id)
      .where("active", "=", true)
      .execute();

    await markOrphanedInstancesGone(
      trx,
      instanceIds.map((i) => i.componentInstanceId),
      now,
    );
    for (const comp of componentIds) {
      const stillReported = await hasEffectiveActiveComponentMembership(
        trx,
        comp.componentId,
      );
      if (stillReported) continue;
      const updated = await trx
        .updateTable("components")
        .set({ lifecycle: "RETIRED", updatedAt: now })
        .where("id", "=", comp.componentId)
        .where("lifecycle", "=", "ACTIVE")
        .returning(["id", "name", "slug"])
        .executeTakeFirst();
      if (!updated) continue;
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
          actor,
        },
        trx,
      );
    }

    await writeEntityChange(
      {
        entityType: "importer_source",
        entityId: id,
        action: "retired",
        changes: { status: "RETIRED", previousStatus: source.status },
        actor,
      },
      trx,
    );
    return trx
      .selectFrom("importer_sources")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  });
  // ADR-129: retirement changes effective-active reporter sets outside any
  // run — re-derive auto groups now, failure-isolated like the run triggers.
  await runAutoGroupPass({ actor, trigger: "source-retire" });
  return result;
}

/** Reverse retirement: ACTIVE when bound, UNMONITORED when not. */
export async function reactivateSource(id: string, actor: Actor) {
  const result = await db.transaction().execute(async (trx) => {
    const source = await trx
      .selectFrom("importer_sources")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!source) notFound();
    if (source.status !== "RETIRED") {
      stateConflict("Source is not retired");
    }
    const next = source.boundConfigId ? "ACTIVE" : "UNMONITORED";
    await trx
      .updateTable("importer_sources")
      .set({ status: next, updatedAt: new Date().toISOString() })
      .where("id", "=", id)
      .execute();
    await writeEntityChange(
      {
        entityType: "importer_source",
        entityId: id,
        action: "reactivated",
        changes: { status: next, previousStatus: "RETIRED" },
        actor,
      },
      trx,
    );
    return trx
      .selectFrom("importer_sources")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  });
  await runAutoGroupPass({ actor, trigger: "source-reactivate" });
  return result;
}

// ---------------------------------------------------------------------------
// Effective-active membership reads (ADR-036 A1): a membership counts while
// `active = true` AND its Source is ACTIVE or UNMONITORED. RETIRED sources
// drop out of the union without losing membership rows.
// ---------------------------------------------------------------------------

/** Effective-active instance-membership check. */
export async function hasEffectiveActiveInstanceMembership(
  trx: Kysely<DB>,
  componentInstanceId: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom("source_instance_memberships")
    .innerJoin(
      "importer_sources",
      "importer_sources.id",
      "source_instance_memberships.sourceId",
    )
    .select("source_instance_memberships.id")
    .where("componentInstanceId", "=", componentInstanceId)
    .where("active", "=", true)
    .where("importer_sources.status", "in", ["ACTIVE", "UNMONITORED"])
    .executeTakeFirst();
  return row !== undefined;
}

/** Effective-active component-membership check. */
export async function hasEffectiveActiveComponentMembership(
  trx: Kysely<DB>,
  componentId: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom("source_component_memberships")
    .innerJoin(
      "importer_sources",
      "importer_sources.id",
      "source_component_memberships.sourceId",
    )
    .select("source_component_memberships.id")
    .where("componentId", "=", componentId)
    .where("active", "=", true)
    .where("importer_sources.status", "in", ["ACTIVE", "UNMONITORED"])
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Marks instance rows GONE when they have no effective-active membership
 * left — the shared evaluation used by run reconciliation, per-asset
 * phase-1 orphaning, and retire-side evaluation. Returns rows flipped.
 */
export async function markOrphanedInstancesGone(
  trx: Kysely<DB>,
  componentInstanceIds: string[],
  now: string,
): Promise<number> {
  let gone = 0;
  for (const componentInstanceId of componentInstanceIds) {
    if (await hasEffectiveActiveInstanceMembership(trx, componentInstanceId)) {
      continue;
    }
    const res = await trx
      .updateTable("component_instances")
      .set({ status: "GONE", updatedAt: now })
      .where("id", "=", componentInstanceId)
      .where("status", "!=", "GONE")
      .executeTakeFirst();
    gone += Number(res.numUpdatedRows ?? 0);
  }
  return gone;
}

/** Rehydrate a collection scope draft from a Source's memberships (spec 058
 *  US5): the reattach path pre-populates the builder with the existing
 *  component/instance/check keys so reconciliation reuses memberships
 *  instead of retiring the graph. */
export async function collectionScopeForSource(sourceId: string) {
  const source = await getSource(sourceId);
  if (!source) return null;
  const m = /^collection:(.+)$/.exec(source.externalIdentity ?? "");
  if (!m) return { sourceKey: null, components: [] };
  const sourceKey = m[1];

  const components = await db
    .selectFrom("source_component_memberships")
    .innerJoin(
      "components",
      "components.id",
      "source_component_memberships.componentId",
    )
    .select([
      "components.id as id",
      "components.externalId as componentKey",
      "components.name as name",
    ])
    .where("source_component_memberships.sourceId", "=", sourceId)
    .where("source_component_memberships.active", "=", true)
    .execute();

  const instances = await db
    .selectFrom("source_instance_memberships")
    .innerJoin(
      "component_instances",
      "component_instances.id",
      "source_instance_memberships.componentInstanceId",
    )
    .select([
      "component_instances.componentId as componentId",
      "component_instances.externalId as instanceKey",
      "component_instances.environment as environment",
      "component_instances.url as url",
      "component_instances.region as region",
      "component_instances.version as version",
      "component_instances.id as rowId",
    ])
    .where("source_instance_memberships.sourceId", "=", sourceId)
    .where("source_instance_memberships.active", "=", true)
    .execute();

  const checks = await db
    .selectFrom("source_url_check_memberships")
    .innerJoin(
      "url_checks",
      "url_checks.id",
      "source_url_check_memberships.urlCheckId",
    )
    .select([
      "url_checks.componentInstanceId as instanceId",
      "url_checks.managedKey as checkKey",
      "url_checks.name as name",
      "url_checks.url as url",
      "url_checks.method as method",
      "url_checks.enabled as enabled",
      "url_checks.successPolicy as successPolicy",
      "url_checks.cadenceSeconds as cadenceSeconds",
      "url_checks.authMode as authMode",
      "url_checks.credentialId as credentialId",
      "url_checks.authConfig as authConfig",
      "url_checks.availabilityTarget as availabilityTarget",
      "url_checks.targetWindow as targetWindow",
      "url_checks.autoDisableAfter as autoDisableAfter",
    ])
    .where("source_url_check_memberships.sourceId", "=", sourceId)
    .where("source_url_check_memberships.active", "=", true)
    .execute();
  const checkByInstance = new Map(checks.map((c) => [c.instanceId, c]));

  return {
    sourceKey,
    components: components.map((comp) => ({
      componentKey: comp.componentKey,
      name: comp.name,
      instances: instances
        .filter((i) => i.componentId === comp.id)
        .map((inst) => {
          const check = checkByInstance.get(inst.rowId);
          return {
            instanceKey: inst.instanceKey,
            environment: inst.environment,
            url: inst.url,
            ...(inst.region ? { region: inst.region } : {}),
            ...(inst.version ? { version: inst.version } : {}),
            check: check
              ? {
                  checkKey: check.checkKey,
                  name: check.name,
                  url: check.url,
                  method: check.method,
                  enabled: check.enabled,
                  successPolicy: check.successPolicy,
                  ...(check.cadenceSeconds != null ? { cadenceSeconds: check.cadenceSeconds } : {}),
                  authMode: check.authMode,
                  ...(check.authMode !== "NONE" && check.credentialId
                    ? { credentialId: check.credentialId }
                    : {}),
                  ...(check.authMode !== "NONE" && check.authConfig
                    ? { authConfig: check.authConfig }
                    : {}),
                  ...(check.availabilityTarget != null
                    ? { availabilityTarget: Number(check.availabilityTarget) }
                    : {}),
                  ...(check.targetWindow ? { targetWindow: check.targetWindow } : {}),
                  ...(check.autoDisableAfter != null
                    ? { autoDisableAfter: check.autoDisableAfter }
                    : {}),
                }
              : null,
          };
        }),
    })),
  };
}
