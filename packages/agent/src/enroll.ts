import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { Agent, ProxyAgent, type Dispatcher } from "undici";
import { proxyForUrl, type AgentConfig } from "./config.js";

// Enrollment exchange + durable-credential persistence (spec 025 US2/US5).
// The plaintext credential exists only in memory and the state-dir file —
// never in logs.

export const TOKEN_FILENAME = "agent-token";

// Enrollment must honor the same TLS/proxy env as the WS leg (US5 AS3) —
// first boot against an internal-CA or egress-proxy hub dies here otherwise.
// `requestTls` on ProxyAgent applies to the tunneled target connection.
function enrollDispatcher(cfg: AgentConfig): Dispatcher | undefined {
  const ca = cfg.caBundle ? readFileSync(cfg.caBundle) : undefined;
  const proxy = proxyForUrl(cfg, cfg.hubUrl);
  if (proxy) {
    return new ProxyAgent({
      uri: proxy,
      ...(ca ? { requestTls: { ca } } : {}),
    });
  }
  return ca ? new Agent({ connect: { ca } }) : undefined;
}

export class EnrollError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "EnrollError";
  }
}

export async function enrollAgent(
  cfg: AgentConfig,
  enrollmentToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetchImpl(`${cfg.hubUrl}/api/v1/agent/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: enrollmentToken }),
      // @ts-expect-error — undici dispatcher is a Node fetch extension.
      dispatcher: enrollDispatcher(cfg),
    });
  } catch (err) {
    throw new EnrollError(
      `enrollment request failed: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new EnrollError(
      `enrollment rejected by hub (${res.status}) — the token is invalid, used, or expired`,
      res.status,
    );
  }
  const body = (await res.json()) as { agentToken?: string };
  if (!body.agentToken) {
    throw new EnrollError("enrollment response missing agentToken");
  }
  return body.agentToken;
}

const TOKEN_MODE = 0o600;

/** Write the durable credential under the state dir, owner-only. Fatal
 *  failures throw — running without persistence would re-enroll every boot. */
export function persistToken(stateDir: string, token: string): string {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const path = join(stateDir, TOKEN_FILENAME);
  writeFileSync(path, token, { mode: TOKEN_MODE });
  if (process.platform !== "win32") {
    // writeFileSync honors mode only on creation; force it for preexisting files.
    chmodSync(path, TOKEN_MODE);
  }
  return path;
}

export function readPersistedToken(stateDir: string): string | undefined {
  const path = join(stateDir, TOKEN_FILENAME);
  if (!existsSync(path)) return undefined;
  const token = readFileSync(path, "utf8").trim();
  return token.length > 0 ? token : undefined;
}
