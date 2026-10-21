import { EnvSecretResolver } from "@componode/core/secrets";

// Agent-side secret resolution (spec 026 US4, ADR-117). Agent-managed
// credentials carry references — env var names or files under SECRETS_DIR —
// which are resolved HERE, on the agent host, at job/test start. Values live
// only in process memory: never persisted, never logged, never transmitted.
// The resolver is shared with the hub via @componode/core so confinement
// semantics cannot drift (research R6). The agent implements no encryption —
// refs are the only credential material it ever sees.

export interface AgentLog {
  info: (o: object, m: string) => void;
  warn: (o: object, m: string) => void;
}

export function createAgentResolver(secretsDir?: string): EnvSecretResolver {
  return new EnvSecretResolver(secretsDir);
}

// Resolves every entry of a credential.test ref map into values for the
// importer probe. Emits one resolution event per key — key name and source
// type only, never the resolved value (ADR-090).
export async function resolveRefMap(
  refMap: Record<string, { env?: string; file?: string }>,
  resolver: EnvSecretResolver,
  log: AgentLog,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [key, ref] of Object.entries(refMap)) {
    const source = ref.env !== undefined ? "env" : "file";
    resolved[key] = await resolver.resolve({
      key,
      env: ref.env,
      file: ref.file,
    });
    log.info({ key, source }, "resolved secret reference");
  }
  return resolved;
}
