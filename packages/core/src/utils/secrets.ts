// Shared secret-reference resolution (ADR-055, amended by ADR-117 spec 026).
// Moved from packages/backend so hub and agent share one implementation —
// ref semantics are identical on both sides by construction. Depends only on
// node builtins, preserving core's leaf status (ADR-065).
export interface SecretRef {
  key: string;
  env?: string;
  file?: string;
}

const DEFAULT_SECRETS_DIR = "/run/secrets";

export class EnvSecretResolver {
  // Explicit dir wins over the env var; the env var wins over the container
  // convention default. The backend instantiates with no arg (unchanged
  // behavior); the agent passes its configured SECRETS_DIR.
  constructor(private readonly secretsDir?: string) {}

  private dir(): string {
    return this.secretsDir ?? process.env.SECRETS_DIR ?? DEFAULT_SECRETS_DIR;
  }

  async resolve(ref: SecretRef): Promise<string> {
    if (ref.env !== undefined) {
      const value = process.env[ref.env];
      if (value === undefined || value === "") {
        throw new Error(`Secret environment variable not set: ${ref.env}`);
      }
      return value;
    }

    if (ref.file !== undefined) {
      // File secrets are confined to the secrets dir (the conventional
      // container secrets mount). Absolute paths and traversal outside the
      // directory are rejected.
      const { readFile } = await import("node:fs/promises");
      const { resolve, isAbsolute, relative } = await import("node:path");
      const secretsDir = resolve(this.dir());
      if (isAbsolute(ref.file)) {
        throw new Error("Secret file reference must be relative to SECRETS_DIR");
      }
      const resolved = resolve(secretsDir, ref.file);
      const rel = relative(secretsDir, resolved);
      if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error("Secret file reference escapes SECRETS_DIR");
      }
      return (await readFile(resolved, "utf8")).trim();
    }

    throw new Error("Secret ref must include env or file");
  }
}

// Resolves every entry of an agent-managed `secretRefMap` (or a keyed list of
// SecretRefs) into values. Fails the whole map on the first unresolvable ref —
// a partially resolved secret set is never handed to an importer.
export async function resolveSecretsFromMap(
  refMap: Record<string, { env?: string; file?: string }>,
  resolver: EnvSecretResolver = new EnvSecretResolver(),
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [key, ref] of Object.entries(refMap)) {
    resolved[key] = await resolver.resolve({ key, env: ref.env, file: ref.file });
  }
  return resolved;
}

export function redactSecrets(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 0) {
      output[key] = "***REDACTED***";
    } else if (typeof value === "object" && value !== null) {
      output[key] = redactSecrets(value as Record<string, unknown>);
    } else {
      output[key] = value;
    }
  }
  return output;
}
