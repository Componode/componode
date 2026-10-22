import type { AgentStatus, AgentDisconnectReason } from "../constants/import-agent.js";

// API representation of an Import Agent (ADR-116). Credential and
// enrollment-token material are never present in this shape — they are
// shown once at issuance and stored hashed.
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
  // A durable credential has been issued (enrollment completed at least once).
  hasCredential: boolean;
  // An unused, unexpired enrollment token exists.
  pendingEnrollment: boolean;
  // Importer configs bound to this agent.
  boundConfigCount: number;
  // Jobs the hub believes the agent currently holds (spec 027).
  runningJobs: number;
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
