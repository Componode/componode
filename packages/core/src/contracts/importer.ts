import type { DiscoveredAsset } from "./discovered-asset.js";
import type { CredentialTestResult } from "./credential.js";
import type { SourceIdentityInput } from "./importer-source.js";
import type { Logger } from "../observability/logger.js";
import type { Tracer } from "../observability/tracer.js";

export interface SecretResolver {
  resolve(ref: string): Promise<string>;
}

// Declares one named secret key an importer consumes from the `secrets`
// record (e.g. GitHub's `token`). Declared keys drive save-time credential
// coverage validation and credential-form field labels. Declare only keys
// the importer actually reads.
export interface ImporterSecretDeclaration {
  key: string;
  label: string;
  required: boolean;
}

export interface ImporterContext {
  runId: string;
  logger: Logger;
  signal: AbortSignal;
  reportPhase: (name: string) => void | Promise<void>;
  tracer?: Tracer;
  // Registers-or-matches the run's ImporterSource (ADR-119, ADR-056 A1).
  // Importers whose manifest declares `reportsSourceIdentity` MUST call
  // this before the first asset yield — including empty inventories.
  reportSourceIdentity: (identity: SourceIdentityInput) => void | Promise<void>;
  // Returns the preflight-resolved, non-secret target profile. Valid only
  // when the importer's manifest declares `targetRefKey` (ADR-056 A1);
  // throws otherwise. Resolves only on Import Agents — the in-process
  // executor provides a stub that always throws.
  resolveTarget: (targetId: string) => unknown;
}

export interface Importer {
  readonly name: string;
  readonly version: string;
  run(
    config: Record<string, unknown>,
    secrets: Record<string, string>,
    context: ImporterContext,
  ): AsyncGenerator<DiscoveredAsset>;
  // Optional credential probe used by the credential test action. Performs a
  // minimal authenticated request against the target system. Never returns
  // secret material in `error`.
  testSecrets?(
    secrets: Record<string, string>,
    config?: Record<string, unknown>,
  ): Promise<CredentialTestResult>;
}
