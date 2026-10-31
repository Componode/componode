import type { ImportRunStatus } from "../constants/index.js";

export interface ImportRun {
  id: string;
  // Nullable — deleting a config preserves run history (ADR-047 A1);
  // orphan runs are read via /importer-sources/:id/runs.
  configId: string | null;
  // Durable source attribution (ADR-119); null = LEGACY_UNATTRIBUTED.
  sourceId: string | null;
  // The executing Import Agent; null = in-process execution (spec 027).
  agentId: string | null;
  // Joined display name; null when the agent row no longer exists.
  agentName: string | null;
  status: ImportRunStatus;
  triggeredBy?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  assetsProcessed: number;
  assetsCreated: number;
  assetsUpdated: number;
  instancesOrphaned: number;
  componentsRetired: number;
  currentPhase?: string | null;
  cancelRequestedAt?: string | null;
  errorMessage?: string | null;
  errorStack?: string | null;
  errorType?: string | null;
  createdAt: string;
}

export interface ImportRunError {
  id: string;
  runId: string;
  assetExternalId?: string | null;
  errorType: string;
  errorMessage: string;
  errorStack?: string | null;
  createdAt: string;
}
