import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// Agent runtime configuration (spec 025 US5, ADR-116). Fails closed on
// insecure transports: the stream carries credentials, so anything but
// loopback requires TLS. No skip-verify escape hatch.

export interface AgentConfig {
  /** http(s) base URL of the hub, no trailing slash. */
  hubUrl: string;
  /** wss:// (or ws:// loopback) stream endpoint derived from hubUrl. */
  streamUrl: string;
  agentToken?: string;
  agentTokenFile?: string;
  enrollmentToken?: string;
  enrollmentTokenFile?: string;
  stateDir: string;
  secretsDir?: string;
  caBundle?: string;
  maxJobs: number;
  httpsProxy?: string;
  httpProxy?: string;
  noProxy?: string;
  /** Local operations listener (spec 028). Absent = disabled (tests that
   *  build configs by hand opt out); loadConfig always populates it. */
  ops?: {
    enabled: boolean;
    host: string;
    port: number;
  };
}

const envSchema = z.object({
  HUB_URL: z.string().min(1),
  AGENT_TOKEN: z.string().min(1).optional(),
  AGENT_TOKEN_FILE: z.string().min(1).optional(),
  AGENT_ENROLLMENT_TOKEN: z.string().min(1).optional(),
  AGENT_ENROLLMENT_TOKEN_FILE: z.string().min(1).optional(),
  AGENT_STATE_DIR: z.string().min(1).optional(),
  SECRETS_DIR: z.string().min(1).optional(),
  CA_BUNDLE: z.string().min(1).optional(),
  MAX_JOBS: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number(v))
    .pipe(z.number().int().min(1))
    .optional(),
  HTTPS_PROXY: z.string().min(1).optional(),
  HTTP_PROXY: z.string().min(1).optional(),
  NO_PROXY: z.string().min(1).optional(),
  // Operations listener (spec 028): unauthenticated local surface serving
  // /healthz, /readyz, /metrics — state and counters only.
  AGENT_OPS_HOST: z.string().min(1).optional(),
  AGENT_OPS_PORT: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Number(v))
    .pipe(z.number().int().min(1).max(65_535))
    .optional(),
  AGENT_OPS_DISABLED: z.string().optional(),
});

function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || h.startsWith("127.");
}

export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): AgentConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `agent config invalid: ${first?.path.join(".") ?? "?"} — ${first?.message ?? "unknown"}`,
    );
  }
  const e = parsed.data;

  let hub = new URL(e.HUB_URL);
  const insecure = hub.protocol === "http:" || hub.protocol === "ws:";
  if (insecure && !isLoopback(hub.hostname)) {
    throw new Error(
      `HUB_URL "${e.HUB_URL}" uses an insecure scheme; TLS (https:// or wss://) ` +
        "is required for non-loopback hosts — the stream carries credentials",
    );
  }
  if (hub.protocol === "ws:")
    hub = new URL(`http://${hub.host}${hub.pathname}${hub.search}`);
  if (hub.protocol === "wss:")
    hub = new URL(`https://${hub.host}${hub.pathname}${hub.search}`);
  const hubUrl = hub.origin + hub.pathname.replace(/\/+$/, "");
  const streamUrl = `${insecure ? "ws" : "wss"}://${hub.host}${hub.pathname.replace(/\/+$/, "")}/api/v1/agent/stream`;

  return {
    hubUrl,
    streamUrl,
    agentToken: e.AGENT_TOKEN,
    agentTokenFile: e.AGENT_TOKEN_FILE,
    enrollmentToken: e.AGENT_ENROLLMENT_TOKEN,
    enrollmentTokenFile: e.AGENT_ENROLLMENT_TOKEN_FILE,
    stateDir: e.AGENT_STATE_DIR ?? join(process.cwd(), ".agent-state"),
    secretsDir: e.SECRETS_DIR,
    caBundle: e.CA_BUNDLE,
    maxJobs: e.MAX_JOBS ?? 1,
    httpsProxy: e.HTTPS_PROXY,
    httpProxy: e.HTTP_PROXY,
    noProxy: e.NO_PROXY,
    ops: {
      enabled: e.AGENT_OPS_DISABLED !== "true",
      host: e.AGENT_OPS_HOST ?? "0.0.0.0",
      port: e.AGENT_OPS_PORT ?? 9464,
    },
  };
}

/** NO_PROXY matching: `*`, suffix (`.corp.internal`), or exact host. */
export function bypassedByNoProxy(url: string, noProxy?: string): boolean {
  if (!noProxy) return false;
  const host = new URL(url).hostname;
  return noProxy.split(",").some((entry) => {
    const e = entry.trim();
    if (!e) return false;
    if (e === "*") return true;
    return e.startsWith(".") ? host.endsWith(e) : host === e;
  });
}

function readSecretFile(path: string): string {
  return readFileSync(path, "utf8").trim();
}

// Credential precedence (spec clarification): explicit file beats explicit
// env var; the persisted state-dir token is handled by the caller.
function resolveToken(file: string | undefined, inline: string | undefined) {
  return file ? readSecretFile(file) : inline;
}

export function resolveAgentToken(cfg: AgentConfig): string | undefined {
  return resolveToken(cfg.agentTokenFile, cfg.agentToken);
}

export function resolveEnrollmentToken(cfg: AgentConfig): string | undefined {
  return resolveToken(cfg.enrollmentTokenFile, cfg.enrollmentToken);
}

/** Proxy URL to use for `url`, honoring HTTPS_PROXY/HTTP_PROXY + NO_PROXY —
 *  shared by the enrollment (undici) and WS (https-proxy-agent) legs so both
 *  transports agree on when a proxy applies. */
export function proxyForUrl(cfg: AgentConfig, url: string): string | undefined {
  const proxy = cfg.httpsProxy ?? cfg.httpProxy;
  if (!proxy || bypassedByNoProxy(url, cfg.noProxy)) return undefined;
  return proxy;
}
