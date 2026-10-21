import type { CredentialStatus } from "../constants/credential-status.js";
import type { CredentialKind } from "../constants/credential-kind.js";
import type { SecretRefMap } from "../schemas/credential.js";

// API representation of a stored credential. Plaintext secret values are
// never present in this shape — they are write-only. AGENT_MANAGED records
// carry references (names, not values — ADR-117), which are non-secret and
// safe to return.
export interface Credential {
  id: string;
  slug: string;
  label: string;
  status: CredentialStatus;
  kind: CredentialKind;
  // AGENT_MANAGED only: per-key references resolved on the agent host.
  secretRefMap?: SecretRefMap;
  // Non-reversible display hints per secret key — last-4 for STORED,
  // source type ("env"|"file") for AGENT_MANAGED.
  keyHints: Record<string, string>;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialDependents {
  importerConfigs: Array<{ id: string; label: string }>;
  oidc: boolean;
}

export interface CredentialDetail {
  credential: Credential;
  dependents: CredentialDependents;
}

export interface CredentialTestResult {
  ok: boolean;
  error?: string;
  // Set when the test ran on an Import Agent (spec 026) — the executing
  // agent's name.
  agent?: string;
}
