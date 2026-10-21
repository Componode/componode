// Import Agent constants (ADR-116, spec 025).
export const AGENT_STATUSES = [
  "NEVER_CONNECTED",
  "CONNECTED",
  "OFFLINE",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_STATUS_META: Record<
  AgentStatus,
  { label: string; description: string }
> = {
  NEVER_CONNECTED: {
    label: "Never connected",
    description: "Agent created but has not completed a handshake yet",
  },
  CONNECTED: {
    label: "Connected",
    description: "Agent holds a live authenticated stream session",
  },
  OFFLINE: {
    label: "Offline",
    description: "Agent was previously connected or has no live session",
  },
};

// Operational — recorded on agent_sessions; NOT an audit enum.
export const AGENT_DISCONNECT_REASONS = [
  "client_close",
  "heartbeat_timeout",
  "revoked",
  "shutdown",
  "superseded",
  "replaced",
] as const;

export type AgentDisconnectReason = (typeof AGENT_DISCONNECT_REASONS)[number];

// entity_changes actions for entityType "import_agent".
export const AGENT_AUDIT_ACTIONS = [
  "created",
  "enrolled",
  "token_rotated",
  "updated",
  "revoked",
  "deleted",
  "credential_test_dispatched",
] as const;

export type AgentAuditAction = (typeof AGENT_AUDIT_ACTIONS)[number];

// Lockstep parity (ADR-116 #7): hub and agent must agree exactly.
export const AGENT_PROTOCOL_VERSION = 1;

// Wire `error` frame codes — shared vocabulary, both directions emit these.
export const AGENT_ERROR_CODES = {
  BAD_FRAME: "BAD_FRAME",
  UNSUPPORTED_FRAME: "UNSUPPORTED_FRAME",
  INVALID_HELLO: "INVALID_HELLO",
  AGENT_VERSION_MISMATCH: "AGENT_VERSION_MISMATCH",
} as const;

export type AgentErrorCode =
  (typeof AGENT_ERROR_CODES)[keyof typeof AGENT_ERROR_CODES];

export const AGENT_HEARTBEAT_INTERVAL_MS = 30_000; // agent -> hub
export const AGENT_STALE_AFTER_MS = 90_000; // hub marks offline
export const AGENT_SESSION_SWEEP_MS = 15_000; // hub sweep interval
export const AGENT_ENROLLMENT_TTL_MS = 86_400_000; // 24 h
export const AGENT_HELLO_TIMEOUT_MS = 5_000; // upgrade -> hello window
export const AGENT_CREDENTIAL_TEST_TIMEOUT_MS = 30_000; // credential.test -> result window (hub)
