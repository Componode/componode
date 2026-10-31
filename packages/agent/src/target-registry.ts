import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseTargetRegistry,
  TargetRegistryError,
  type TargetProfile,
} from "@componode/core";

const DEFAULT_SECRETS_DIR = "/run/secrets";

/** Registry file convention: `${SECRETS_DIR}/{importerName}-targets.json`. */
export function targetRegistryPath(
  secretsDir: string | undefined,
  importerName: string,
): string {
  return join(secretsDir ?? DEFAULT_SECRETS_DIR, `${importerName}-targets.json`);
}

/**
 * Loads the agent-local target registry fresh per job and resolves one
 * profile (ADR-116 A5/A6). The registry IS the allowlist — an absent
 * targetId, a missing file, or a malformed registry all throw
 * TargetRegistryError with non-secret messages (fail closed, agent stays
 * up).
 */
export async function loadTargetProfile(
  secretsDir: string | undefined,
  importerName: string,
  targetId: string,
): Promise<TargetProfile> {
  const path = targetRegistryPath(secretsDir, importerName);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new TargetRegistryError("target registry is not valid JSON");
    }
    throw new TargetRegistryError("target registry is not provisioned");
  }
  const registry = parseTargetRegistry(raw);
  const profile = registry.targets[targetId];
  if (!profile) {
    throw new TargetRegistryError(`target "${targetId}" is not allowlisted`);
  }
  return profile;
}
