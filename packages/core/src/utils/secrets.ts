// Shared secret-reference resolution (ADR-055, amended by ADR-117 spec 026).
// Moved from packages/backend so hub and agent share one implementation —
// ref semantics are identical on both sides by construction. Depends only on
// node builtins, preserving core's leaf status (ADR-065).
export interface SecretRef {
  key: string;
  env?: string;
  file?: string;
}

export type SecretRefSource = "env" | "file";

// The source type a ref names — the schema guarantees exactly one of
// env/file, so "env wins" is a complete enumeration.
export function refSource(ref: { env?: string; file?: string }): SecretRefSource {
  return ref.env !== undefined ? "env" : "file";
}

// Resolution failures carry a stable code and a sanitized message: they
// name the *reference* (env var name / file ref) but never resolved values
// or absolute filesystem paths (ADR-096) — safe to return over the agent
// channel and into API error fields.
export type SecretRefErrorCode =
  | "ENV_NOT_SET"
  | "FILE_ABSOLUTE"
  | "FILE_ESCAPES_DIR"
  | "FILE_NOT_READABLE"
  | "NO_SOURCE";

export class SecretRefError extends Error {
  constructor(
    readonly code: SecretRefErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SecretRefError";
  }
}

// Wraps a per-key resolution failure so callers can name WHICH key failed
// and from WHICH source type — the two facts an operator needs (spec 026
// US4 edge case). The cause message is already sanitized by SecretRefError.
export class SecretResolutionError extends Error {
  constructor(
    readonly key: string,
    readonly source: SecretRefSource,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`secret reference for key "${key}" (${source}) failed: ${reason}`);
    this.name = "SecretResolutionError";
  }
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
        throw new SecretRefError(
          "ENV_NOT_SET",
          `secret environment variable "${ref.env}" is not set`,
        );
      }
      return value;
    }

    if (ref.file !== undefined) {
      // File secrets are confined to the secrets dir (the conventional
      // container secrets mount). Absolute paths and traversal are rejected
      // at the path level; realpath confinement additionally rejects
      // symlinks inside the directory that point outside it.
      const { readFile, realpath } = await import("node:fs/promises");
      const { resolve, isAbsolute, relative } = await import("node:path");
      const secretsDir = resolve(this.dir());
      if (isAbsolute(ref.file)) {
        // Don't echo the ref — it IS an absolute path (ADR-096).
        throw new SecretRefError(
          "FILE_ABSOLUTE",
          "secret file references must be relative to SECRETS_DIR",
        );
      }
      const resolved = resolve(secretsDir, ref.file);
      const rel = relative(secretsDir, resolved);
      if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
        throw new SecretRefError(
          "FILE_ESCAPES_DIR",
          `secret file reference "${ref.file}" escapes SECRETS_DIR`,
        );
      }
      let realDir: string;
      let realFile: string;
      try {
        [realDir, realFile] = await Promise.all([
          realpath(secretsDir),
          realpath(resolved),
        ]);
      } catch {
        throw new SecretRefError(
          "FILE_NOT_READABLE",
          `secret file "${ref.file}" is not readable under SECRETS_DIR`,
        );
      }
      const realRel = relative(realDir, realFile);
      if (realRel === "" || realRel.startsWith("..") || isAbsolute(realRel)) {
        throw new SecretRefError(
          "FILE_ESCAPES_DIR",
          `secret file reference "${ref.file}" escapes SECRETS_DIR via symlink`,
        );
      }
      return (await readFile(realFile, "utf8")).trim();
    }

    throw new SecretRefError(
      "NO_SOURCE",
      "secret ref must name env or file",
    );
  }
}

// Resolves every entry of an agent-managed `secretRefMap` (or a keyed list of
// SecretRefs) into values. Fails the whole map on the first unresolvable ref —
// a partially resolved secret set is never handed to an importer; the thrown
// SecretResolutionError names the key and source type. `onResolved` fires per
// key after success (the agent uses it to log resolution events).
export async function resolveSecretsFromMap(
  refMap: Record<string, { env?: string; file?: string }>,
  resolver: EnvSecretResolver = new EnvSecretResolver(),
  onResolved?: (key: string, source: SecretRefSource) => void,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [key, ref] of Object.entries(refMap)) {
    try {
      resolved[key] = await resolver.resolve({ key, env: ref.env, file: ref.file });
    } catch (err) {
      throw new SecretResolutionError(key, refSource(ref), err);
    }
    onResolved?.(key, refSource(ref));
  }
  return resolved;
}

// Masks resolved secret VALUES inside arbitrary text (e.g. an exception
// message) before it reaches logs — an importer that echoes a secret into
// a thrown error must not leak it into agent log output (FR-012, ADR-090).
export function maskSecretValues(
  text: string,
  secrets: Record<string, string>,
): string {
  let out = text;
  for (const value of Object.values(secrets)) {
    if (value) out = out.split(value).join("***");
  }
  return out;
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
