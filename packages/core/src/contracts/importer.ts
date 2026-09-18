import type { DiscoveredAsset } from "./discovered-asset.js";
import type { CredentialTestResult } from "./credential.js";
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
