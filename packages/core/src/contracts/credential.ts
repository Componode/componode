import type { CredentialStatus } from "../constants/credential-status.js";

// API representation of a stored credential. Plaintext secret values are
// never present in this shape — they are write-only.
export interface Credential {
  id: string;
  slug: string;
  label: string;
  status: CredentialStatus;
  // Non-reversible display hints per secret key (e.g. { token: "wxyz" }).
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
}
