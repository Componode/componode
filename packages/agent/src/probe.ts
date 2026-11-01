import {
  executeHttpProbe,
  type UrlCheckProbePayload,
  type UrlCheckProbeResultPayload,
} from "@componode/core";
import {
  maskSecretValues,
  SecretRefError,
  SecretResolutionError,
} from "@componode/core/secrets";
import { createAgentResolver, resolveRefMap, type AgentLog } from "./secrets.js";

// Agent-side url_check.probe handling (spec 051, contracts/agent-frames.md):
// secret refs resolve HERE against the agent's own env/SECRETS_DIR — values
// never cross the stream. The probe runs the shared core executor so hub
// and agent vantages measure identically; the reply carries only
// outcome/httpStatus/durationMs/errorType (the hub re-evaluates the
// check's success policy — the agent never learns it).

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface UrlCheckProbeDeps {
  secretsDir?: string;
  log: AgentLog;
  send: (type: string, frame: unknown) => void;
  fetchImpl?: FetchImpl;
}

// Key name the frame asked for is absent from the resolved bundle — a
// config defect, reported as OTHER (the name itself is non-secret).
class MissingSecretKey extends Error {
  constructor(key: string) {
    super(`credential key "${key}" was not resolved`);
  }
}

function buildAuthHeaders(
  payload: UrlCheckProbePayload,
  secrets: Record<string, string>,
): Record<string, string> {
  if (payload.authMode === "NONE") return {};
  const keys = payload.authKeyNames;
  const take = (key: string | undefined): string => {
    if (!key || secrets[key] === undefined) {
      throw new MissingSecretKey(key ?? "unknown");
    }
    return secrets[key]!;
  };
  if (payload.authMode === "BASIC") {
    return {
      Authorization: `Basic ${Buffer.from(
        `${take(keys?.usernameKey)}:${take(keys?.passwordKey)}`,
      ).toString("base64")}`,
    };
  }
  if (payload.authMode === "BEARER") {
    return { Authorization: `Bearer ${take(keys?.tokenKey)}` };
  }
  if (payload.authMode === "CUSTOM_HEADERS") {
    const headers: Record<string, string> = {};
    for (const h of keys?.headers ?? []) {
      headers[h.name] = take(h.key);
    }
    return headers;
  }
  return {};
}

export async function handleUrlCheckProbe(
  payload: UrlCheckProbePayload,
  deps: UrlCheckProbeDeps,
): Promise<void> {
  const reply = (
    result: Omit<UrlCheckProbeResultPayload, "probeId">,
  ): void => {
    deps.send("url_check.probe.result", {
      probeId: payload.probeId,
      ...result,
    });
  };

  // Held so a thrown error can be scrubbed of resolved values before it
  // touches the agent log (same discipline as credential.test).
  let resolved: Record<string, string> = {};
  try {
    if (payload.authMode !== "NONE") {
      resolved = await resolveRefMap(
        payload.secretRefMap ?? {},
        createAgentResolver(deps.secretsDir),
        deps.log,
      );
    }
    const headers = buildAuthHeaders(payload, resolved);
    const result = await executeHttpProbe(
      {
        url: payload.url,
        method: payload.method,
        timeoutMs: payload.timeoutMs,
        headers,
      },
      deps.fetchImpl,
    );
    reply({
      outcome: result.responseReceived ? "SUCCESS" : "FAILURE",
      httpStatus: result.httpStatus,
      durationMs: result.durationMs,
      errorType: result.errorType,
    });
  } catch (err) {
    // Resolution failures name key + source type only; anything else gets
    // masked against the resolved bundle before logging. The wire only
    // ever sees an errorType.
    if (err instanceof SecretResolutionError || err instanceof SecretRefError) {
      deps.log.warn({ err: err.message }, "url check probe secret resolution failed");
      return reply({ outcome: "FAILURE", errorType: "OTHER" });
    }
    deps.log.warn(
      {
        err: maskSecretValues(
          err instanceof Error ? err.message : String(err),
          resolved,
        ),
      },
      "url check probe failed on agent",
    );
    reply({ outcome: "FAILURE", errorType: "OTHER" });
  }
}
