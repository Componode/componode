import { createHash } from "node:crypto";
import { uuidv7 } from "uuidv7";
import type { Transaction } from "kysely";
import type { DB } from "../db/types.js";
import { db } from "../db/connection.js";
import { metrics } from "../plugins/metrics.js";
import { logger as appLogger } from "../plugins/logging.js";
import { getManifest } from "./importer-registry.js";
import { writeEntityChange, type Actor } from "./audit-service.js";
import { generateUniqueSlug, slugify } from "../utils/slug.js";

/**
 * Source-scoped auto ComponentGroups (ADR-129, spec 067) + app-level auto
 * ComponentGroups (spec 070, ADR-129 amendment).
 *
 * The pass fully recomputes, for every enabled ImporterSource whose importer
 * declares the capability, auto-managed ComponentGroups maintained through
 * `component_groups.autoSourceId` / `autoGroupKey`:
 *
 * - Source group (`autoGroupKey IS NULL`, at most one per source): members
 *   are the components the source is the SOLE effective-active reporter of.
 * - App groups (`autoGroupKey = 'compose:{p}' | 'stack:{n}'`, one per
 *   (source, boundary key)): members are components the source reports
 *   (effective-active, NOT necessarily sole) that carry the matching
 *   app-boundary label in their persisted details.
 *
 * Membership is additive: a component may hold memberships in human groups,
 * the source group, and any number of app groups simultaneously. Within a
 * group the pass owns, the member set is fully derived — ineligible members
 * are evicted; memberships in groups the pass does not own are never
 * touched. Opted-out sources (`autoGroup: false` on the bound config) are
 * skipped entirely: their groups and members are frozen, never torn down.
 */

export interface SourceGroupIdentity {
  importerName: string;
  externalIdentity: string;
  label: string | null;
}

/** A source plus its durable id — strategies hash identity+key on it. */
export type SourceGroupSubject = SourceGroupIdentity & { id: string };

/**
 * Spec 070: one app-boundary dimension a strategy can extract — e.g. a
 * compose project or a swarm stack. Keys come from persisted component
 * `details`; the importer owns the semantics.
 */
export interface AppGroupKindSpec {
  /** Human label for logs/tests ("compose-project", "swarm-stack"). */
  kind: string;
  /** Extract boundary keys (project/stack names) from persisted details. */
  keysOf(details: Record<string, unknown> | null): string[];
  /** The `autoGroupKey` value for a key, e.g. `compose:componode`. */
  autoGroupKey(key: string): string;
  /** Deterministic slug base (hash included by the strategy). */
  slugBase(source: SourceGroupSubject, key: string): string;
  /** Display name at provision time — the boundary label verbatim. */
  groupName(key: string): string;
  groupDescription(source: SourceGroupIdentity, key: string): string;
}

export interface SourceGroupStrategy {
  /** Deterministic slug base; a numeric suffix resolves collisions. */
  slugBase(source: SourceGroupIdentity): string;
  /** Display name at provision time; `engineName` may be null. */
  groupName(source: SourceGroupIdentity, engineName: string | null): string;
  groupDescription(source: SourceGroupIdentity): string;
  /** Strategy-owned pick of the "engine" component name from eligible members. */
  engineComponentName?(
    members: ReadonlyArray<{ name: string; resourceType: string }>,
  ): string | null;
  /** Spec 070: app-boundary dimensions (compose projects, swarm stacks). */
  appGroupKinds?: AppGroupKindSpec[];
}

function appKeyHash(sourceId: string, autoGroupKey: string): string {
  return createHash("sha256")
    .update(`${sourceId}:${autoGroupKey}`)
    .digest("hex")
    .slice(0, 12);
}

function dockerAppKind(
  kind: "compose-project" | "swarm-stack",
  keysOf: AppGroupKindSpec["keysOf"],
  prefix: "compose" | "stack",
  boundaryNoun: string,
): AppGroupKindSpec {
  return {
    kind,
    keysOf,
    autoGroupKey: (key) => `${prefix}:${key}`,
    slugBase: (source, key) =>
      `docker-app-${slugify(key) || "app"}-${appKeyHash(source.id, `${prefix}:${key}`)}`,
    groupName: (key) => key,
    groupDescription: (source, key) =>
      `Auto-managed group for ${boundaryNoun} "${key}" on Docker source "${source.externalIdentity}" (spec 070).`,
  };
}

const STRATEGIES: Record<string, SourceGroupStrategy> = {
  docker: {
    slugBase: (s) =>
      `docker-cluster-${createHash("sha256")
        .update(s.externalIdentity)
        .digest("hex")
        .slice(0, 12)}`,
    groupName: (s, engineName) => s.label ?? engineName ?? s.externalIdentity,
    groupDescription: (s) =>
      `Auto-managed group for Docker source "${s.externalIdentity}" — membership is derived from exclusive source reporting (ADR-129).`,
    engineComponentName: (members) =>
      members.find((c) => c.resourceType === "docker-engine")?.name ?? null,
    appGroupKinds: [
      dockerAppKind(
        "compose-project",
        (details) => {
          if (!details) return [];
          const keys = new Set<string>();
          const direct = details.composeProject;
          if (typeof direct === "string" && direct) keys.add(direct);
          const labels = details.labels;
          if (labels && typeof labels === "object") {
            const lp = (labels as Record<string, unknown>)[
              "com.docker.compose.project"
            ];
            if (typeof lp === "string" && lp) keys.add(lp);
          }
          return [...keys];
        },
        "compose",
        "compose project",
      ),
      dockerAppKind(
        "swarm-stack",
        (details) => {
          const stack = details?.stack;
          return typeof stack === "string" && stack ? [stack] : [];
        },
        "stack",
        "swarm stack",
      ),
    ],
  },
};

/** Strategy lookup by importer name; undefined = not groupable. */
export function getSourceGroupStrategy(
  importerName: string,
): SourceGroupStrategy | undefined {
  return STRATEGIES[importerName];
}

/** Config-scope opt-out: absent/true = enabled, false = frozen. */
export function isAutoGroupEnabled(
  scope: Record<string, unknown> | null | undefined,
): boolean {
  return scope?.autoGroup !== false;
}

/**
 * Reduces effective-active membership pairs to sole-reporter sets:
 * sourceId → the componentIds it is the SOLE effective-active reporter
 * of; components with zero or multiple effective-active reporters are
 * omitted.
 */
export function reduceSoleReporters(
  pairs: ReadonlyArray<{ componentId: string; sourceId: string }>,
): Map<string, Set<string>> {
  const reporters = new Map<string, Set<string>>();
  for (const { componentId, sourceId } of pairs) {
    let set = reporters.get(componentId);
    if (!set) {
      set = new Set();
      reporters.set(componentId, set);
    }
    set.add(sourceId);
  }
  const sole = new Map<string, Set<string>>();
  for (const [componentId, set] of reporters) {
    if (set.size !== 1) continue;
    const sourceId = [...set][0]!;
    let bucket = sole.get(sourceId);
    if (!bucket) {
      bucket = new Set();
      sole.set(sourceId, bucket);
    }
    bucket.add(componentId);
  }
  return sole;
}

/** sourceId → ALL componentIds it effective-active reports (any count). */
function reduceAllReporters(
  pairs: ReadonlyArray<{ componentId: string; sourceId: string }>,
): Map<string, Set<string>> {
  const bySource = new Map<string, Set<string>>();
  for (const { componentId, sourceId } of pairs) {
    let set = bySource.get(sourceId);
    if (!set) {
      set = new Set();
      bySource.set(sourceId, set);
    }
    set.add(componentId);
  }
  return bySource;
}

export interface AutoGroupPassReport {
  sourcesEvaluated: number;
  groupsEnsured: number;
  membersAssigned: number;
  membersEvicted: number;
  lifecycleFlips: number;
  appGroupsEnsured: number;
  appMembersAssigned: number;
  appMembersEvicted: number;
}

interface EvaluatedSource extends SourceGroupSubject {
  status: string;
}

interface SourcePlan {
  source: EvaluatedSource;
  mode: "full" | "cleanup";
  sourceCapable: boolean;
  appCapable: boolean;
  /** Existing source group id (autoGroupKey IS NULL), if any. */
  ownGroupId: string | null;
  /** Existing app groups: autoGroupKey → groupId. */
  appGroups: Map<string, string>;
}

/**
 * How a source's auto groups participate in this pass:
 * - `full`: effective-active + capable + enabled — ensure, assign, evict,
 *   derive lifecycle (the normal evaluated path).
 * - `cleanup`: inactive + capable + enabled + already linked — the source
 *   no longer counts as a reporter, so every member loses eligibility;
 *   evict all and derive lifecycle. Groups stay so reactivation resumes.
 * Anything else (opted out via `autoGroup: false`, non-capable, unbound,
 * inactive + unlinked) is skipped entirely — frozen, never torn down.
 */
interface PassComponent {
  id: string;
  name: string;
  resourceType: string;
  lifecycle: string;
  details: Record<string, unknown> | null;
}

interface Capability {
  source: boolean;
  app: boolean;
}

async function loadSourcePlans(
  trx: Transaction<DB>,
): Promise<{ plans: SourcePlan[] }> {
  // FOR UPDATE serializes overlapping passes: a concurrent trigger blocks
  // on the shared source rows until the holder commits, then re-reads the
  // committed group links — no duplicate group provisioning.
  const sources = await trx
    .selectFrom("importer_sources")
    .selectAll()
    .forUpdate()
    .execute();
  if (sources.length === 0) return { plans: [] };

  const configIds = [
    ...new Set(
      sources.map((s) => s.boundConfigId).filter((v): v is string => v !== null),
    ),
  ];
  const configs = configIds.length
    ? await trx
        .selectFrom("importer_configs")
        .select(["id", "scope"])
        .where("id", "in", configIds)
        .execute()
    : [];
  const scopeByConfig = new Map(configs.map((c) => [c.id, c.scope]));

  // Existing auto groups per source: own group (autoGroupKey NULL) + app
  // groups keyed by autoGroupKey.
  const autoGroupRows = await trx
    .selectFrom("component_groups")
    .select(["id", "autoSourceId", "autoGroupKey"])
    .where(
      "autoSourceId",
      "in",
      sources.map((s) => s.id),
    )
    .execute();
  const groupsBySource = new Map<
    string,
    { ownGroupId: string | null; appGroups: Map<string, string> }
  >();
  for (const g of autoGroupRows) {
    if (!g.autoSourceId) continue;
    let bucket = groupsBySource.get(g.autoSourceId);
    if (!bucket) {
      bucket = { ownGroupId: null, appGroups: new Map() };
      groupsBySource.set(g.autoSourceId, bucket);
    }
    if (g.autoGroupKey === null) bucket.ownGroupId = g.id;
    else bucket.appGroups.set(g.autoGroupKey, g.id);
  }

  const capabilityCache = new Map<string, Capability>();
  const effectiveActive = new Set(["ACTIVE", "UNMONITORED"]);
  const plans: SourcePlan[] = [];
  for (const s of sources) {
    let capability = capabilityCache.get(s.importerName);
    if (capability === undefined) {
      try {
        const manifest = await getManifest(s.importerName);
        const strategy = getSourceGroupStrategy(s.importerName);
        capability = {
          source:
            manifest.autoGroups === "source" && strategy !== undefined,
          app:
            manifest.autoAppGroups === true &&
            (strategy?.appGroupKinds?.length ?? 0) > 0,
        };
      } catch {
        capability = { source: false, app: false };
      }
      capabilityCache.set(s.importerName, capability);
    }
    if (!capability.source && !capability.app) continue;

    const groups = groupsBySource.get(s.id) ?? {
      ownGroupId: null,
      appGroups: new Map<string, string>(),
    };
    const hasGroups = groups.ownGroupId !== null || groups.appGroups.size > 0;
    const source: EvaluatedSource = {
      id: s.id,
      importerName: s.importerName,
      externalIdentity: s.externalIdentity,
      label: s.label,
      status: s.status,
    };

    // Enablement is per bound config: an unbound source (config deleted,
    // UNMONITORED) has no scope to read — frozen, never evaluated. The one
    // exception is a RETIRED unbound source that still owns groups: cleanup
    // is lifecycle teardown, not maintenance, so it proceeds without a
    // scope (spec 070 FR-012).
    if (!s.boundConfigId) {
      if (effectiveActive.has(s.status) || !hasGroups) continue;
      plans.push({
        source,
        mode: "cleanup",
        sourceCapable: capability.source,
        appCapable: capability.app,
        ownGroupId: groups.ownGroupId,
        appGroups: groups.appGroups,
      });
      continue;
    }
    const scope = scopeByConfig.get(s.boundConfigId);
    if (!isAutoGroupEnabled(scope)) continue;

    if (effectiveActive.has(s.status)) {
      plans.push({
        source,
        mode: "full",
        sourceCapable: capability.source,
        appCapable: capability.app,
        ownGroupId: groups.ownGroupId,
        appGroups: groups.appGroups,
      });
    } else if (hasGroups) {
      plans.push({
        source,
        mode: "cleanup",
        sourceCapable: capability.source,
        appCapable: capability.app,
        ownGroupId: groups.ownGroupId,
        appGroups: groups.appGroups,
      });
    }
    // Inactive + unlinked: nothing to maintain.
  }
  return { plans };
}

/**
 * Durable find-or-create for one auto-managed group, keyed on provenance
 * columns — the partial unique indexes guarantee at most one group per
 * (source, autoGroupKey) pair (`null` = the source's own group).
 */
async function ensureAutoGroup(
  trx: Transaction<DB>,
  source: EvaluatedSource,
  autoGroupKey: string | null,
  fields: { baseSlug: string; name: string; description: string },
  actor: Actor,
): Promise<{ groupId: string; created: boolean }> {
  let lookup = trx
    .selectFrom("component_groups")
    .select("id")
    .where("autoSourceId", "=", source.id);
  lookup =
    autoGroupKey === null
      ? lookup.where("autoGroupKey", "is", null)
      : lookup.where("autoGroupKey", "=", autoGroupKey);
  const existing = await lookup.executeTakeFirst();
  if (existing) return { groupId: existing.id, created: false };

  const now = new Date().toISOString();
  const groupId = uuidv7();

  // Slug is display identity only — the provenance link is authoritative.
  const slug = await generateUniqueSlug(fields.baseSlug, async (candidate) => {
    const clash = await trx
      .selectFrom("component_groups")
      .select("id")
      .where("slug", "=", candidate)
      .executeTakeFirst();
    return clash !== undefined;
  });

  await trx
    .insertInto("component_groups")
    .values({
      id: groupId,
      name: fields.name,
      slug,
      description: fields.description,
      lifecycle: "RETIRED",
      teamOwnerId: null,
      autoSourceId: source.id,
      autoGroupKey,
      createdBy: actor.id,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await writeEntityChange(
    {
      entityType: "component_group",
      entityId: groupId,
      action: "created",
      changes: {
        name: fields.name,
        slug,
        autoManaged: true,
        autoGroupKey,
        sourceId: source.id,
      },
      actor,
    },
    trx,
  );
  return { groupId, created: true };
}

function sourceGroupIdentity(source: EvaluatedSource): SourceGroupIdentity {
  return {
    importerName: source.importerName,
    externalIdentity: source.externalIdentity,
    label: source.label,
  };
}

async function ensureSourceGroup(
  trx: Transaction<DB>,
  source: EvaluatedSource,
  strategy: SourceGroupStrategy,
  eligibleComponents: PassComponent[],
  actor: Actor,
): Promise<{ groupId: string; created: boolean }> {
  const identity = sourceGroupIdentity(source);
  const engineName =
    strategy.engineComponentName?.(eligibleComponents) ?? null;
  return ensureAutoGroup(
    trx,
    source,
    null,
    {
      baseSlug: strategy.slugBase(identity),
      name: strategy.groupName(identity, engineName),
      description: strategy.groupDescription(identity),
    },
    actor,
  );
}

async function ensureAppGroup(
  trx: Transaction<DB>,
  source: EvaluatedSource,
  kind: AppGroupKindSpec,
  key: string,
  actor: Actor,
): Promise<{ groupId: string; created: boolean }> {
  const autoGroupKey = kind.autoGroupKey(key);
  const identity = sourceGroupIdentity(source);
  return ensureAutoGroup(
    trx,
    source,
    autoGroupKey,
    {
      baseSlug: kind.slugBase(source, key),
      name: kind.groupName(key),
      description: kind.groupDescription(identity, key),
    },
    actor,
  );
}

/**
 * Recompute one owned group's member set: evict current members not in
 * `eligible`, insert memberships for eligible components not already
 * members. Additive — memberships in other groups are untouched.
 */
async function syncGroupMembers(
  trx: Transaction<DB>,
  groupId: string,
  eligible: ReadonlySet<string>,
  currentMembers: ReadonlySet<string>,
): Promise<{ assigned: number; evicted: number }> {
  const toEvict = [...currentMembers].filter((id) => !eligible.has(id));
  let evicted = 0;
  if (toEvict.length > 0) {
    const res = await trx
      .deleteFrom("component_group_members")
      .where("groupId", "=", groupId)
      .where("componentId", "in", toEvict)
      .executeTakeFirst();
    evicted = Number(res.numDeletedRows ?? 0);
  }
  const toAssign = [...eligible].filter((id) => !currentMembers.has(id));
  let assigned = 0;
  if (toAssign.length > 0) {
    const res = await trx
      .insertInto("component_group_members")
      .values(toAssign.map((componentId) => ({ componentId, groupId })))
      .onConflict((oc) => oc.doNothing())
      .executeTakeFirst();
    assigned = Number(res.numInsertedOrUpdatedRows ?? 0);
  }
  return { assigned, evicted };
}

async function applyPass(
  trx: Transaction<DB>,
  actor: Actor,
): Promise<AutoGroupPassReport> {
  const { plans } = await loadSourcePlans(trx);
  const report: AutoGroupPassReport = {
    sourcesEvaluated: plans.filter((p) => p.mode === "full").length,
    groupsEnsured: 0,
    membersAssigned: 0,
    membersEvicted: 0,
    lifecycleFlips: 0,
    appGroupsEnsured: 0,
    appMembersAssigned: 0,
    appMembersEvicted: 0,
  };
  if (plans.length === 0) return report;

  // Effective-active reporter pairs over ALL sources — a reporter that
  // cannot hold a group still counts toward source-group exclusivity and
  // toward app-group membership.
  const pairs = await trx
    .selectFrom("source_component_memberships")
    .innerJoin(
      "importer_sources",
      "importer_sources.id",
      "source_component_memberships.sourceId",
    )
    .select([
      "source_component_memberships.componentId as componentId",
      "source_component_memberships.sourceId as sourceId",
    ])
    .where("source_component_memberships.active", "=", true)
    .where("importer_sources.status", "in", ["ACTIVE", "UNMONITORED"])
    .execute();
  const soleReporters = reduceSoleReporters(pairs);
  const allReporters = reduceAllReporters(pairs);

  // Component universe: sole-reported + app-reported components of `full`
  // sources, plus every current member of a maintained group.
  const neededComponentIds = new Set<string>();
  const maintainedGroupIds = new Set<string>();
  for (const plan of plans) {
    if (plan.ownGroupId) maintainedGroupIds.add(plan.ownGroupId);
    for (const gid of plan.appGroups.values()) maintainedGroupIds.add(gid);
    if (plan.mode !== "full") continue;
    for (const id of soleReporters.get(plan.source.id) ?? []) {
      neededComponentIds.add(id);
    }
    if (plan.appCapable) {
      for (const id of allReporters.get(plan.source.id) ?? []) {
        neededComponentIds.add(id);
      }
    }
  }

  const currentMembersByGroup = new Map<string, Set<string>>();
  if (maintainedGroupIds.size > 0) {
    const memberRows = await trx
      .selectFrom("component_group_members")
      .select(["componentId", "groupId"])
      .where("groupId", "in", [...maintainedGroupIds])
      .execute();
    for (const r of memberRows) {
      let set = currentMembersByGroup.get(r.groupId);
      if (!set) {
        set = new Set();
        currentMembersByGroup.set(r.groupId, set);
      }
      set.add(r.componentId);
      neededComponentIds.add(r.componentId);
    }
  }

  const componentRows = new Map<string, PassComponent>();
  if (neededComponentIds.size > 0) {
    const rows = await trx
      .selectFrom("components")
      .select(["id", "name", "resourceType", "lifecycle", "details"])
      .where("id", "in", [...neededComponentIds])
      .execute();
    for (const r of rows) {
      componentRows.set(r.id, {
        ...r,
        details: (r.details ?? null) as Record<string, unknown> | null,
      });
    }
  }

  const now = new Date().toISOString();
  // groupId → {sourceId, isApp} for lifecycle audit attribution.
  const maintainedGroups = new Map<
    string,
    { sourceId: string; isApp: boolean }
  >();

  // Phase 1 — source groups: ensure, sync members (sole-reporter rule).
  for (const plan of plans) {
    if (!plan.sourceCapable) continue;
    const strategy = getSourceGroupStrategy(plan.source.importerName);
    if (!strategy) continue;
    const eligible =
      plan.mode === "full"
        ? (soleReporters.get(plan.source.id) ?? new Set<string>())
        : new Set<string>();
    let groupId = plan.ownGroupId;
    if (plan.mode === "full") {
      const eligibleRows = [...eligible]
        .map((id) => componentRows.get(id))
        .filter((c): c is PassComponent => c !== undefined);
      const ensured = await ensureSourceGroup(
        trx,
        plan.source,
        strategy,
        eligibleRows,
        actor,
      );
      groupId = ensured.groupId;
      if (ensured.created) report.groupsEnsured++;
      plan.ownGroupId = groupId;
    } else if (groupId) {
      // Cleanup: the group row must still exist; if it vanished
      // defensively there is nothing left to clean.
      const existing = await trx
        .selectFrom("component_groups")
        .select("id")
        .where("id", "=", groupId)
        .executeTakeFirst();
      if (!existing) continue;
    } else {
      continue;
    }
    maintainedGroups.set(groupId, { sourceId: plan.source.id, isApp: false });
    const current = currentMembersByGroup.get(groupId) ?? new Set<string>();
    const { assigned, evicted } = await syncGroupMembers(
      trx,
      groupId,
      eligible,
      current,
    );
    report.membersAssigned += assigned;
    report.membersEvicted += evicted;
    currentMembersByGroup.set(groupId, new Set(eligible));
  }

  // Phase 2 — app groups: per (source, boundary key). Membership =
  // reported-by-this-source AND carrying the key; additive across sources.
  for (const plan of plans) {
    if (!plan.appCapable) continue;
    const strategy = getSourceGroupStrategy(plan.source.importerName);
    const kinds = strategy?.appGroupKinds ?? [];
    if (kinds.length === 0) continue;

    // Discover keys among this source's reported components (full mode
    // only — cleanup evaluates existing groups to empty).
    const buckets = new Map<string, { kind: AppGroupKindSpec; key: string; members: Set<string> }>();
    if (plan.mode === "full") {
      for (const compId of allReporters.get(plan.source.id) ?? []) {
        const comp = componentRows.get(compId);
        if (!comp?.details) continue;
        for (const kind of kinds) {
          for (const key of kind.keysOf(comp.details)) {
            const autoGroupKey = kind.autoGroupKey(key);
            let bucket = buckets.get(autoGroupKey);
            if (!bucket) {
              bucket = { kind, key, members: new Set() };
              buckets.set(autoGroupKey, bucket);
            }
            bucket.members.add(compId);
          }
        }
      }
    }

    // Union of existing groups and newly discovered keys. `kind`/`key`
    // are only needed to CREATE a group — existing groups carry their
    // provenance in autoGroupKey already.
    const keysToMaintain = new Map<
      string,
      { kind: AppGroupKindSpec | null; key: string; eligible: Set<string> }
    >();
    for (const autoGroupKey of plan.appGroups.keys()) {
      const bucket = buckets.get(autoGroupKey);
      keysToMaintain.set(autoGroupKey, {
        kind: bucket?.kind ?? null,
        key: bucket?.key ?? "",
        eligible: bucket?.members ?? new Set<string>(),
      });
    }
    for (const [autoGroupKey, bucket] of buckets) {
      if (!keysToMaintain.has(autoGroupKey)) {
        keysToMaintain.set(autoGroupKey, {
          kind: bucket.kind,
          key: bucket.key,
          eligible: bucket.members,
        });
      }
    }

    for (const [autoGroupKey, entry] of keysToMaintain) {
      const eligible =
        plan.mode === "full" ? entry.eligible : new Set<string>();
      let groupId = plan.appGroups.get(autoGroupKey) ?? null;
      if (plan.mode === "full" && !groupId) {
        if (!entry.kind) continue; // unreachable — new keys always carry a kind
        const ensured = await ensureAppGroup(
          trx,
          plan.source,
          entry.kind,
          entry.key,
          actor,
        );
        groupId = ensured.groupId;
        if (ensured.created) {
          report.appGroupsEnsured++;
          plan.appGroups.set(autoGroupKey, groupId);
        }
      } else if (plan.mode === "cleanup" && groupId) {
        const existing = await trx
          .selectFrom("component_groups")
          .select("id")
          .where("id", "=", groupId)
          .executeTakeFirst();
        if (!existing) continue;
      } else if (!groupId) {
        continue;
      }
      maintainedGroups.set(groupId, { sourceId: plan.source.id, isApp: true });
      const current = currentMembersByGroup.get(groupId) ?? new Set<string>();
      const { assigned, evicted } = await syncGroupMembers(
        trx,
        groupId,
        eligible,
        current,
      );
      report.appMembersAssigned += assigned;
      report.appMembersEvicted += evicted;
      currentMembersByGroup.set(groupId, new Set(eligible));
    }
  }

  // Phase 3 — derived lifecycle for every maintained group: ACTIVE iff
  // ≥1 member component is ACTIVE. Transitions are audited like human
  // lifecycle writes; membership churn stays unaudited derived state.
  for (const [groupId, meta] of maintainedGroups) {
    const members = currentMembersByGroup.get(groupId) ?? new Set<string>();
    let activeMembers = 0;
    for (const compId of members) {
      if (componentRows.get(compId)?.lifecycle === "ACTIVE") activeMembers++;
    }
    const next = activeMembers > 0 ? "ACTIVE" : "RETIRED";
    const current = await trx
      .selectFrom("component_groups")
      .select(["id", "name", "slug", "lifecycle"])
      .where("id", "=", groupId)
      .executeTakeFirst();
    if (current && current.lifecycle !== next) {
      await trx
        .updateTable("component_groups")
        .set({ lifecycle: next, updatedAt: now })
        .where("id", "=", groupId)
        .execute();
      await writeEntityChange(
        {
          entityType: "component_group",
          entityId: groupId,
          action: "lifecycle",
          changes: {
            lifecycle: next,
            previousLifecycle: current.lifecycle,
            name: current.name,
            slug: current.slug,
            autoManaged: true,
            autoGroupKey: meta.isApp ? "app" : null,
            sourceId: meta.sourceId,
          },
          actor,
        },
        trx,
      );
      report.lifecycleFlips++;
    }
  }

  return report;
}

/**
 * Failure-isolated trigger wrapper — mirrors runSuggestionPass: a grouping
 * bug is logged and metric-counted, never thrown into the host operation
 * (completed run, source retire/reactivate).
 */
export async function runAutoGroupPass(
  context: { actor?: Actor; runId?: string; trigger?: string } = {},
): Promise<AutoGroupPassReport | undefined> {
  const trigger = context.trigger ?? "manual";
  const startedAt = Date.now();
  try {
    const report = await db.transaction().execute((trx) =>
      applyPass(trx, context.actor ?? { id: null, name: "system" }),
    );
    const durationSeconds = (Date.now() - startedAt) / 1000;
    appLogger.info(
      { trigger, runId: context.runId, durationSeconds, ...report },
      "source auto-group pass complete",
    );
    metrics.autoGroupPassesTotal.inc({ trigger });
    metrics.autoGroupPassDurationSeconds.observe({ trigger }, durationSeconds);
    return report;
  } catch (err) {
    metrics.autoGroupPassErrorsTotal.inc();
    appLogger.error(
      { trigger, runId: context.runId, err },
      "source auto-group pass failed",
    );
    return undefined;
  }
}
