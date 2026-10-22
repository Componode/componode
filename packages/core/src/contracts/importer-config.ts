export interface ImporterConfig {
  id: string;
  importerName: string;
  label: string;
  scope: Record<string, unknown>;
  secretRefs?: Array<{ key: string; env?: string; file?: string }> | null;
  // Stored-credential references resolved through the credential store
  // (spec 013). `secretRefsDeprecated` flags configs still relying on
  // legacy env/file refs.
  credentialIds?: string[];
  secretRefsDeprecated?: boolean;
  // Agent binding (ADR-116, spec 027): the Import Agent that executes this
  // config's runs. Null = in-process execution on the hub.
  agentId?: string | null;
  // Joined agent summary when bound (id/name/status); null otherwise.
  agent?: { id: string; name: string; status: string } | null;
  // Read-time flag: bound agent is revoked or its non-empty
  // allowedImporters policy does not cover this config's importer.
  agentIncompatible?: boolean;
  schedule?: string | null;
  enabled: boolean;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}
