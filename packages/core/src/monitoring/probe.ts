import type {
  UrlCheckErrorType,
  UrlCheckMethod,
} from "../constants/url-check.js";
import { urlSafetyError } from "../validation/url-safety.js";

/**
 * Shared HTTP(S) probe executor for URL Check monitoring (ADR-123, spec
 * 051). Used identically by the Hub dispatcher and Import Agent handlers so
 * both vantages produce the same measurement semantics.
 *
 * Boundary rules (ADR-123 item 6): GET by default, HEAD optional; redirects
 * are never followed (the original response is evaluated); the body is never
 * parsed or persisted — cancelled as soon as response headers arrive;
 * `durationMs` is request-start → response-headers (the TTFB boundary).
 */

export interface HttpProbeInput {
  url: string;
  method: UrlCheckMethod;
  timeoutMs: number;
  /** Pre-resolved auth/custom headers — values already resolved by caller. */
  headers?: Record<string, string>;
  /** Optional caller abort signal (composed with the timeout). */
  signal?: AbortSignal;
}

export interface HttpProbeResult {
  /** True when an HTTP response (any status) was received. */
  responseReceived: boolean;
  httpStatus: number | null;
  /** Request-start → response-headers duration in ms (null on failure). */
  durationMs: number | null;
  /** Normalized transport/policy error, or null when a response arrived. */
  errorType: UrlCheckErrorType | null;
}

type FetchImpl = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);
const CONNECT_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "ESOCKETTIMEDOUT"]);
const TLS_CODE_PATTERNS = [
  "CERT",
  "SELF_SIGNED",
  "UNABLE_TO_",
  "SSL",
  "TLS",
  "DEPTH_ZERO",
];

function classifyError(err: unknown): UrlCheckErrorType {
  const name = (err as { name?: string })?.name;
  if (name === "TimeoutError") return "TIMEOUT";
  if (name === "AbortError") return "ABORTED";
  const code = (
    (err as { cause?: { code?: string } })?.cause ??
    (err as { code?: string })
  )?.code;
  if (typeof code === "string") {
    if (DNS_CODES.has(code)) return "DNS";
    if (CONNECT_CODES.has(code)) return "CONNECT";
    if (TIMEOUT_CODES.has(code)) return "TIMEOUT";
    if (TLS_CODE_PATTERNS.some((p) => code.includes(p))) return "TLS";
  }
  return "OTHER";
}

export async function executeHttpProbe(
  input: HttpProbeInput,
  fetchImpl: FetchImpl = (url, init) => fetch(url, init),
): Promise<HttpProbeResult> {
  // ADR-106: validate the destination as written before any request.
  if (urlSafetyError(input.url) !== null) {
    return {
      responseReceived: false,
      httpStatus: null,
      durationMs: null,
      errorType: "POLICY_BLOCKED",
    };
  }

  const signals = [AbortSignal.timeout(input.timeoutMs)];
  if (input.signal) signals.push(input.signal);
  const signal =
    signals.length === 1 ? signals[0] : AbortSignal.any(signals);

  const started = performance.now();
  try {
    const res = await fetchImpl(input.url, {
      method: input.method,
      redirect: "manual",
      signal,
      headers: {
        "user-agent": "Componode-URLCheck/1.0",
        ...input.headers,
      },
    });
    const durationMs = Math.round(performance.now() - started);
    // Body is never read — cancel so it isn't downloaded (GET case).
    try {
      await res.body?.cancel();
    } catch {
      // Best-effort cancel; measurement already taken.
    }
    return {
      responseReceived: true,
      httpStatus: res.status,
      durationMs,
      errorType: null,
    };
  } catch (err) {
    return {
      responseReceived: false,
      httpStatus: null,
      durationMs: Math.round(performance.now() - started),
      errorType: classifyError(err),
    };
  }
}

// Applies a check's success policy to a received status code.
export function statusAccepted(
  httpStatus: number,
  policy: { codes: number[]; ranges: Array<{ min: number; max: number }> },
): boolean {
  if (policy.codes.includes(httpStatus)) return true;
  return policy.ranges.some(
    (r) => httpStatus >= r.min && httpStatus <= r.max,
  );
}

// Discovery-probe fetch for Web/API importers (spec 058): the same redirect
// and timeout hardening as monitoring probes, but returns the Response so
// the importer can read a bounded body preview. Callers are responsible for
// URL safety — importer configs validate destinations via urlSafetyError.
export const ENDPOINT_PROBE_TIMEOUT_MS = 15_000;

export function probeEndpoint(
  url: string,
  signal: AbortSignal,
  timeoutMs: number = ENDPOINT_PROBE_TIMEOUT_MS,
): Promise<Response> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  return fetch(url, {
    redirect: "manual",
    signal: combined,
    headers: { "user-agent": "Componode-Discovery/1.0" },
  });
}
