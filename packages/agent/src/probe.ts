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
import {
  createAgentResolver,
  resolveRefMap,
  type AgentLog,
} from "./secrets.js";
import type { AgentOpsMetrics } from "./metrics.js";

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
  /** Composed with the probe timeout inside executeHttpProbe (spec 052). */
  signal?: AbortSignal;
  /** Ops counters (spec 052 US3) — probe in-flight gauge + result counter. */
  ops?: AgentOpsMetrics;
  /** Called with each result before it is sent — feeds ops metrics. */
  onResult?: (result: { outcome: string; errorType?: string | null }) => void;
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
  const reply = (result: Omit<UrlCheckProbeResultPayload, "probeId">): void => {
    deps.onResult?.(result);
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
        signal: deps.signal,
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
      deps.log.warn(
        { err: err.message },
        "url check probe secret resolution failed",
      );
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

// Probe runner (spec 052, FR-006/007/008): admission control + cancellation
// for the agent side. At most `maxProbes` fetches run concurrently — excess
// frames get an immediate SATURATED refusal (explicit, never silently
// deferred or dropped). Each accepted probe gets an AbortController so a
// hub `url_check.probe.cancel` or session teardown can stop the fetch
// promptly instead of letting it run to its timeout.
export interface UrlCheckProbeRunner {
  /** Admit a probe frame: run it under the cap, or refuse SATURATED. */
  handleProbe(payload: UrlCheckProbePayload): void;
  /** Abort one in-flight probe; unknown/settled ids are a no-op. */
  cancel(probeId: string): void;
  /** Abort every in-flight probe (session teardown). */
  abortAll(): void;
  inFlightCount(): number;
}

export function createProbeRunner(
  deps: UrlCheckProbeDeps & { maxProbes: number },
): UrlCheckProbeRunner {
  const controllers = new Map<string, AbortController>();

  const handleProbe = (payload: UrlCheckProbePayload): void => {
    // A repeated probeId must not overwrite the in-flight controller —
    // it would bypass the cap and lose the original's cancel handle.
    if (controllers.has(payload.probeId)) {
      deps.log.warn(
        { probeId: payload.probeId },
        "duplicate url check probe frame ignored",
      );
      return;
    }
    if (controllers.size >= deps.maxProbes) {
      deps.ops?.urlCheckProbeRefused();
      deps.send("url_check.probe.result", {
        probeId: payload.probeId,
        outcome: "FAILURE",
        errorType: "SATURATED",
      });
      deps.log.warn(
        { probeId: payload.probeId, maxProbes: deps.maxProbes },
        "url check probe refused — agent at in-flight cap",
      );
      return;
    }
    const controller = new AbortController();
    controllers.set(payload.probeId, controller);
    deps.ops?.urlCheckProbeStarted();
    void handleUrlCheckProbe(payload, {
      ...deps,
      signal: controller.signal,
      onResult: (r) =>
        deps.ops?.urlCheckProbeDone(
          r.outcome === "SUCCESS"
            ? "success"
            : r.errorType === "ABORTED"
              ? "aborted"
              : "failure",
        ),
    }).finally(() => controllers.delete(payload.probeId));
  };

  return {
    handleProbe,
    cancel: (probeId) => controllers.get(probeId)?.abort(),
    abortAll: () => {
      for (const c of controllers.values()) c.abort();
    },
    inFlightCount: () => controllers.size,
  };
}
