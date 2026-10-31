import type { AgentStatus, AgentDisconnectReason } from "../constants/import-agent.js";
import type { AgentOpsSnapshot } from "./agent-protocol.js";

// API representation of an Import Agent (ADR-116). Credential and
// enrollment-token material are never present in this shape — they are
// shown once at issuance and stored hashed.
// Latest agent-reported operational snapshot (spec 028) — the heartbeat
// `ops` payload plus the hub-stamped receipt time. Numeric/state fields
// only; `null` on the read surface means "not reported by this agent".
export type AgentReportedStatus = AgentOpsSnapshot & { receivedAt: string };

export interface ImportAgent {
  id: string;
  name: string;
  status: AgentStatus;
  agentVersion: string | null;
  protocolVersion: number | null;
  importerVersions: { name: string; version: string }[];
  allowedImporters: string[];
  maxConcurrentJobs: number | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  // Latest agent-reported ops snapshot (spec 028); null = not reported.
  reportedStatus: AgentReportedStatus | null;
  // Freshness of the live session's last accepted frame; null when no
  // session is established (fall back to lastSeenAt).
  lastHeartbeatAt: string | null;
  // disconnectReason of the most recent closed session; null when the
  // agent has no session history.
  lastDisconnectReason: AgentDisconnectReason | null;
  // A durable credential has been issued (enrollment completed at least once).
  hasCredential: boolean;
  // An unused, unexpired enrollment token exists.
  pendingEnrollment: boolean;
  // Importer configs bound to this agent.
  boundConfigCount: number;
  // Jobs the hub believes the agent currently holds (spec 027).
  runningJobs: number;
  // Display name of the person who enrolled the agent (spec 040 / G25);
  // null when the actor column is unset or no longer resolves.
  createdBy: string | null;
  // Expiry of the live pending-enrollment token (spec 040 / G25); null
  // when no unused, unexpired token exists.
  enrollmentExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// In-flight job on a connected agent (spec 027 — from the hub's dispatch
// map, not persisted).
export interface AgentActiveRun {
  runId: string;
  configId: string;
  configLabel: string;
  state: "ASSIGNED" | "RUNNING";
  phase: string | null;
  startedAt: string | null;
}

export interface AgentDetail extends ImportAgent {
  activeRuns: AgentActiveRun[];
}

// Importer config bound to an agent — the agent detail "configs" tab.
export interface AgentBoundConfig {
  id: string;
  label: string;
  importerName: string;
  schedule: string | null;
  enabled: boolean;
  // Bound agent is revoked or its non-empty allowedImporters policy does
  // not cover this config's importer.
  agentIncompatible: boolean;
}

// Import run executed by an agent — the agent detail "runs" tab.
export interface AgentRun {
  id: string;
  configId: string;
  configLabel: string;
  status: string;
  errorType: string | null;
  currentPhase: string | null;
  assetsProcessed: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentSession {
  id: string;
  agentId: string;
  connectedAt: string;
  disconnectedAt: string | null;
  disconnectReason: AgentDisconnectReason | null;
  remoteAddress: string | null;
  agentVersion: string | null;
  protocolVersion: number | null;
  importerVersions: { name: string; version: string }[];
}

// Returned once by create/rotate — the plaintext token is never retrievable
// again from any surface.
export interface AgentEnrollment {
  token: string;
  expiresAt: string;
}
