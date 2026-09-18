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
  schedule?: string | null;
  enabled: boolean;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}
