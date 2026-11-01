import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DockerOptions } from "./transport.js";

// Docker CLI context-store layout: contexts/meta/<sha256(name)>/meta.json
// carrying Endpoints.docker.Host + Storage.TLSPath + TLSMaterial;
// contexts/tls/<hash>/docker/ holds ca.pem/cert.pem/key.pem. Wave C reads
// the default ~/.docker store (ADR-098 forbids process.env access in
// importers — DOCKER_CONFIG relocation can be threaded through the agent
// in a later wave if needed).
function dockerConfigDir(): string {
  return join(homedir(), ".docker");
}

function contextDirName(name: string): string {
  return createHash("sha256").update(name).digest("hex");
}

interface ContextMeta {
  Name?: string;
  Endpoints?: Record<string, { Host?: string; SkipTLSVerify?: boolean }>;
  TLSMaterial?: Record<string, string[]>;
  Storage?: { MetadataPath?: string; TLSPath?: string };
}

function nonSecretFail(message: string): never {
  throw new Error(`docker context resolution failed: ${message}`);
}

/**
 * Resolve a named, allowlisted, on-disk Docker Context on the Agent into
 * dockerode options (ADR-121). Rejects the in-memory `default` context,
 * `SkipTLSVerify`, and `ssh://` endpoints (use a direct `ssh` profile).
 */
export function resolveDockerContext(
  name: string,
  baseDir: string = dockerConfigDir(),
): DockerOptions {
  if (name === "default") {
    nonSecretFail('the in-memory "default" context is not allowed');
  }
  const metaDir = join(baseDir, "contexts", "meta", contextDirName(name));
  let meta: ContextMeta;
  try {
    meta = JSON.parse(readFileSync(join(metaDir, "meta.json"), "utf8")) as ContextMeta;
  } catch {
    nonSecretFail(`context "${name}" is not present in the agent context store`);
  }
  const endpoint = meta.Endpoints?.docker;
  const host = endpoint?.Host;
  if (!host) {
    nonSecretFail(`context "${name}" has no docker endpoint`);
  }
  if (endpoint?.SkipTLSVerify === true) {
    nonSecretFail(`context "${name}" has SkipTLSVerify enabled`);
  }

  const tlsDir = meta.Storage?.TLSPath
    ? join(meta.Storage.TLSPath, "docker")
    : undefined;
  const readTls = (file: string): Buffer | undefined => {
    if (!tlsDir) return undefined;
    try {
      return readFileSync(join(tlsDir, file));
    } catch {
      return undefined;
    }
  };

  if (host.startsWith("unix://")) {
    return { socketPath: host.slice("unix://".length) };
  }
  if (host.startsWith("npipe://")) {
    return { socketPath: host.slice("npipe://".length) };
  }
  if (host.startsWith("tcp://")) {
    const url = new URL(host);
    const ca = readTls("ca.pem");
    const cert = readTls("cert.pem");
    const key = readTls("key.pem");
    const opts: Record<string, unknown> = {
      protocol: "https",
      host: url.hostname,
      port: Number(url.port || 2376),
    };
    if (cert && key) {
      opts.cert = cert;
      opts.key = key;
      if (ca) opts.ca = ca;
    }
    return opts as DockerOptions;
  }
  nonSecretFail(
    `context "${name}" endpoint scheme is unsupported (ssh:// contexts must use a direct ssh target profile)`,
  );
}
