// ImporterSource lifecycle (ADR-119). Drives the CHECK constraint on
// importer_sources.status via the core-constants rule (no native ENUMs).
export const IMPORTER_SOURCE_STATUSES = [
  "ACTIVE",
  "UNMONITORED",
  "RETIRED",
] as const;

export type ImporterSourceStatus =
  (typeof IMPORTER_SOURCE_STATUSES)[number];

// entity_changes.action values for entityType "importer_source"
// (precedent: AGENT_AUDIT_ACTIONS).
export const SOURCE_AUDIT_ACTIONS = [
  "created",
  "bound",
  "unmonitored",
  "retired",
  "reactivated",
] as const;

export type SourceAuditAction = (typeof SOURCE_AUDIT_ACTIONS)[number];
