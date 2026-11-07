import { createHash } from "node:crypto";
import { uuidv7 } from "uuidv7";
import type { Transaction } from "kysely";
import type { DB } from "../db/types.js";
import { db } from "../db/connection.js";
import { metrics } from "../plugins/metrics.js";
import { logger as appLogger } from "../plugins/logging.js";
import { getManifest } from "./importer-registry.js";
import { writeEntityChange, type Actor } from "./audit-service.js";
import { generateUniqueSlug } from "../utils/slug.js";

/**
 * Source-scoped auto ComponentGroups (ADR-129, spec 067).
 *
 * The pass fully recomputes, for every enabled ImporterSource whose importer
 * declares the capability, the set of components that source is the SOLE
 * effective-active reporter of, and maintains at most one auto-managed
 * ComponentGroup per source linked through `importer_sources.componentGroupId`.
 *
 * Membership rule (null-or-ours): a sole-reported component joins the source's
 * group only when unassigned or already in it; components parked in a
 * human-managed group are never reclaimed. Members that lose exclusivity —
 * a second effective-active reporter appears, or the source stops being
 * effective-active — are evicted to NULL. Opted-out sources (`autoGroup:
 * false` on the bound config) are skipped entirely: their group and members
 * are frozen, never torn down.
 */

export interface SourceGroupIdentity {
  importerName: string;
  externalIdentity: string;
  label: string | null;
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

export interface AutoGroupPassReport {
  sourcesEvaluated: number;
  groupsEnsured: number;
  membersAssigned: number;
  membersEvicted: number;
  lifecycleFlips: number;
}

interface EvaluatedSource extends SourceGroupIdentity {
  id: string;
  status: string;
  componentGroupId: string | null;
}

/**
 * How a source's linked group participates in this pass:
 * - `full`: effective-active + capable + enabled — ensure, assign, evict,
 *   derive lifecycle (the normal evaluated path).
 * - `cleanup`: RETIRED + capable + enabled + already linked — the source no
 *   longer counts as a reporter, so every member loses exclusivity; evict
 *   all and derive lifecycle. The link stays so reactivation resumes `full`.
 * Anything else (opted out via `autoGroup: false`, non-capable, unlinked
 * inactive) is skipped entirely — frozen, never torn down.
 */
type MaintenanceMode = "full" | "cleanup";

interface ComponentRow {
  id: string;
  name: string;
  resourceType: string;
  componentGroupId: string | null;
  lifecycle: string;
}

async function loadSourcePlans(
  trx: Transaction<DB>,
): Promise<{
  plans: Array<{ source: EvaluatedSource; mode: MaintenanceMode }>;
}> {
  // FOR UPDATE serializes overlapping passes: a concurrent trigger blocks
  // on the shared source rows until the holder commits, then re-reads the
  // committed componentGroupId links — no duplicate group provisioning.
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

  const capabilityCache = new Map<string, boolean>();
  const effectiveActive = new Set(["ACTIVE", "UNMONITORED"]);
  const plans: Array<{ source: EvaluatedSource; mode: MaintenanceMode }> = [];
  for (const s of sources) {
    let capable = capabilityCache.get(s.importerName);
    if (capable === undefined) {
      try {
        const manifest = await getManifest(s.importerName);
        capable =
          manifest.autoGroups === "source" &&
          getSourceGroupStrategy(s.importerName) !== undefined;
      } catch {
        capable = false;
      }
      capabilityCache.set(s.importerName, capable);
    }
    if (!capable) continue;
    // Enablement is per bound config: an unbound source (config deleted,
    // UNMONITORED) has no scope to read — frozen, never evaluated.
    if (!s.boundConfigId) continue;
    const scope = scopeByConfig.get(s.boundConfigId);
    if (!isAutoGroupEnabled(scope)) continue;
    const source: EvaluatedSource = {
      id: s.id,
      importerName: s.importerName,
      externalIdentity: s.externalIdentity,
      label: s.label,
      status: s.status,
      componentGroupId: s.componentGroupId,
    };
    if (effectiveActive.has(s.status)) {
      plans.push({ source, mode: "full" });
    } else if (source.componentGroupId) {
      plans.push({ source, mode: "cleanup" });
    }
    // Inactive + unlinked: nothing to maintain.
  }
  return { plans };
}

async function ensureGroup(
  trx: Transaction<DB>,
  source: EvaluatedSource,
  strategy: SourceGroupStrategy,
  eligibleComponents: ComponentRow[],
  actor: Actor,
): Promise<{ groupId: string; created: boolean }> {
  if (source.componentGroupId) {
    const existing = await trx
      .selectFrom("component_groups")
      .select("id")
      .where("id", "=", source.componentGroupId)
      .executeTakeFirst();
    if (existing) return { groupId: existing.id, created: false };
  }

  const engineName =
    strategy.engineComponentName?.(eligibleComponents) ?? null;
  const identity: SourceGroupIdentity = {
    importerName: source.importerName,
    externalIdentity: source.externalIdentity,
    label: source.label,
  };
  const baseSlug = strategy.slugBase(identity);
  const now = new Date().toISOString();
  const groupId = uuidv7();

  // Slug is display identity only — the source link is the durable marker.
  // A taken base gets a numeric suffix; uniqueness is re-checked per attempt.
  const slug = await generateUniqueSlug(baseSlug, async (candidate) => {
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
      name: strategy.groupName(identity, engineName),
      slug,
      description: strategy.groupDescription(identity),
      lifecycle: "RETIRED",
      teamOwnerId: null,
      createdBy: actor.id,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await trx
    .updateTable("importer_sources")
    .set({ componentGroupId: groupId, updatedAt: now })
    .where("id", "=", source.id)
    .execute();
  await writeEntityChange(
    {
      entityType: "component_group",
      entityId: groupId,
      action: "created",
      changes: {
        name: strategy.groupName(identity, engineName),
        slug,
        autoManaged: true,
        sourceId: source.id,
      },
      actor,
    },
    trx,
  );
  return { groupId, created: true };
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
  };
  if (plans.length === 0) return report;

  // Sole-effective-active-reporter sets over ALL sources — a reporter that
  // cannot hold a group still counts toward exclusivity.
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

  // Component universe: every sole-reported component of a `full` source
  // plus every current member of a maintained (full or cleanup) group.
  const eligibleBySource = new Map<string, Set<string>>();
  const neededComponentIds = new Set<string>();
  const linkedGroupIds = new Set<string>();
  for (const { source, mode } of plans) {
    if (source.componentGroupId) linkedGroupIds.add(source.componentGroupId);
    if (mode !== "full") continue;
    const eligible = soleReporters.get(source.id) ?? new Set<string>();
    eligibleBySource.set(source.id, eligible);
    for (const id of eligible) neededComponentIds.add(id);
  }

  const componentRows = new Map<string, ComponentRow>();
  const loadComponents = async (ids: string[]) => {
    if (ids.length === 0) return;
    const rows = await trx
      .selectFrom("components")
      .select(["id", "name", "resourceType", "componentGroupId", "lifecycle"])
      .where("id", "in", ids)
      .execute();
    for (const r of rows) componentRows.set(r.id, r as ComponentRow);
  };
  await loadComponents([...neededComponentIds]);
  if (linkedGroupIds.size > 0) {
    const members = await trx
      .selectFrom("components")
      .select(["id", "name", "resourceType", "componentGroupId", "lifecycle"])
      .where("componentGroupId", "in", [...linkedGroupIds])
      .execute();
    for (const r of members) componentRows.set(r.id, r as ComponentRow);
  }

  // Index current members by group so eviction is O(members), not
  // O(sources × catalog).
  const membersByGroup = new Map<string, ComponentRow[]>();
  for (const comp of componentRows.values()) {
    if (comp.componentGroupId === null) continue;
    const bucket = membersByGroup.get(comp.componentGroupId) ?? [];
    bucket.push(comp);
    membersByGroup.set(comp.componentGroupId, bucket);
  }

  // Phase 1 — ensure a group per `full` source, then evict members that are
  // no longer eligible: `full` keeps its sole-reporter set, `cleanup` keeps
  // nothing (a retired source is nobody's effective-active reporter).
  const groupIdBySource = new Map<string, string>();
  // componentId → the auto-managed group it is being evicted from; the
  // UPDATE guards on that group so a human reassignment landing mid-pass
  // is never nulled.
  const evictions = new Map<string, string>();
  for (const { source, mode } of plans) {
    const strategy = getSourceGroupStrategy(source.importerName);
    if (!strategy) continue;
    const eligible = eligibleBySource.get(source.id) ?? new Set<string>();
    let groupId = source.componentGroupId;
    if (mode === "full") {
      const eligibleRows = [...eligible]
        .map((id) => componentRows.get(id))
        .filter((c): c is ComponentRow => c !== undefined);
      const ensured = await ensureGroup(
        trx,
        source,
        strategy,
        eligibleRows,
        actor,
      );
      groupId = ensured.groupId;
      if (ensured.created) report.groupsEnsured++;
    } else if (groupId) {
      // Cleanup: the linked group row must still exist; if it vanished
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
    groupIdBySource.set(source.id, groupId);

    for (const comp of membersByGroup.get(groupId) ?? []) {
      if (eligible.has(comp.id)) continue;
      evictions.set(comp.id, groupId);
    }
  }

  // Phase 2 — assign sole-reported components that are unassigned after
  // evictions. Foreign human-managed groups are never reclaimed.
  const effectiveGroup = (comp: ComponentRow): string | null =>
    evictions.has(comp.id) ? null : comp.componentGroupId;
  const assignments = new Map<string, string>();
  for (const { source, mode } of plans) {
    if (mode !== "full") continue;
    const groupId = groupIdBySource.get(source.id);
    if (!groupId) continue;
    const eligible = eligibleBySource.get(source.id) ?? new Set<string>();
    for (const compId of eligible) {
      const comp = componentRows.get(compId);
      if (!comp) continue;
      const current = effectiveGroup(comp);
      if (current === null) assignments.set(compId, groupId);
    }
  }

  // Phase 3 — apply writes. Evictions first, assignments second so a
  // component stale-membered in one source's group but sole-reported by
  // another lands directly in the right group.
  const now = new Date().toISOString();
  const evictByGroup = new Map<string, string[]>();
  for (const [compId, fromGroup] of evictions) {
    const bucket = evictByGroup.get(fromGroup) ?? [];
    bucket.push(compId);
    evictByGroup.set(fromGroup, bucket);
  }
  for (const [fromGroup, ids] of evictByGroup) {
    const res = await trx
      .updateTable("components")
      .set({ componentGroupId: null, updatedAt: now })
      .where("id", "in", ids)
      .where("componentGroupId", "=", fromGroup)
      .execute();
    report.membersEvicted += Number(res[0]?.numUpdatedRows ?? 0);
  }
  const byTarget = new Map<string, string[]>();
  for (const [compId, groupId] of assignments) {
    const bucket = byTarget.get(groupId) ?? [];
    bucket.push(compId);
    byTarget.set(groupId, bucket);
  }
  for (const [groupId, ids] of byTarget) {
    const res = await trx
      .updateTable("components")
      .set({ componentGroupId: groupId, updatedAt: now })
      .where("id", "in", ids)
      .where("componentGroupId", "is", null)
      .execute();
    report.membersAssigned += Number(res[0]?.numUpdatedRows ?? 0);
  }

  // Phase 4 — derived lifecycle: ACTIVE iff ≥1 member component is ACTIVE.
  // Transitions are audited like human lifecycle writes (plan.md audit
  // decision) — membership churn stays unaudited derived state.
  for (const [sourceId, groupId] of groupIdBySource) {
    const members = await trx
      .selectFrom("components")
      .select("lifecycle")
      .where("componentGroupId", "=", groupId)
      .execute();
    const activeMembers = members.filter((m) => m.lifecycle === "ACTIVE").length;
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
            sourceId,
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
