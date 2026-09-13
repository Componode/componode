export interface SecretRef {
  key: string;
  env?: string;
  file?: string;
}

export class EnvSecretResolver {
  async resolve(ref: SecretRef): Promise<string> {
    if (ref.env !== undefined) {
      const value = process.env[ref.env];
      if (value === undefined || value === "") {
        throw new Error(`Secret environment variable not set: ${ref.env}`);
      }
      return value;
    }

    if (ref.file !== undefined) {
      // File secrets are confined to SECRETS_DIR (default /run/secrets, the
      // conventional container secrets mount). Absolute paths and traversal
      // outside the directory are rejected.
      const { readFile } = await import("node:fs/promises");
      const { resolve, isAbsolute, relative } = await import("node:path");
      const secretsDir = resolve(process.env.SECRETS_DIR ?? "/run/secrets");
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

export function redactSecrets(input: Record<string, unknown>): Record<string, unknown> {
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
