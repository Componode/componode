import { decryptSecrets, type Keyring } from "./credential-crypto.js";
import { EnvSecretResolver } from "@componode/core/secrets";
import type { SecretRef } from "@componode/core/secrets";

// Shared resolver + ref type live in core (spec 026, R6) so hub and agent
// share identical ref semantics; re-export for existing backend imports.
// Imported via the node-only "@componode/core/secrets" subpath so browser
// bundles never pull fs/path.
export { EnvSecretResolver, redactSecrets } from "@componode/core/secrets";
export type { SecretRef } from "@componode/core/secrets";

const resolver = new EnvSecretResolver();

export async function resolveSecrets(
  secretRefs: Array<SecretRef> | null | undefined,
): Promise<Record<string, string>> {
  if (!secretRefs) {
    return {};
  }

  const secrets: Record<string, string> = {};

  for (const ref of secretRefs) {
    secrets[ref.key] = await resolver.resolve(ref);
  }

  return secrets;
}

// --- Credential-store resolution (spec 013, ADR-107) -----------------------

export interface CredentialRecord {
  id: string;
  label: string;
  status: string;
  kind: string;
  encryptedPayload: string | null;
  keyVersion: number;
  expiresAt: string | null;
}

export interface CredentialResolutionDeps {
  // Null when no master key is configured — resolution of stored credentials
  // then fails CREDENTIAL_KEY_UNAVAILABLE; legacy refs still resolve.
  keyring: Keyring | null;
  loadCredential: (id: string) => Promise<CredentialRecord | null>;
}

export interface ImportSecretsInput {
  secretRefs?: Array<SecretRef> | null;
  credentialIds?: string[] | null;
}

export interface ImportSecretsResult {
  secrets: Record<string, string>;
  credentialIds: string[];
  // Labels of the credentials actually resolved — used in error messages so
  // failures name the credential, not just the key.
  credentialLabels: string[];
  // True when deprecated env/file refs were used — callers should surface
  // the deprecation (UI flag + log warning) during the migration window.
  legacyRefsUsed: boolean;
  // Advisory warnings (e.g. expiring credentials) — never secret material.
  warnings: string[];
}

const EXPIRY_WARNING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const CODE_STATUS: Record<string, number> = {
  CREDENTIAL_NOT_FOUND: 404,
  CREDENTIAL_IN_USE: 409,
  CREDENTIAL_REVOKED: 409,
  CREDENTIAL_MISSING_KEY: 400,
  CREDENTIAL_KEY_COLLISION: 400,
  CREDENTIAL_KEY_UNAVAILABLE: 503,
  CREDENTIAL_KIND_MISMATCH: 400,
  LEGACY_SECRET_UNRESOLVABLE: 502,
  MANIFEST_NO_TEST: 400,
  CONVERSION_NOTHING_TO_CONVERT: 400,
};

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), {
    code,
    statusCode: CODE_STATUS[code] ?? 500,
  });
}

function checkExpiryWarning(credential: CredentialRecord, warnings: string[]): void {
  if (!credential.expiresAt) return;
  const expires = new Date(credential.expiresAt).getTime();
  const now = Date.now();
  if (expires <= now) {
    warnings.push(`Credential "${credential.label}" expired on ${credential.expiresAt}`);
  } else if (expires - now <= EXPIRY_WARNING_WINDOW_MS) {
    warnings.push(`Credential "${credential.label}" expires soon (${credential.expiresAt})`);
  }
}

// Resolves an importer config's secrets from stored credentials plus any
// legacy env/file refs (deprecation window). Any duplicate key across
// sources is a CREDENTIAL_KEY_COLLISION naming both providers.
export async function resolveImportSecrets(
  input: ImportSecretsInput,
  deps: CredentialResolutionDeps,
): Promise<ImportSecretsResult> {
  const secrets: Record<string, string> = {};
  const keySources = new Map<string, string>();
  const warnings: string[] = [];
  const credentialLabels: string[] = [];
  const credentialIds = input.credentialIds ?? [];

  const claim = (key: string, source: string, value: string) => {
    const existing = keySources.get(key);
    if (existing !== undefined) {
      throw codedError(
        "CREDENTIAL_KEY_COLLISION",
        `Secret key "${key}" is provided by both ${existing} and ${source}`,
      );
    }
    keySources.set(key, source);
    secrets[key] = value;
  };

  if (credentialIds.length > 0 && !deps.keyring) {
    throw codedError(
      "CREDENTIAL_KEY_UNAVAILABLE",
      "Credential store is unavailable: no master key configured",
    );
  }

  for (const credentialId of credentialIds) {
    const credential = await deps.loadCredential(credentialId);
    if (!credential) {
      throw codedError("CREDENTIAL_NOT_FOUND", `Credential not found: ${credentialId}`);
    }
    if (credential.status === "REVOKED") {
      throw codedError(
        "CREDENTIAL_REVOKED",
        `Credential "${credential.label}" is revoked and cannot be used`,
      );
    }
    // Defense-in-depth (spec 026): agent-managed credentials carry refs, not
    // values — binding validation normally prevents them reaching in-process
    // resolution; if one gets here anyway, fail before touching the payload.
    if (credential.kind === "AGENT_MANAGED") {
      throw codedError(
        "CREDENTIAL_KIND_MISMATCH",
        `Credential "${credential.label}" is agent-managed and cannot be resolved in-process`,
      );
    }
    checkExpiryWarning(credential, warnings);
    credentialLabels.push(credential.label);
    const payload = decryptSecrets(credential.encryptedPayload!, deps.keyring!);
    for (const [key, value] of Object.entries(payload)) {
      claim(key, `credential "${credential.label}"`, value);
    }
  }

  for (const ref of input.secretRefs ?? []) {
    const source = ref.env ? `env ref "${ref.env}"` : `file ref "${ref.file}"`;
    claim(ref.key, source, await resolver.resolve(ref));
  }

  return {
    secrets,
    credentialIds,
    credentialLabels,
    legacyRefsUsed: (input.secretRefs?.length ?? 0) > 0,
    warnings,
  };
}

// Save-time coverage check (spec 013 FR-009): verifies that the union of
// key names provided by a config's sources (legacy refs + referenced
// credentials' keyHints) covers the manifest's required keys — without
// decrypting anything. Throws CREDENTIAL_MISSING_KEY naming the key.
export function assertSecretCoverage(
  declarations: Array<{ key: string; label: string; required: boolean }>,
  providedKeys: Iterable<string>,
): void {
  const provided = new Set(providedKeys);
  for (const decl of declarations) {
    if (decl.required && !provided.has(decl.key)) {
      throw codedError(
        "CREDENTIAL_MISSING_KEY",
        `Missing required secret "${decl.key}" (${decl.label})`,
      );
    }
  }
}

// Save-time collision pre-check (spec 013 FR-008): detects the same key
// name being provided by more than one source before any value is
// resolved/decrypted. Throws CREDENTIAL_KEY_COLLISION naming the sources.
export function checkKeyCollisions(
  sources: Array<{ source: string; keys: string[] }>,
): void {
  const seen = new Map<string, string>();
  for (const { source, keys } of sources) {
    for (const key of keys) {
      const existing = seen.get(key);
      if (existing !== undefined) {
        throw codedError(
          "CREDENTIAL_KEY_COLLISION",
          `Secret key "${key}" is provided by both ${existing} and ${source}`,
        );
      }
      seen.set(key, source);
    }
  }
}

// Validates that resolved secrets cover the importer manifest's declared
// required keys. Throws CREDENTIAL_MISSING_KEY naming the missing key and,
// when provided, the credential labels that should have covered it.
export function assertRequiredSecrets(
  secrets: Record<string, string>,
  declarations: Array<{ key: string; label: string; required: boolean }>,
  credentialLabels?: string[],
): void {
  const source =
    credentialLabels && credentialLabels.length > 0
      ? ` — referenced credential(s): ${credentialLabels.map((l) => `"${l}"`).join(", ")}`
      : "";
  for (const decl of declarations) {
    if (decl.required && !(decl.key in secrets)) {
      throw codedError(
        "CREDENTIAL_MISSING_KEY",
        `Missing required secret "${decl.key}" (${decl.label})${source}`,
      );
    }
  }
}
