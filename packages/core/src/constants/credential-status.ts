export const CREDENTIAL_STATUSES = [
  "ACTIVE",
  "REVOKED",
] as const;

export type CredentialStatus = typeof CREDENTIAL_STATUSES[number];

export const CREDENTIAL_STATUS_META: Record<
  CredentialStatus,
  { label: string; description: string }
> = {
  ACTIVE: {
    label: "Active",
    description: "Credential can be resolved for importer runs and integrations",
  },
  REVOKED: {
    label: "Revoked",
    description: "Credential is disabled; resolution fails fast until replaced",
  },
};
