import type { Transaction } from "kysely";
import { db } from "../db/connection.js";
import type { DB } from "../db/types.js";

/**
 * Spec 070: `component_group_members` is the single membership store —
 * a component may belong to any number of groups (human, source-auto,
 * app-auto). Ownership derives from the GROUP: memberships in groups with
 * `autoSourceId IS NULL` are human-editable; memberships in auto-managed
 * groups are system-owned and rewritten only by the grouping pass.
 */

export type MembershipExecutor = Transaction<DB> | typeof db;

/**
 * Pure diff between a component's current HUMAN memberships and the
 * desired set: ids to delete and ids to insert. Duplicates in either
 * input are ignored.
 */
export function diffHumanMemberships(
  before: string[],
  desiredGroupIds: string[],
): { toRemove: string[]; toAdd: string[] } {
  const desired = [...new Set(desiredGroupIds)];
  const beforeSet = new Set(before);
  const desiredSet = new Set(desired);
  return {
    toRemove: before.filter((id) => !desiredSet.has(id)),
    toAdd: desired.filter((id) => !beforeSet.has(id)),
  };
}

/**
 * Pure validation over fetched group rows: every requested id must exist
 * and be human-managed (`autoSourceId IS NULL`). Throws the controlled
 * conflicts the component write paths surface: 404 for unknown ids,
 * 409 GROUP_AUTO_MANAGED for auto-managed ids.
 */
export function assertGroupsAssignable(
  rows: { id: string; autoSourceId: string | null }[],
  requestedIds: string[],
): void {
  const unique = [...new Set(requestedIds)];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of unique) {
    const row = byId.get(id);
    if (!row) {
      throw Object.assign(new Error("Component group not found"), {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }
    if (row.autoSourceId !== null) {
      throw Object.assign(
        new Error(
          "Component group is managed by an importer source — its membership is derived automatically",
        ),
        { statusCode: 409, code: "GROUP_AUTO_MANAGED" },
      );
    }
  }
}

export interface ComponentGroupRef {
  id: string;
  name: string;
  slug: string;
  autoSourceId: string | null;
  autoGroupKey: string | null;
}

/** All group memberships for the given components, ordered by group name then id. */
export async function groupsOfComponents(
  componentIds: string[],
  executor: MembershipExecutor = db,
): Promise<Map<string, ComponentGroupRef[]>> {
  const map = new Map<string, ComponentGroupRef[]>();
  if (componentIds.length === 0) return map;
  const rows = await executor
    .selectFrom("component_group_members")
    .innerJoin(
      "component_groups",
      "component_group_members.groupId",
      "component_groups.id",
    )
    .select([
      "component_group_members.componentId",
      "component_groups.id",
      "component_groups.name",
      "component_groups.slug",
      "component_groups.autoSourceId",
      "component_groups.autoGroupKey",
    ])
    .where("component_group_members.componentId", "in", componentIds)
    .orderBy("component_groups.name")
    .orderBy("component_groups.id")
    .execute();
  for (const r of rows) {
    const bucket = map.get(r.componentId) ?? [];
    bucket.push({
      id: r.id,
      name: r.name,
      slug: r.slug,
      autoSourceId: r.autoSourceId,
      autoGroupKey: r.autoGroupKey,
    });
    map.set(r.componentId, bucket);
  }
  return map;
}

/** Group refs for a single component (empty array when ungrouped). */
export async function groupsOfComponent(
  componentId: string,
  executor: MembershipExecutor = db,
): Promise<ComponentGroupRef[]> {
  const map = await groupsOfComponents([componentId], executor);
  return map.get(componentId) ?? [];
}

/** Ids of the component's memberships in HUMAN-managed groups only. */
export async function humanGroupIdsOfComponent(
  componentId: string,
  executor: MembershipExecutor = db,
): Promise<string[]> {
  const rows = await executor
    .selectFrom("component_group_members")
    .innerJoin(
      "component_groups",
      "component_group_members.groupId",
      "component_groups.id",
    )
    .select("component_group_members.groupId")
    .where("component_group_members.componentId", "=", componentId)
    .where("component_groups.autoSourceId", "is", null)
    .execute();
  return rows.map((r) => r.groupId);
}

/** Insert membership rows (idempotent via PK — conflicts ignored). */
export async function addMemberships(
  componentId: string,
  groupIds: string[],
  executor: MembershipExecutor = db,
): Promise<void> {
  const unique = [...new Set(groupIds)];
  if (unique.length === 0) return;
  await executor
    .insertInto("component_group_members")
    .values(unique.map((groupId) => ({ componentId, groupId })))
    .onConflict((oc) => oc.doNothing())
    .execute();
}

/**
 * Replace the component's HUMAN-managed memberships with `desiredGroupIds`.
 * Auto-managed memberships are never touched. Returns the before/after
 * human-group id sets for audit and suggestion-pass triggering.
 */
export async function replaceHumanMemberships(
  componentId: string,
  desiredGroupIds: string[],
  executor: MembershipExecutor = db,
): Promise<{ before: string[]; after: string[] }> {
  const before = await humanGroupIdsOfComponent(componentId, executor);
  const { toRemove, toAdd } = diffHumanMemberships(before, desiredGroupIds);
  const after = [...new Set(desiredGroupIds)];
  if (toRemove.length > 0) {
    await executor
      .deleteFrom("component_group_members")
      .where("componentId", "=", componentId)
      .where("groupId", "in", toRemove)
      .execute();
  }
  if (toAdd.length > 0) {
    await executor
      .insertInto("component_group_members")
      .values(toAdd.map((groupId) => ({ componentId, groupId })))
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  return { before, after };
}

/**
 * Validate that every id is an existing HUMAN-managed group. Throws the
 * controlled conflicts the component write paths surface: 404 for unknown
 * ids, 409 GROUP_AUTO_MANAGED for auto-managed ids.
 */
export async function assertAssignableHumanGroups(
  groupIds: string[],
): Promise<void> {
  if (groupIds.length === 0) return;
  const rows = await db
    .selectFrom("component_groups")
    .select(["id", "autoSourceId"])
    .where("id", "in", [...new Set(groupIds)])
    .execute();
  assertGroupsAssignable(rows, groupIds);
}
