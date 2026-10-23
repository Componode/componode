import type { ActivityFeedItem, CatalogCoverage } from "@componode/core";
import type { AttentionItem } from "@/api/types";
import type { AttentionEntry, AuditEvent } from "@/ux/lib/view-types";

const DESTRUCTIVE_KINDS = new Set(["FAILED_RUN", "INSTANCE_ERROR", "PRODUCT_ERROR"]);

/** API attention kinds → display tone. Unknown kinds render as warnings. */
export function mapAttentionItem(item: AttentionItem): AttentionEntry {
  return {
    kind: item.kind,
    label: item.label,
    detail: null,
    href: item.href,
    at: item.at,
    tone: DESTRUCTIVE_KINDS.has(item.kind) ? "destructive" : "warning",
  };
}

const pct = (total: number, missing: number): number | null =>
  total === 0 ? null : Math.round(((total - missing) / total) * 100);

/** CatalogCoverage (missing counts) → per-facet percentages, null at total=0. */
export function mapCoverage(c: CatalogCoverage): {
  owner: number | null;
  description: number | null;
  dependencies: number | null;
} {
  return {
    owner: pct(c.products.total, c.products.missingOwner),
    description: pct(c.products.total, c.products.missingDescription),
    dependencies: pct(c.products.total, c.products.missingDependencies),
  };
}

const ENTITY_KIND: Record<string, AuditEvent["entityKind"]> = {
  digital_product: "product",
  component: "component",
  component_instance: "component",
  component_group: "component",
  importer_config: "importer",
  credential: "credential",
  user: "user",
  settings: "settings",
  session: "session",
  auth: "session",
  import_agent: "agent",
};

const ACTIONS = new Set([
  "created",
  "updated",
  "deleted",
  "revoked",
  "rotated",
  "enrolled",
  "signed_in",
  "ran",
]);

/**
 * ActivityFeedItem (entity or edge change) → sentence-style feed row.
 * The audit API carries ids, not display names — `entityName` falls back
 * to `entityType:entityId` until the feed exposes names (gap G11).
 */
export function mapActivityItem(item: ActivityFeedItem): AuditEvent {
  if (item.kind === "edge") {
    return {
      id: item.id,
      actor: item.createdByName ?? "system",
      action: ACTIONS.has(item.action) ? (item.action as AuditEvent["action"]) : "other",
      entityKind: ENTITY_KIND[item.fromEntityType] ?? "other",
      entityName: `${item.fromEntityType}:${item.fromEntityId}`,
      summary: `${item.edgeType} edge ${item.action} → ${item.toEntityType}:${item.toEntityId}`,
      at: item.createdAt,
    };
  }
  const action = ACTIONS.has(item.action) ? (item.action as AuditEvent["action"]) : "other";
  const entityKind = ENTITY_KIND[item.entityType] ?? "other";
  const changes = item.changes ? Object.keys(item.changes).join(", ") : null;
  return {
    id: item.id,
    actor: item.createdByName ?? "system",
    action,
    entityKind,
    entityName: item.entityId ?? item.entityType,
    summary: changes ?? item.action,
    at: item.createdAt,
  };
}
