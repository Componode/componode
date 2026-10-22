// Credential kind discriminator (ADR-117, spec 026).
export const CREDENTIAL_KINDS = [
  "STORED",
  "AGENT_MANAGED",
] as const;

export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const CREDENTIAL_KIND_META: Record<
  CredentialKind,
  { label: string; description: string }
> = {
  STORED: {
    label: "Stored in Componode",
    description:
      "Secret values are encrypted at rest and resolved in-process on the hub",
  },
  AGENT_MANAGED: {
    label: "Resolved on an Import Agent",
    description:
      "Credential holds references only; values live on the agent host (env vars or files under SECRETS_DIR)",
  },
};
