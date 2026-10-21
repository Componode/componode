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
  // Importer configs bound to this agent (027 populates; 0 in 025).
  boundConfigCount: number;
  createdAt: string;
  updatedAt: string;
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
