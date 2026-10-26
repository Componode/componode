import type { RelationshipType } from "../constants/index.js";

export interface EntityChange {
  id: string;
  entityType: string;
  entityId: string | null;
  /** Display name resolved at read time; null when unresolvable. */
  entityName?: string | null;
  action: string;
  changes?: Record<string, unknown> | null;
  importRunId?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
}

export type ActivityFeedItem =
  | ({ kind: "entity" } & EntityChange)
  | ({ kind: "edge" } & EdgeChange);

export interface EdgeChange {
  id: string;
  edgeType: RelationshipType;
  fromEntityType: string;
  fromEntityId: string;
  /** Display name resolved at read time; null when unresolvable. */
  fromEntityName?: string | null;
  toEntityType: string;
  toEntityId: string;
  /** Display name resolved at read time; null when unresolvable. */
  toEntityName?: string | null;
  action: string;
  reason?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
}
